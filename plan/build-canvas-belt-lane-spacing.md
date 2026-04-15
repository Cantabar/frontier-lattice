# [frontier-corm][web] Build Canvas Belt Lane Spacing

## Goal

Increase the gap between adjacent belt lanes so there is approximately half a belt width of clear space between each belt, making individual belts legible at a glance and reducing visual clutter in dense areas like the main bus.

---

## Current state

After the depth-casing plan, each belt is drawn as:
- **Casing:** `strokeWidth=5`, color `#111111`
- **Fill:** `strokeWidth=3`, belt palette color

`LANE_SPACING = 3` means lanes are currently 3px apart center-to-center.  
5px casing width − 3px spacing = **2px overlap** — adjacent casings visually merge into a solid block.

---

## Target

"Half a belt width between each belt" = half the casing width (5px ÷ 2 = 2.5px) of clear space between casing edges.

```
center-to-center spacing = casing width + gap
                         = 5px + 2.5px
                         = 7.5px → round up to 8px
```

At `LANE_SPACING = 8`:
- Edge-to-edge gap between casings: 8 − 5 = **3px clear**  
- Belt fill (3px) is centered inside its 5px casing with 1px dark border each side — that border is now visible as true separation rather than overlap.

---

## Implementation Plan

### Step 1 — Update `LANE_SPACING`  
**File:** `web/src/lib/canvasBusRouter.ts` (line 75)

```ts
// before
export const LANE_SPACING = 3;

// after
export const LANE_SPACING = 8;
```

`LANE_SPACING` is used in five places in the router — all as a multiplier of lane index. The single constant change affects:

| Usage | Effect |
|-------|--------|
| `mainX = mainBusLeftX + b.mainBusLane * LANE_SPACING` | Main bus lanes spread wider |
| `tributaryY = tribBand.tribY + b.tribLane * LANE_SPACING` | Tributary fan-out spreads wider |
| `offshootY = offshootBand.offshootY - b.offshootLane * LANE_SPACING` | Offshoot fan-out spreads wider |
| `turnY = tribBand.tribY + b.directLeftLane * LANE_SPACING` | Direct-left turns spread wider |
| `turnY = offshootBand.offshootY - b.directRightLane * LANE_SPACING` | Direct-right turns spread wider |

### Step 2 — Update the `MAIN_BUS_RESERVED_WIDTH` comment  
**File:** `web/src/components/forge/canvas/BuildCanvas.tsx` (line 35)

The comment currently reads `"Up to ~26 lanes fit in 80px at 3px lane spacing"`. Update to reflect the new spacing:

```ts
/** Reserved horizontal width for the main bus + clearance from cards.
 *  Up to ~12 lanes fit in 100px at 8px lane spacing. */
const MAIN_BUS_RESERVED_WIDTH = 100;
```

The reserved width itself (100px) stays the same — it is wide enough for typical forge plans. Very complex builds with >12 main-bus lanes would push into card territory, but that was also a concern at 3px spacing for >26 lanes and has not been observed in practice.

---

## Files Touched

| File | Change |
|------|--------|
| `lib/canvasBusRouter.ts` | `LANE_SPACING`: 3 → 8 |
| `canvas/BuildCanvas.tsx` | Update `MAIN_BUS_RESERVED_WIDTH` comment only |

No changes to routing logic, layout engine, card components, or ForgePlanner.

---

## Edge Cases

- **Dense main bus (many belts):** at 8px spacing the bus is ~2.7× wider per lane than before. `MAIN_BUS_RESERVED_WIDTH = 100` accommodates ~12 lanes before crowding cards. If a specific build exceeds this, the fix is to increase `MAIN_BUS_RESERVED_WIDTH` (and correspondingly `CANVAS_PAD_LEFT`) — a separate concern.
- **Band height:** `ROW_SLOT_HEIGHT = 340` provides ~140px of mid-gap band between cards. At 8px spacing, 17 tributary + 17 offshoot lanes fit before the band is consumed. This exceeds any realistic forge plan.
- **Direct belts:** same spacing applies, giving the same visual breathing room in adjacent-row connections.
