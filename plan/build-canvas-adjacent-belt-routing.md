# [frontier-corm][web] Adjacent Belt Routing Improvement

## Problem

Adjacent-row direct belts (source one row below consumer) currently route through a single
horizontal jog at a fixed Y level (`directBandY`).  This looks disconnected from the main-bus
visual language and makes it hard to read which direction the belt is flowing.

Two changes are needed:
1. **Directional turn placement** — the 90° turn should happen at the tributary band Y level
   when the belt needs to travel **left**, and at the offshoot band Y level when it needs to
   travel **right**.  This mirrors the tributary/offshoot semantics of the main bus and makes
   adjacent belts look like abbreviated versions of the full manifold path.
2. **Wider stroke** — increase belt stroke width from 1.5 px to 3 px so individual belts are
   easier to distinguish.

---

## Routing model change

### Current (direct belts)

```
source → UP → directBandY  →  HORIZONTAL  → consumer.x  →  UP → consumer
```

All at one flat Y in the middle of the gap.

### Proposed (direction-aware direct belts)

**Left-going** (`source.x >= consumer.x`):
```
source → UP → tribY  →  LEFT to consumer.x  →  UP → consumer
```
Turn happens at the **lower** edge of the gap (tributary zone), matching the left-turn
aesthetic of main-bus tributaries.

**Right-going** (`source.x < consumer.x`):
```
source → UP → offshootY  →  RIGHT to consumer.x  →  UP → consumer
```
Turn happens at the **upper** edge of the gap (offshoot zone), matching the right-turn
aesthetic of main-bus offshoots.

**Same-column** (`source.x === consumer.x`): single straight vertical segment (no turn needed).

The `tribY` / `offshootY` values come from the existing `tempBandY(bandIdx)` helper already
present in `routeEdges`.

---

## Lane assignment change

Replace the single `directLane` pool with two directional pools per gap band:

| Pool | Belts | Y anchor | Lane stacking |
|---|---|---|---|
| `directLeftLane` | `source.x >= consumer.x`, adjacent | `tribBand.tribY` | lanes stack UP (decreasing Y) |
| `directRightLane` | `source.x < consumer.x`, adjacent | `offshootBand.offshootY` | lanes stack DOWN (increasing Y) |

Left lanes are positioned at `tribBand.tribY - lane * LANE_SPACING` — they sit in the same
vertical zone as tributary lanes of non-direct belts (near the source card top), which is fine
because their horizontal extents don't overlap (direct belts don't reach the main bus).

Right lanes are positioned at `offshootBand.offshootY + lane * LANE_SPACING` — same zone as
offshoot lanes of non-direct belts.

The interval-coloring `assignLanes` helper is reused unchanged; the range for a direct belt is
`[min(source.x, consumer.x), max(source.x, consumer.x)]`.

---

## Files to change

### `web/src/lib/canvasBusRouter.ts`

1. **`PlannedBelt` interface** — replace `directLane: number` with
   `directLeftLane: number` and `directRightLane: number`.  Add a derived helper
   `isDirectLeft: boolean` (`isDirect && sourceDot.x >= consumerDot.x`).

2. **Lane assignment block for direct belts** — split into two passes per band:
   - Pass A: filter `isDirect && isDirectLeft`, assign `directLeftLane`
   - Pass B: filter `isDirect && !isDirectLeft`, assign `directRightLane`

3. **Segment builder (the `isDirect` branch in `planned.map`)** — replace current 3-segment
   logic with:
   ```
   if (source.x === consumer.x) {
     // straight vertical — single segment
   } else if (isDirectLeft) {
     const y = tribBand.tribY - directLeftLane * LANE_SPACING;
     // seg1: UP to y, seg2: LEFT to consumer.x, seg3: UP to consumer
   } else {
     const y = offshootBand.offshootY + directRightLane * LANE_SPACING;
     // seg1: UP to y, seg2: RIGHT to consumer.x, seg3: UP to consumer
   }
   ```
   `tempBandY` is already in scope — reuse it here.

4. Remove `directBandY` helper (no longer needed).

### `web/src/components/forge/canvas/BuildCanvas.tsx`

- In the `beltElements` `useMemo`, change `strokeWidth={1.5}` → `strokeWidth={3}`.

---

## Out of scope

- Non-adjacent (multi-row) belt routing — unchanged.
- Main bus layout, lane counts, or gap height calculations — unchanged.
- Belt color palette — unchanged.
