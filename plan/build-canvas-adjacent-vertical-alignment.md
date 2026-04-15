# [frontier-corm][web] Build Canvas: Vertical Alignment for Adjacent Input/Output Pairs

## Goal

When a source card's output connects to a consumer card's input and both are in adjacent rows,
position the source card directly below the consumer card (same center X), producing a straight
vertical belt instead of an L-shaped jog.

When a consumer has **multiple** inputs from the adjacent row below, pick exactly **one** source
card to align vertically (the "primary" source) and let the rest use the existing routing — which
already handles L-shaped direct routing for adjacent rows with a horizontal offset.

---

## Current Behavior

Cards within each row are assigned sequential columns (0, 1, 2…) and the whole row is centered
horizontally, independent of any edge relationships between rows.  This means adjacent
source/consumer pairs almost never land at the same X, so every belt (even a straight up/down
connection) draws an L-shaped jog in the gap.

---

## Proposed Behavior

```
         ┌──────────────────┐
         │  Consumer Card   │          ← row N+1
         └────────┬─────────┘
                  │  ← straight vertical belt (primary source, aligned)
         ┌────────┴─────────┐
         │  Primary Source  │          ← row N
         └──────────────────┘

         ┌───────────────────┐
         │  Consumer Card    │          ← row N+1
         └──┬─────────────┬──┘
            │ (straight)  │ (L-shaped, bus routing)
    ┌───────┴────┐  ┌─────┴──────┐
    │  Primary   │  │ Secondary  │     ← row N
    │  Source    │  │  Source    │
    └────────────┘  └────────────┘
```

- **Primary source**: the first unchosen adjacent source for each consumer (see algorithm).
  Positioned directly below the consumer — same center X.
- **Secondary sources**: retain their own preferred positions; route via the existing
  direct-belt (L-shaped) path since they are still in the adjacent row.

---

## Primary Source Selection Algorithm

Goals: each consumer gets at most one primary source; each source aligns to at most one consumer.

```
adjacentAlignments: Map<sourceCardId, consumerCardId>  (initially empty)
primaryConsumed:    Set<consumerCardId>                 (consumers already matched)

for each row (highest row index → 0):          // top-down
  for each consumer in this row (col 0, 1, 2…):
    if consumer.id in primaryConsumed: continue

    adjacentSources = edges where
      toCardId == consumer.id
      AND fromCard.row == consumer.row - 1      // immediately below

    // deduplicate (multi-output blueprints may produce multiple edges to same consumer)
    uniqueSources = adjacentSources by fromCardId, sorted by col asc

    for source in uniqueSources:
      if source.id not in adjacentAlignments:
        adjacentAlignments[source.id] = consumer.id
        primaryConsumed.add(consumer.id)
        break                                   // one primary per consumer
```

**Why col-ascending order?** Leftmost source wins to keep the layout stable and readable.

---

## Position Computation Algorithm

Replace the current row-centering loop in `BuildCanvas.tsx` → `cardPositions` useMemo with
a two-pass computation:

### Pass 1 — Top-down: assign preferred X

Process rows from the highest index (topmost = root blueprint) downward.

- **Topmost row**: no consumers above → center the row normally.
- **All other rows**: for each card in the row:
  - If `card.id ∈ adjacentAlignments`:
    ```
    consumerPos  = positions[alignedConsumerId]
    consumerCard = cardById[alignedConsumerId]
    consumerCenterX = consumerPos.left + cardWidth(consumerCard) / 2
    preferred_left  = consumerCenterX  - cardWidth(card) / 2
    ```
  - Else: `preferred_left = null` (no preference — will be filled during packing).

### Pass 2 — Pack row with minimum spacing

Given `N` cards with preferred positions (some `null`), enforce a minimum per-card pitch of
`cardWidth + 40px` while respecting relative ordering.

1. **Sort** cards by `preferred_left` (nulls at end, maintaining original col ordering among
   nulls).
2. **Left-to-right sweep**: place card `i` at
   `max(preferred_left[i] ?? −∞, prevRight + 40)`, where `prevRight` is the right edge of
   the previously placed card.  Null-preference cards are inserted in gaps sized to keep them
   roughly centered in the remaining space.
3. **Clamp**: if the rightmost placed card would extend past `canvasWidth - CANVAS_PAD_RIGHT`,
   shift the entire row left by the overflow amount (minimum left = `CANVAS_PAD_LEFT`).
4. **Re-center offset for non-aligned rows**: if no card in the row has a preference (pure
   null), center the row as before (existing behavior preserved).

---

## Edge Cases

| Situation | Handling |
|---|---|
| Source connects to multiple consumers in the adjacent row | The first unclaimed consumer (by row/col order) wins; the source aligns there. |
| Multiple sources compete for same consumer | First source (col-ascending) wins; others get null preference. |
| Source connects only to non-adjacent consumers (skip-row edges) | `preferred_left = null` → default centering. |
| Mining / SSU cards with no adjacent consumers | `preferred_left = null` → default centering (existing behavior). |
| Aligned position would push cards off-canvas | Clamp step (Pass 2, step 3) corrects this. |
| Two aligned cards both prefer the same X (e.g. same consumer) | Sweep enforces minimum spacing; the second card is pushed right. |

---

## Files to Change

### `web/src/components/forge/canvas/BuildCanvas.tsx`

**Only the `cardPositions` useMemo** (lines ~105–141) needs to change.  All other code
(routing, rendering, pan/zoom) is unaffected.

#### What to add before the row loop

