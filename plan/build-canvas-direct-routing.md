# [frontier-corm][web] Direct Belt Routing for Adjacent-Row Connections

When a source card's output feeds a consumer card exactly one row above it
(`dst.row === src.row + 1`), the current main-bus routing is visually noisy:
the belt swings hard left to the main bus then back right, even though the
source and consumer are neighbours. Fix: detect the adjacent-row case and
route directly through the shared gap band instead.

## Rule

| Row distance | Routing |
|---|---|
| `dst.row === src.row + 1` | **Direct**: UP → horizontal → UP, straight through the gap band |
| `dst.row > src.row + 1` | **Main-bus**: existing 5-segment tributary → main bus → offshoot route |

## Visual model

```
Adjacent rows (rowDiff === 1):

  ┌───────────────┐
  │  Consumer     │
  └───────▲───────┘
          │  ← seg 3: UP from directY to consumerDot
  ════════╪══════ directY (horizontal lane in the gap band)
          │  ← seg 2: horizontal from sourceDot.x to consumerDot.x
          │  ← seg 1: UP from sourceDot to directY
  ┌───────┴───────┐
  │  Source       │
  └───────────────┘

Multi-row (rowDiff > 1) — unchanged:

  ┌───────────────┐
  │  Consumer     │
  └───────▲───────┘
  ════════╪══════ offshootY (offshoot lane in consumer's gap band)
          │
  ║ (main bus)
  ║
  ════════╪══════ tributaryY (tributary lane in source's gap band)
          │
  ┌───────┴───────┐
  │  Source       │
  └───────────────┘
```

## Changes required

### `canvasBusRouter.ts`

#### 1. Add `isDirect` flag to `PlannedBelt`

```ts
interface PlannedBelt {
  // ... existing fields ...
  isDirect: boolean;   // true when consumerRow === sourceRow + 1
  directLane: number;  // assigned when isDirect; 0 otherwise
}
```

In the loop that builds `planned[]`, set:

```ts
const isDirect = dst.row === src.row + 1;
planned.push({
  ...
  isDirect,
  directLane: 0,
});
```

#### 2. Assign direct lanes per gap band

After the existing tributary/offshoot lane assignment loops, add a pass for
direct belts. Direct belts share the same gap band as their trib/offshoot
peers (band index === `src.row`), but get their own lane pool so they don't
collide.

```ts
// ── Assign direct lanes per band ──
for (let band = 0; band < gapCount; band++) {
  const belts = planned.filter((b) => b.isDirect && b.tribBandIdx === band);
  // x-range: between sourceDot.x and consumerDot.x (order doesn't matter for coloring)
  const withRange = belts.map((b) => ({
    belt: b,
    range: [
      Math.min(b.sourceDot.x, b.consumerDot.x),
      Math.max(b.sourceDot.x, b.consumerDot.x),
    ] as [number, number],
  }));
  withRange.sort((a, b) => a.range[0] - b.range[0]);
  const count = assignLanes(withRange);
  for (const item of withRange) {
    item.belt.directLane = (item as typeof item & { lane?: number }).lane ?? 0;
  }
  // Optionally: expose directLaneCount in gapLaneCounts for future gap sizing
}
```

Direct belts still have `tribBandIdx` and `offshootBandIdx` set (they're
equal since rowDiff === 1), but they will **not** be included in the main bus
lane assignment.

#### 3. Exclude direct belts from main bus lane assignment

Wrap the existing `mainBusItems` construction with a filter:

```ts
const mainBusItems = planned
  .filter((b) => !b.isDirect)   // ← add this filter
  .map((b) => { ... });
```

#### 4. Compute direct Y and build segments conditionally

