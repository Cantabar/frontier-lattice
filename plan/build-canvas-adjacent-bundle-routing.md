# [frontier-corm][web] Adjacent-Layer Bundle Belt Routing

## Problem

When a blueprint sends its output to one or more consumers in the adjacent layer
(exactly one row above), the router currently generates one independent belt per
consumer.  Each belt occupies its own horizontal lane in the gap band, so N
consumers produce N lanes of noise even though all N belts carry the same
material from the same source.

The desired behaviour: all edges from the same `(sourceCardId, typeId)` pair
that share the same gap band are merged into one **bundle belt**.  The bundle
uses a single horizontal rail in one lane.  Vertical branch segments drop from
the rail to each consumer's input dot wherever the rail vertically aligns with
that input port (same X column).

---

## Visual model

### Current (one belt per consumer)

```
 [C1]      [C2]      [C3]
   ↑          ↑         ↑
   │          │         │
   ╔══════════╝         │   ← each belt owns its own lane
   │                    │
   │          ╔═════════╝   ← another lane
   │          │
 [Source]
```

### Proposed (one bundle belt per source-material group)

```
 [C1]      [C2]      [C3]
   ↑          ↑         ↑
   │          │         │    ← branch segments (one per consumer)
   ╞══════════╪══════════╡   ← single horizontal rail in one lane
              │              ← trunk from source to rail
           [Source]
```

When the source is not centred under the consumers, the rail still extends
left/right to cover all consumer X positions:

```
 [C1]      [C2]      [C3]
   ↑          ↑         ↑
   │          │         │
   ╞══════════╪══════════╡   ← rail spans [minX, maxX]
   │
 [Source]
```

The trunk connects at `sourceDot.x` anywhere along the rail.  All segments
share the same color (`beltColor(sourceCardId:typeId)`).

---

## Lane allocation

The rail lane is allocated from the **tributary pool** (lower half of the gap
band, same zone currently used for non-direct tributary segments).  Interval
coloring (`assignLanes`) is reused unchanged; the rail's X range is
`[minX, maxX]` = `[min(sourceDot.x, ...consumerDot.x), max(sourceDot.x,
...consumerDot.x)]`.

Because tributary ranges span `[mainBusLeftX, sourceDot.x]` (left side of
canvas) and direct rail ranges span the source-to-consumer region (typically
right-of-bus), they rarely overlap.  When they do, `assignLanes` automatically
assigns the direct rail a different lane index so Y positions never collide.

The direction-split left/right pools (`directLeftLane`, `directRightLane`) are
**removed** — they're superseded by the single rail lane per bundle.

---

## Data structures

### Removed from `PlannedBelt`

```ts
isDirectLeft: boolean;
directLeftLane: number;
directRightLane: number;
```

### Added to `PlannedBelt`

```ts
/** Identifies which bundle this planned belt belongs to.
 *  Format: `${sourceCardId}:${typeId}:${tribBandIdx}` */
bundleKey: string;
/** Rail lane assigned to the bundle (same for all members of a bundle). */
directRailLane: number;
```

### New internal structure: `DirectBundle`

```ts
interface DirectBundle {
  key: string;               // bundleKey
  sourceCardId: string;
  typeId: number;
  tribBandIdx: number;
  sourceDot: Point;
  consumers: { consumerCardId: string; consumerDot: Point }[];
  railLane: number;          // filled in by assignLanes
  range: [number, number];   // [minX, maxX] across source + all consumers
}
```

---

## Segment generation

For each `DirectBundle`, emit three categories of `Belt` objects (all sharing
`color = beltColor(sourceCardId:typeId)` and `sourceCardId`):

### 1 — Trunk belt

`id = "${sourceCardId}:${typeId}:${tribBandIdx}:trunk"`

```
sourceDot → UP → (sourceDot.x, railY)
```

### 2 — Rail belt

`id = "${sourceCardId}:${typeId}:${tribBandIdx}:rail"`

```
(minX, railY) → HORIZONTAL → (maxX, railY)
```

Where:
```ts
const railY = tribBand.tribY + bundle.railLane * LANE_SPACING;
const minX  = Math.min(bundle.sourceDot.x, ...bundle.consumers.map(c => c.consumerDot.x));
const maxX  = Math.max(bundle.sourceDot.x, ...bundle.consumers.map(c => c.consumerDot.x));
```

### 3 — Branch belts (one per consumer)

`id = "${sourceCardId}:${typeId}:${consumerCardId}:branch"`

```
(consumerDot.x, railY) → UP → consumerDot
```

**Special case — same column:** when `sourceDot.x === consumerDot.x` and there
is only one consumer, collapse the bundle to a single vertical segment (trunk
only, no rail or branch needed).  When multiple consumers share the same X as
the source, the trunk connects to the rail and those consumers' branch segments
are zero-length (rendered as two coincident points — harmless).

---

## `RouterOutput` changes

Add `directRailLanes` to `gapLaneCounts` so `BuildCanvas` can account for the
extra lanes when computing gap height:

```ts
export interface RouterOutput {
  belts: Belt[];
  gapLaneCounts: Array<{
    tributaryLanes: number;
    offshootLanes: number;
    directRailLanes: number;   // ← new
  }>;
  mainBusLaneCount: number;
}
```

`BuildCanvas.tsx` currently reads `tributaryLanes` and `offshootLanes` from
`gapLaneCounts` for gap height computation; add `directRailLanes` to the same
formula so the gap never becomes too tight when many bundles coexist.

---

## Files to change

### `web/src/lib/canvasBusRouter.ts`

1. **`PlannedBelt` interface** — remove `isDirectLeft`, `directLeftLane`,
   `directRightLane`; add `bundleKey: string` and `directRailLane: number`.

