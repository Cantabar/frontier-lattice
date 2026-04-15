# [frontier-corm][web] Build Canvas Bus-Routed Edges

Replace the bezier-curve edges between blueprint cards with an orthogonal
**main bus + tributary + offshoot** manifold system, and fix a missing-edge
bug that drops the Hydrocarbon Residue flow off the Feldspar Crystals card.

## Scope

1. Diagnose and fix: Feldspar Crystals' 89258 (Hydrocarbon Residue) output
   not rendering an edge to the Hydrocarbon Residue blueprint card above it.
2. Replace bezier SVG paths with a bus-based belt routing system.
3. 90-degree turns only, no diagonal segments.
4. Each belt gets a unique color (distinct from other belts, tier colors,
   SSU cyan, mining amber).
5. 3-pixel spacing between belts in any shared bus; no overlaps.

## Part A — The missing-edge bug

### Hypothesis

The bug most likely lives in one of two places in `buildCanvasLayout.ts`:

**H1. Byproduct post-walk picks the wrong source card.**

```typescript
const sourceInfo = bpInfos.find((b) => b.allOutputs.has(typeId));
```

`find` returns the *first* card whose `allOutputs` contains the typeId. When
the chain has two cards that both list 89258 as an output (e.g. a Feldspar
Crystals card and a Hydrated Sulfide Matrix card), we pick arbitrarily.
The byproduct-satisfied 89258 node's edge may be routed to a card that
*also* produces 89258 but isn't the one that credited the inventory.
Result: the other card's primary-output edge to Hydrocarbon Residue is
effectively shadowed (or duplicated in a way that dedup drops the wrong one).

**H2. Craftable-path edge is dropped during merge when walk order reverses.**

When the walk encounters the 89259 reoriented recipe *first* (creates
`bp-Feldspar1` with `allOutputs = {89259, 89258}`), and 89258 later arrives
as a byproduct consumer, the post-walk `find` correctly hits `bp-Feldspar1`.
But the *primary* 89258 edge was never pushed by walk (the node was
`satisfiedFromInventory=true`, took the byproduct path). No direct edge from
`bp-Feldspar1:out:89258` to the primary consumer is created — instead the
edge goes to the `BP-HydroResidue` card via the byproduct post-walk.
This *should* work, but if `BP-HydroResidue`'s card id ends up matching a
byproduct-consumers entry for a different typeId, edges collide on dedup.

### Investigation steps

1. Add a dev-only `console.log` in `buildCanvasLayout` that prints:
   - All `bpInfos` entries with `id`, `blueprintId`, `allOutputs` keys.
   - All `rawEdges` before dedup.
   - Final `layout.edges`.
2. Reproduce: pick a build chain that creates Feldspar + Hydrocarbon Residue
   + Silica Grains together (e.g. Thermal Composites or Printed Circuits).
3. Compare expected edges vs actual. Narrow to H1 or H2.

### Candidate fixes

- **For H1**: track `byproductProducerId: Map<typeId, bpInfoId>` during walk
  — set to the id of the card whose resolution *credited* this typeId as a
  byproduct. Use that map (not `bpInfos.find`) in post-walk.
- **For H2**: when a node takes the byproduct-consumer path, also ensure any
  *craftable-occurrence* edges for the same typeId are preserved by
  recording the edge as `{fromId: sourceBp, fromTypeId, toId: parentId}`
  deterministically.

Fix pick: implement producer tracking (H1). It also fixes the "multiple
arrows from multi-output blueprint" issue since we'll know the real
producer per typeId.

## Part B — Bus-based belt routing

### Visual model

```
  ┌─────────┐
  │  Root   │              (top row)
  └────▲────┘
       │  belt-A
  ═════╪═══ offshoot bus @ root level ═══════════════════▶
       │                                              (row N+0.5)
       │
  ║    │                                                       main bus
  ║◀═══╪═══ tributary bus @ row N-1.5                          (left side,
  ║                                                             runs full
  ║       ┌──────────┐   ┌──────────┐                          height)
  ║       │ Intrm 1  │   │ Intrm 2  │                (row N-1)
  ║       └────▲─────┘   └────▲─────┘
  ║            │ b-B          │ b-C
  ║════════════╪══════════════╪══ tributary bus @ row N-1.5 ══▶
  ║◀═══════════╪══════════════╪═══ enters main bus on the left
  ║            │              │
  ║       ┌────┴────────┐ ┌───┴─────────┐
  ║       │ Feldspar    │ │ HydSulMat   │          (row N-2)
  ║       └─┬─┬─────────┘ └─┬───────────┘
  ║       b-D b-E           b-F
  ║═══════╪═╪═══════════════╪═══ tributary bus ═══════════▶
  ║◀══════╪═╪═══════════════╪═══
  ║
  [Mining row]                                      (row 0)
```