In `tempBandY`, the gap band sits between `rowBounds[band].top` (bottom of
source row's card region) and `rowBounds[band + 1].bottom` (top of consumer
row's card region). Direct belts use a lane near the **middle** of the gap
band, above the offshoot block.

```ts
const directY = (bandIdx: number, lane: number): number => {
  const bandBottomY = rowBounds[bandIdx].top;         // source side of gap
  const bandTopY = rowBounds[bandIdx + 1].bottom;     // consumer side of gap
  // Place direct lanes in the upper half of the gap (near consumer),
  // above offshoot lanes: stack upward from BAND_EDGE_PAD from band top.
  return bandTopY + BAND_EDGE_PAD + lane * LANE_SPACING;
};
```

In the segment-building `planned.map(...)` block, branch on `isDirect`:

```ts
const segs: OrthoSegment[] = b.isDirect
  ? [
      // 1. UP from source dot to the direct-lane Y
      { from: b.sourceDot, to: { x: b.sourceDot.x, y: directY(b.tribBandIdx, b.directLane) } },
      // 2. Horizontal to consumer's X
      {
        from: { x: b.sourceDot.x, y: directY(b.tribBandIdx, b.directLane) },
        to:   { x: b.consumerDot.x, y: directY(b.tribBandIdx, b.directLane) },
      },
      // 3. UP from direct-lane Y to consumer input dot
      { from: { x: b.consumerDot.x, y: directY(b.tribBandIdx, b.directLane) }, to: b.consumerDot },
    ]
  : [
      // existing 5-segment main-bus route (unchanged)
      { from: b.sourceDot, to: { x: b.sourceDot.x, y: tributaryY } },
      { from: { x: b.sourceDot.x, y: tributaryY }, to: { x: mainX, y: tributaryY } },
      { from: { x: mainX, y: tributaryY }, to: { x: mainX, y: offshootY } },
      { from: { x: mainX, y: offshootY }, to: { x: b.consumerDot.x, y: offshootY } },
      { from: { x: b.consumerDot.x, y: offshootY }, to: b.consumerDot },
    ];
```

Note: when `sourceDot.x === consumerDot.x` the horizontal segment is a
zero-length no-op — the polyline renderer handles this gracefully, no special
case needed.

#### 5. Update `RouterOutput` (optional, non-breaking)

The `gapLaneCounts` array already exists. If caller needs direct lane counts
for gap sizing, add `directLanes: number` to the per-gap record. Start with
zero and fill in step 2 above. This is backward-compatible since existing
callers destructure only `tributaryLanes` and `offshootLanes`.

### No changes needed in `BuildCanvas.tsx`

The polyline rendering loop is already generic — it flattens whatever segments
the belt carries. A 3-segment direct belt renders as a 4-point polyline
(start + 3 end-points), which is valid SVG.

## Implementation steps

1. Add `isDirect: boolean` and `directLane: number` to `PlannedBelt`.
2. Set `isDirect` in the belt planning loop.
3. Add direct-lane assignment loop after tributary/offshoot assignment.
4. Filter direct belts out of `mainBusItems`.
5. Add `directY` helper (or inline it).
6. Branch on `b.isDirect` in the segment-building block.
7. Manual QA: verify adjacent-row connections go straight; verify multi-row
   connections still route through the main bus.

## Edge cases

- **Same-column adjacent**: `sourceDot.x === consumerDot.x` — horizontal
  segment is zero-length. Polyline is still valid (3 collinear points on a
  vertical line). Acceptable.
- **Direct belt whose source/consumer are far apart horizontally**: the
  horizontal segment at `directY` may be long, potentially crossing over other
  cards. This is visually fine — it's still an orthogonal, direct connection.
- **Multiple direct belts in the same gap**: each gets its own `directLane`
  number, spacing them `LANE_SPACING = 3px` apart. With the existing
  340px `ROW_SLOT_HEIGHT` there is ample room.
- **Mixed gap**: a gap band may contain both direct belts (from adjacent-row
  edges) and tributary/offshoot lanes (from multi-row edges that happen to
  pass through the same band). These use separate Y positions and don't
  collide.
