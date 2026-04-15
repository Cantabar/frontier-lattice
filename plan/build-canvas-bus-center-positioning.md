# [frontier-corm][web] Build Canvas: Center Bus Positioning in Inter-Layer Gap

## Goal

Move the tributary bus (left-going horizontal runs) and offshoot bus (right-going horizontal runs) from their current positions near the card edges to the **center of the gap between layers**. This gives a clear visual pause between the belt leaving a card and joining the bus, making joins/leaves immediately legible.

## Current Behavior

The 140px gap between rows (`ROW_SLOT_HEIGHT 340 − ESTIMATED_CARD_HEIGHT 200`) is divided as follows:

```
consumer card bottom ─────────────────────────────────────────
  [offshoot bus, 6px below card]   ← barely visible gap
  ...120px of empty space...
  [tributary bus, 6px above card]  ← barely visible gap
source card top ──────────────────────────────────────────────
```

Both buses sit within 6px of the adjacent card (`BAND_EDGE_PAD = 6`), leaving most of the gap unused and making it hard to see where belts enter or leave the bus.

## Desired Behavior

```
consumer card bottom ─────────────────────────────────────────
  ...~67px of clear space...
  [offshoot bus, 3px above midpoint]  ← center of gap
  [tributary bus, 3px below midpoint] ← center of gap
  ...~67px of clear space...
source card top ──────────────────────────────────────────────
```

Both buses anchored at the midpoint of the gap, with a `TRIB_OFFSHOOT_GAP / 2 = 3px` split above/below center. Additional lanes spread **outward** from center (toward the nearest card), so multi-lane builds stay separated without crossing.

## Affected File

**`web/src/lib/canvasBusRouter.ts`** — three targeted edits:

---

## Changes

### 1. `tempBandY` — anchor at gap midpoint (lines 306–315)

**Current:**
```typescript
const bandBottomY = rowBounds[bandIdx].top;           // source's card top
const bandTopY = rowBounds[bandIdx + 1].bottom;       // consumer's card bottom
// tributary near bottom of band (close to source below)
// offshoot near top of band (close to consumer above)
return { tribY: bandBottomY - BAND_EDGE_PAD, offshootY: bandTopY + BAND_EDGE_PAD };
```

**New:**
```typescript
const bandBottomY = rowBounds[bandIdx].top;           // source's card top (larger y)
const bandTopY = rowBounds[bandIdx + 1].bottom;       // consumer's card bottom (smaller y)
const midY = (bandTopY + bandBottomY) / 2;
// Both buses anchor at gap centre; lanes spread outward toward their nearest card.
return { tribY: midY + TRIB_OFFSHOOT_GAP / 2, offshootY: midY - TRIB_OFFSHOOT_GAP / 2 };
```

This is the only place both anchor Y values are computed. All downstream Y calculations derive from these two values.

---

### 2. Non-direct belt stacking — reverse direction (lines 367–371)

Stacking must now spread **outward** (away from center) so the two groups never cross:

**Current:**
```typescript
// tributary lanes stack DOWNWARD from bandBottom edge,
// offshoot lanes stack UPWARD from bandTop edge.
const tributaryY = tribBand.tribY - b.tribLane * LANE_SPACING;
const offshootY  = offshootBand.offshootY + b.offshootLane * LANE_SPACING;
```

**New:**
```typescript
// tributary lanes stack DOWNWARD from centre (toward source card),
// offshoot lanes stack UPWARD from centre (toward consumer card).
const tributaryY = tribBand.tribY    + b.tribLane     * LANE_SPACING;
const offshootY  = offshootBand.offshootY - b.offshootLane * LANE_SPACING;
```

Lane 0 lands at center; lane N lands N×3px outward. No tributary/offshoot crossing is possible because they diverge from center.

---

### 3. Direct belt stacking — reverse direction (lines 347–360)

Direct routes (adjacent rows, no main bus) use the same band anchors for their turn Y. Mirror the same direction reversal:

**Current:**
```typescript
// left-going
const turnY = tribBand.tribY - b.directLeftLane * LANE_SPACING;
// right-going
const turnY = offshootBand.offshootY + b.directRightLane * LANE_SPACING;
```

**New:**
```typescript
// left-going (turn at tribute band centre, spreads downward)
const turnY = tribBand.tribY + b.directLeftLane * LANE_SPACING;
// right-going (turn at offshoot band centre, spreads upward)
const turnY = offshootBand.offshootY - b.directRightLane * LANE_SPACING;
```

---

## Why This Works Without Other Changes

- **Main bus range** (`range: [offshootY, tribY]` at line 324) still has `offshootY < tribY` because `midY - 3 < midY + 3`. Lane assignment logic is unchanged. ✓
- **Tributary/offshoot lane assignment** (lines 230–260) uses X-ranges (horizontal span), not Y. Unaffected. ✓
- **Direct lane assignment** (lines 272–297) similarly uses X-ranges. Unaffected. ✓
- **`BAND_EDGE_PAD`** is no longer used by `tempBandY`. It can be left in place or removed — leave it for now since its value is still meaningful as documentation of the prior approach.

## Verification

After implementing, open Forge Planner with a multi-layer build (e.g. anything with 3+ rows) and confirm:

1. Tributary bus (left-going horizontal segments) appears visually centered between layers, not hugging the source cards.
2. Offshoot bus (right-going horizontal segments) appears visually centered between layers, not hugging the consumer cards.
3. Belts have a long clear vertical run from the card to the bus before turning.
4. Multi-lane builds (multiple belts in same gap) fan out from center toward cards, never crossing.
5. Adjacent-row (direct) belts also turn in the center of the gap.
