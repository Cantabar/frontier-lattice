# [frontier-corm][web] Build Canvas Belt Depth Casing

## Goal

Add a dark border/outline around each belt polyline so that crossings between belts read as "over / under" — the belt on top will have its dark casing visible over the colored fill of the belt beneath it.

---

## Design

### Visual behaviour

Each belt is rendered as two stacked polylines (casing technique, standard in map rendering):

1. **Casing (pass 1):** `strokeWidth=5`, color `#111111` at the same opacity as the belt fill.
2. **Fill (pass 2):** `strokeWidth=3`, the belt's color at the same opacity.

By rendering **all casings before all fills**, wherever belt A's fill passes over belt B the dark casing of A is drawn on top of B's colored fill, creating a clear visual separation that reads as depth. No explicit Z-order data is required from the router — the effect emerges from consistent render ordering.

```
Belt B:  ──────────────────────────────────────────  (wide dark casing + colored fill)
Belt A:          ╔══════════╗                        (casing on top of B's fill here)
                 ║          ║
```

### Dimming (focused card)

The existing `strokeOpacity` logic (`dimBelt ? 0.08 : 0.85`) applies identically to both the casing and fill polylines so they dim together.

---

## Implementation Plan

### Step 1 — Two-pass `beltElements`  
**File:** `web/src/components/forge/canvas/BuildCanvas.tsx` (lines 465–491)

Replace the single `belts.map(...)` in the `beltElements` useMemo with two arrays — one for casings, one for fills — then render casings first inside the SVG.

```tsx
const beltElements = useMemo(() => {
  const casings: React.ReactElement[] = [];
  const fills: React.ReactElement[] = [];

  for (const belt of belts) {
    if (belt.segments.length === 0) continue;

    const pts: string[] = [];
    pts.push(`${belt.segments[0].from.x},${belt.segments[0].from.y}`);
    for (const seg of belt.segments) {
      pts.push(`${seg.to.x},${seg.to.y}`);
    }
    const pointsStr = pts.join(" ");
    const dimBelt = connectedBeltIds !== null && !connectedBeltIds.has(belt.id);
    const opacity = dimBelt ? 0.08 : 0.85;

    const sharedProps = {
      points: pointsStr,
      fill: "none" as const,
      strokeLinecap: "square" as const,
      strokeLinejoin: "miter" as const,
      style: { transition: "stroke-opacity 0.15s ease" },
    };

    // Pass 1 — casing (dark outline, wider)
    casings.push(
      <polyline
        key={`${belt.id}:casing`}
        {...sharedProps}
        stroke="#111111"
        strokeWidth={5}
        strokeOpacity={opacity}
      />
    );

    // Pass 2 — colored fill
    fills.push(
      <polyline
        key={`${belt.id}:fill`}
        {...sharedProps}
        stroke={belt.color}
        strokeWidth={3}
        strokeOpacity={opacity}
      />
    );
  }

  return [...casings, ...fills];
}, [belts, connectedBeltIds]);
```

No changes to the JSX render — `{beltElements}` already sits inside `<EdgeSvg>` and SVG renders elements in document order (later = on top), so all fills will paint over all casings automatically.

---

## Files Touched

| File | Change |
|------|--------|
| `canvas/BuildCanvas.tsx` | Split `beltElements` into two passes: dark casings then colored fills |

No changes to the router, layout engine, card components, or ForgePlanner.

---

## Visual parameters

| Property | Casing | Fill |
|----------|--------|------|
| `strokeWidth` | 5px | 3px |
| `stroke` | `#111111` | belt palette color |
| `strokeOpacity` | same as fill (0.08 or 0.85) | 0.08 (dimmed) / 0.85 (normal) |
| `strokeLinecap` | `square` | `square` |
| `strokeLinejoin` | `miter` | `miter` |

The 1px bleed on each side (5px − 3px = 2px total, 1px per side) gives a thin but clear dark border that communicates layering without visually cluttering the canvas.

---

## Edge Cases

- **Dimmed belts:** casing and fill dim together — the border is still present at low opacity to preserve spatial structure.
- **Same-segment belts (no crossing):** each belt still gets a subtle dark border, which improves legibility even where no crossing occurs.
- **Dense main bus area:** belts in the main bus (vertical channel) are tightly packed at 3px lane spacing. The 5px casing will visually merge adjacent casings together; this is acceptable and actually helps the bus read as a bundled channel rather than separate lines.
- **Performance:** no change to belt count or router; just doubles SVG element count. At typical plan sizes (< 100 belts) this is negligible.