```typescript
// ── Build adjacentAlignments (sourceId → consumerId) ──────────────
const cardById = new Map<string, CanvasCard>();
for (const row of layout.rows)
  for (const card of row)
    cardById.set(card.id, card);

// Group edges by consumer; keep only adjacent-row edges.
const edgesByConsumer = new Map<string, string[]>(); // consumerId → [sourceId]
for (const edge of layout.edges) {
  const src = cardById.get(edge.fromCardId);
  const dst = cardById.get(edge.toCardId);
  if (!src || !dst || dst.row !== src.row + 1) continue;
  const arr = edgesByConsumer.get(edge.toCardId) ?? [];
  if (!arr.includes(edge.fromCardId)) arr.push(edge.fromCardId);
  edgesByConsumer.set(edge.toCardId, arr);
}

// Primary selection: process consumers top-down, col-left-to-right.
const adjacentAlignments = new Map<string, string>(); // sourceId → consumerId
const primaryConsumed = new Set<string>();

// rows are sorted ascending (0 = bottom); iterate from last (top) downward.
for (let r = layout.rows.length - 1; r >= 0; r--) {
  for (const consumer of layout.rows[r]) {
    if (primaryConsumed.has(consumer.id)) continue;
    const sources = edgesByConsumer.get(consumer.id) ?? [];
    // Sort by col order within the source row.
    const sorted = [...sources].sort((a, b) => {
      const ca = cardById.get(a);
      const cb = cardById.get(b);
      return (ca?.col ?? 0) - (cb?.col ?? 0);
    });
    for (const srcId of sorted) {
      if (!adjacentAlignments.has(srcId)) {
        adjacentAlignments.set(srcId, consumer.id);
        primaryConsumed.add(consumer.id);
        break;
      }
    }
  }
}
```

#### Revised row loop (replaces the existing simple centering loop)

```typescript
// Process rows top-down so consumer positions are known before source positions.
for (let rowIdx = layout.rows.length - 1; rowIdx >= 0; rowIdx--) {
  const row = layout.rows[rowIdx];
  const rowTop = CANVAS_PAD_TOP + (layout.totalRows - 1 - rowIdx) * ROW_SLOT_HEIGHT;
  bounds[rowIdx] = { top: rowTop, bottom: rowTop + ESTIMATED_CARD_HEIGHT };
  if (row.length === 0) continue;

  // Compute preferred left-X for each card.
  const preferred: (number | null)[] = row.map((card) => {
    const consumerId = adjacentAlignments.get(card.id);
    if (!consumerId) return null;
    const consumerPos = positions.get(consumerId);
    const consumerCard = cardById.get(consumerId);
    if (!consumerPos || !consumerCard) return null;
    const consumerCenter = consumerPos.left + cardWidth(consumerCard) / 2;
    return consumerCenter - cardWidth(card) / 2;
  });

  // Sort cards by preferred position (nulls at end, preserve original order among nulls).
  const indexed = row.map((card, i) => ({ card, origIdx: i, pref: preferred[i] }));
  indexed.sort((a, b) => {
    if (a.pref !== null && b.pref !== null) return a.pref - b.pref;
    if (a.pref !== null) return -1;
    if (b.pref !== null) return 1;
    return a.origIdx - b.origIdx;
  });

  // Left-to-right sweep: enforce minimum pitch (cardWidth + 40px gap).
  let cursor = CANVAS_PAD_LEFT;
  const placed: Array<{ card: CanvasCard; left: number }> = [];
  for (const { card, pref } of indexed) {
    const w = cardWidth(card);
    const minLeft = cursor;
    const idealLeft = pref ?? minLeft;
    const left = Math.max(idealLeft, minLeft);
    placed.push({ card, left });
    cursor = left + w + 40;
  }

  // Clamp: if rightmost card overflows, shift everything left.
  const rightmost = placed[placed.length - 1];
  const rightEdge = rightmost.left + cardWidth(rightmost.card);
  const maxRight = cw - CANVAS_PAD_RIGHT;
  if (rightEdge > maxRight) {
    const shift = rightEdge - maxRight;
    for (const p of placed) p.left = Math.max(CANVAS_PAD_LEFT, p.left - shift);
  }

  // If no card had a preference, center the row (preserves existing behavior).
  const hasAnyPreference = preferred.some((p) => p !== null);
  if (!hasAnyPreference) {
    const rw = rowPixelWidth(row);
    const availableWidth = cw - CANVAS_PAD_LEFT - CANVAS_PAD_RIGHT;
    let x = CANVAS_PAD_LEFT + Math.max(0, (availableWidth - rw) / 2);
    for (const card of row) {
      positions.set(card.id, { left: x, top: rowTop });
      x += cardWidth(card) + 40;
    }
  } else {
    for (const { card, left } of placed) {
      positions.set(card.id, { left, top: rowTop });
    }
  }
}
```

---

## No Routing Changes Required

`canvasBusRouter.ts` already handles all resulting belt shapes:

| Source/Consumer X relationship | Routing used | Result |
|---|---|---|
| `source.x === consumer.x` | `isDirect`, straight vertical | single segment, no jog |
| `source.x > consumer.x` | `isDirect`, left-going | L-jog at tributaryY |
| `source.x < consumer.x` | `isDirect`, right-going | L-jog at offshootY |
| Non-adjacent rows | Main bus (tributary → bus → offshoot) | Full 5-segment path |

---

## Verification

1. Open Forge Planner with any multi-tier build (at least 2 blueprint rows).
2. Confirm each consumer card has at least one source card positioned directly below it
   (center X matches).
3. For consumers with 2+ inputs from the adjacent row: confirm exactly one belt is a straight
   vertical and the others take L-shaped paths.
4. Confirm Mining/SSU rows (row 0/1) still center normally when they have no adjacent
   consumer (i.e. when the blueprint row above them is not row 1/2).
5. Zoom in on the gap band and confirm no belt overlap or overlap with card edges.