Key concepts:

- **Main bus** — single vertical channel on the left of the canvas content.
  Every belt that flows upward between rows passes through it. Belts enter
  from the right (tributary) and exit on the right (offshoot).
- **Tributary bus** — a horizontal channel between two rows. Carries belts
  from the cards in the row *below* to the main bus on the left. Always at
  y = (row_top_below - row_bottom_above) / 2, i.e. mid-gap between rows.
- **Offshoot bus** — another horizontal channel at the *same mid-gap y* that
  carries belts from the main bus back to the right, delivering them to the
  cards above. Tributary and offshoot share the mid-gap horizontal band but
  use separate lanes.
- **Belt** — one material flow, identified by `(sourceCardId, typeId)`.
  A belt consists of 5 orthogonal segments:
  1. Vertical up from source card's output dot to the tributary y-band.
  2. Horizontal left along tributary bus until it reaches main bus x.
  3. Vertical up along main bus from source tributary y to consumer offshoot y.
  4. Horizontal right along offshoot bus until it reaches consumer's x.
  5. Vertical down from offshoot y to consumer card's input dot.

### Data model

```ts
type Point = { x: number; y: number };
type OrthoSegment = { from: Point; to: Point };  // axis-aligned

interface Belt {
  id: string;                  // `${sourceCardId}:${typeId}` stable
  color: string;
  typeId: number;
  sourceCardId: string;
  consumerCardId: string;
  segments: OrthoSegment[];    // length 5 for full route, fewer when
                               // source/consumer share a row neighborhood
}
```

### Lane allocation

Each shared bus has lanes:

- **Main bus lanes**: vertical stripes. Each belt passing through the main
  bus gets one lane. Lane `i` is at `mainBusX + i * 3px`.
- **Tributary lanes**: horizontal stripes. Between row *r* and *r+1*, all
  belts originating from cards in row *r* share this bus. Lane `i` is at
  `tributaryY + i * 3px` (downward from top of the band).
- **Offshoot lanes**: horizontal stripes *in the same band* as tributaries
  but offset downward so they don't collide. Lane `i` is at
  `tributaryY + (tribCount + i) * 3px`.

Lane assignment order: deterministic by `sortIndex(belt) = (sourceCol, typeId)`
so belt layout is stable across renders.

**Lane width**: 3px between parallel belts. Stroke width 1.5px. So center-
to-center spacing is 3px; visually the band between two belts is 1.5px of
background.

The mid-gap vertical band between rows must be sized to fit:
`neededBandHeight = (maxTribLanes + maxOffshootLanes + 1) * 3px`.
Compare against current `ROW_SLOT_HEIGHT` minus card height; grow gap if
needed (adjust `ROW_SLOT_HEIGHT`).

### Routing algorithm

```
for each edge in layout.edges:
    belt = { id: edge.fromCardId + ':' + edge.fromTypeId, ... }

    srcDot = dotPositions[edge.fromCardId + ':out:' + edge.fromTypeId]
    dstDot = dotPositions[edge.toCardId   + ':in:'  + edge.toTypeId]

    srcRow = cardRow(edge.fromCardId)
    dstRow = cardRow(edge.toCardId)

    tribY      = rowTop(srcRow) - midGap/2 + tribLane(belt) * 3
    offshootY  = rowTop(dstRow) + cardHeight(dstRow) + midGap/2 + offshootLane(belt) * 3
    // (offshoot band sits just BELOW the destination row; tributary band sits
    //  just ABOVE the source row)

    mainLaneX  = mainBusX + mainLane(belt) * 3

    belt.segments = [
        { from: srcDot,                    to: {x: srcDot.x, y: tribY} },  // vertical up
        { from: {x: srcDot.x, y: tribY},   to: {x: mainLaneX, y: tribY} }, // horizontal left
        { from: {x: mainLaneX, y: tribY},  to: {x: mainLaneX, y: offshootY} }, // vertical up on main
        { from: {x: mainLaneX, y: offshootY}, to: {x: dstDot.x, y: offshootY} }, // horizontal right
        { from: {x: dstDot.x, y: offshootY}, to: dstDot },                  // vertical down
    ]
```