2. **Belt planning loop** — compute `bundleKey =
   \`${sourceCardId}:${typeId}:${tribBandIdx}\`` for each direct belt.

3. **Direct lane assignment block** — replace the left/right pool logic with
   bundle grouping:
   ```ts
   for (let band = 0; band < gapCount; band++) {
     const directBelts = planned.filter(b => b.isDirect && b.tribBandIdx === band);

     // Group into bundles by (sourceCardId, typeId)
     const bundles = new Map<string, DirectBundle>();
     for (const b of directBelts) {
       const key = b.bundleKey;
       if (!bundles.has(key)) {
         bundles.set(key, {
           key,
           sourceCardId: b.sourceCardId,
           typeId: b.typeId,
           tribBandIdx: band,
           sourceDot: b.sourceDot,
           consumers: [],
           railLane: 0,
           range: [b.sourceDot.x, b.sourceDot.x],
         });
       }
       const bundle = bundles.get(key)!;
       bundle.consumers.push({ consumerCardId: b.consumerCardId, consumerDot: b.consumerDot });
       bundle.range[0] = Math.min(bundle.range[0], b.consumerDot.x);
       bundle.range[1] = Math.max(bundle.range[1], b.consumerDot.x);
     }

     // Assign rail lanes using the same tributary item pool for this band
     // so interval coloring places rails in non-overlapping Y positions
     // relative to any non-direct tributary segments that share the band.
     const existingTribItems = /* already-computed tributary items for this band */;
     const bundleItems = [...bundles.values()].map(bundle => ({
       bundle,
       range: bundle.range,
     }));
     // Combine with existing trib items so interval coloring is global
     const allItems = [...existingTribItems, ...bundleItems];
     assignLanes(allItems);
     for (const item of bundleItems) {
       item.bundle.railLane = (item as typeof item & { lane?: number }).lane ?? 0;
       for (const b of directBelts.filter(d => d.bundleKey === item.bundle.key)) {
         b.directRailLane = item.bundle.railLane;
       }
     }

     // Store per-gap direct rail lane count
     if (band < gapLaneCounts.length) {
       gapLaneCounts[band].directRailLanes =
         bundleItems.length > 0 ? Math.max(...bundleItems.map(i =>
           ((i as typeof i & { lane?: number }).lane ?? 0) + 1)) : 0;
     }
   }
   ```

   > **Note on shared pool:** To avoid coupling the direct-rail assignment to
   > the exact tributary data structure, the cleanest approach is a single
   > combined `assignLanes` call per band that includes both tributary items
   > (with their `[mainBusLeftX, sourceDot.x]` ranges) and bundle rail items
   > (with their `[minX, maxX]` ranges).  This guarantees coexistence without
   > Y-overlap regardless of positional relationships.

4. **Segment building block** — replace the `isDirect` branch:
   ```ts
   // Direct belts are now emitted as bundles, not per-edge.
   // Skip individual direct planned belts; bundles are emitted separately below.
   ```
   After the `planned.map(...)` loop, iterate over all computed bundles and
   emit trunk, rail, and branch `Belt` objects:
   ```ts
   for (const [, bundle] of allBundlesByBand) {
     const tribBand  = tempBandY(bundle.tribBandIdx);
     const railY     = tribBand.tribY + bundle.railLane * LANE_SPACING;
     const minX      = bundle.range[0];
     const maxX      = bundle.range[1];
     const color     = beltColor(`${bundle.sourceCardId}:${bundle.typeId}`);
     const baseId    = `${bundle.sourceCardId}:${bundle.typeId}:${bundle.tribBandIdx}`;

     // Trunk
     if (bundle.sourceDot.x !== railY) {   // only if not already on rail
       belts.push({
         id: `${baseId}:trunk`,
         color,
         typeId: bundle.typeId,
         sourceCardId: bundle.sourceCardId,
         segments: [
           { from: bundle.sourceDot, to: { x: bundle.sourceDot.x, y: railY } },
         ],
       });
     }

     // Rail (skip if trivially zero-length, e.g. single same-column consumer)
     if (maxX > minX) {
       belts.push({
         id: `${baseId}:rail`,
         color,
         typeId: bundle.typeId,
         sourceCardId: bundle.sourceCardId,
         segments: [
           { from: { x: minX, y: railY }, to: { x: maxX, y: railY } },
         ],
       });
     }

     // Branches
     for (const consumer of bundle.consumers) {
       if (consumer.consumerDot.y === railY) continue; // already at rail height
       belts.push({
         id: `${bundle.sourceCardId}:${bundle.typeId}:${consumer.consumerCardId}:branch`,
         color,
         typeId: bundle.typeId,
         sourceCardId: bundle.sourceCardId,
         segments: [
           { from: { x: consumer.consumerDot.x, y: railY }, to: consumer.consumerDot },
         ],
       });
     }
   }
   ```

5. **`gapLaneCounts` initialisation** — add `directRailLanes: 0` to the
   initial per-gap record.

### `web/src/components/forge/canvas/BuildCanvas.tsx`

- **Gap height formula** — wherever `gapLaneCounts[i].tributaryLanes` and
  `offshootLanes` contribute to the gap height calculation, add
  `directRailLanes` to ensure enough vertical space.

- **Edge index / dimming** — no changes needed.  The bundle belts all carry the
  same `sourceCardId`, so the existing focus/dim logic already groups them
  correctly.

---

## Out of scope

- Non-adjacent (multi-row) belt routing — unchanged.
- Main bus layout, tributary/offshoot lanes for non-direct belts — unchanged.
- Belt color palette — unchanged.
- Single-consumer same-column case already degenerates cleanly (trunk only,
  zero-length rail and branch omitted).