Special case: when `srcRow + 1 === dstRow` (adjacent rows), the tributary
and offshoot merge into one band — just two segments: up-to-band then
horizontal, then down-to-target. No main-bus traversal.

Wait: even for adjacent rows, the user wants *everything* to route through
the main bus (consistent visual language). Decision: always route through
main bus, even for adjacent rows. Visually more uniform.

### Color assignment

Pick from a distinct-color palette and cycle by stable `belt.id`:

```ts
const BELT_PALETTE = [
  "#FF6B6B", "#4ECDC4", "#A78BFA", "#F59E0B", "#10B981",
  "#3B82F6", "#EC4899", "#14B8A6", "#F97316", "#8B5CF6",
  "#06B6D4", "#EAB308", "#F43F5E", "#6366F1", "#22C55E",
  "#D946EF", "#84CC16", "#0EA5E9", "#A855F7", "#EF4444",
];
function beltColor(beltId: string): string {
  let h = 0; for (const c of beltId) h = (h * 31 + c.charCodeAt(0)) | 0;
  return BELT_PALETTE[Math.abs(h) % BELT_PALETTE.length];
}
```

Must avoid clashing with tier border colors (`#666666`, `#b0b0b0`, `#4caf50`,
`#42a5f5`, `#ab47bc`, `#ffd740`) — none of the palette matches exactly.
Must also avoid `#00E5FF` (SSU) and `#FFD740` (mining amber). `#FFD740` is
close to the Exotic tier — `#F59E0B` in the palette is a different amber;
keep it.

### Layout constant adjustments

Likely need to widen `CANVAS_PAD` on the left to accommodate the main bus:
`CANVAS_PAD_LEFT = 100 + mainBusLanes * 3 + 20`.

Row gap must fit the mid-gap band:
`ROW_SLOT_HEIGHT = cardRowHeight + midGapHeight` where `midGapHeight =
max(60, (tribLanes + offshootLanes + 2) * 3 + 20)`.

### Edge rendering

Replace the `<path d="M ... C ...">` with per-belt `<polyline>` elements:

```tsx
{belts.map((belt) => (
  <polyline
    key={belt.id}
    points={belt.segments.flatMap(s => [`${s.from.x},${s.from.y}`, `${s.to.x},${s.to.y}`]).join(' ')}
    stroke={belt.color}
    strokeWidth={1.5}
    strokeOpacity={0.85}
    fill="none"
  />
))}
```

## Implementation order

1. **Diagnose + fix the Hydrocarbon Residue bug.**
   - Add producer-tracking map in `buildCanvasLayout.ts`.
   - Log bpInfos and edges once while debugging, then strip the log.
   - Commit: `fix(web): route byproduct edges from their actual producer`.
2. **Extract edge routing from `BuildCanvas.tsx` into a new helper**
   `web/src/lib/canvasBusRouter.ts` with a pure function
   `routeEdges(edges, cards, dotPositions, dims) -> Belt[]`.
3. **Implement lane allocation + routing.**
4. **Implement palette color assignment.**
5. **Swap `svgPaths` in `BuildCanvas.tsx`** to render belts (polylines).
6. **Adjust `ROW_SLOT_HEIGHT` and `CANVAS_PAD`** to accommodate the main
   bus and mid-gap band widths, computed from lane counts.
7. **Visual QA**: field + base routes, SSU on/off, multi-output blueprints,
   deeply nested chains (Thermal Composites, a T3 weapon, etc.). Verify:
   - No belt overlaps in main, tributary, or offshoot buses.
   - Every edge in `layout.edges` has a visible belt.
   - Multi-output blueprints show distinct belts per output, each colored.
   - Colors stable across re-renders (same `belt.id`).

## Risks / open questions

- **Lane count growth**: complex chains could require 30+ main-bus lanes
  (~90px). Acceptable; pan/zoom handles it.
- **Crossing belts in offshoot bus**: if belt A enters offshoot at x=500
  and consumes at x=200, but belt B enters at x=300 and consumes at x=400,
  they cross. Options: (a) accept crossings, they're visually fine with
  distinct colors; (b) per-offshoot lane assignment that avoids crossings
  (order belts by consumer.x). Pick (a) first — optimize only if needed.
- **Port hover tooltips**: unchanged; still on dots.
- **Edge dedup by `(fromCardId, fromTypeId, toCardId)`** already exists in
  `buildCanvasLayout`; belts inherit that.
