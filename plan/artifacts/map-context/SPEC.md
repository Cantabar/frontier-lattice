# Spec: MapContext Refactor

## Problem

The map overlay system (star color changes, glow mode) produces no visible output. Root cause is two competing `useEffect` hooks in `SolarSystemPoints` with identical dependency arrays writing to the same GPU buffer through shared mutable ref state. See `DISCOVERY.md`.

---

## Solution Overview

Introduce a `MapContext` React context that:
1. Owns all map screen state in one place
2. Exposes `finalStarColors` — the single, fully-composited color buffer — as a derived value
3. Eliminates prop-drilling through `GalaxyMap`
4. Reduces `SolarSystemPoints` to a one-effect GPU sync component

---

## New File: `web/src/contexts/MapContext.tsx`

### State owned by context

| Field | Type | Source |
|---|---|---|
| `selectedId` | `number \| null` | `useState` |
| `setSelectedId` | `(id: number \| null) => void` | `useState` setter |
| `overlayConfig` | `OverlayConfig \| null` | `useState` |
| `setOverlayConfig` | `(cfg: OverlayConfig \| null) => void` | `useState` setter |
| `sidebarTab` | `'system' \| 'overlays'` | `useState` |
| `setSidebarTab` | `(tab: 'system' \| 'overlays') => void` | `useState` setter |
| `pods` | `DecryptedPod[]` | `useLocationPods()` |
| `positions` | `Float32Array` | `useMemo(() => buildGalaxyBuffer(...), [])` |
| `ids` | `number[]` | `useMemo(() => buildGalaxyBuffer(...), [])` |
| `idToIndex` | `Map<number, number>` | `useMemo(() => buildGalaxyBuffer(...), [])` |

### Derived values (all `useMemo`)

**`overlayColors: Float32Array | null`**
- Sourced from `useOverlayColors({ overlayConfig, ids, pods })`
- Null when no overlay is active or mode is `densityGradient`

**`glowMask: Float32Array | null`**
- Sourced from `useOverlayColors`
- Non-null only when `overlayConfig.mode === 'glow'`

**`densityMask: Float32Array | null`**
- Sourced from `useOverlayColors`
- Non-null only when `overlayConfig.mode === 'densityGradient'`

**`finalStarColors: Float32Array`**
- The single source of truth for every star's RGB on screen
- Derived as: `useMemo(() => { copy overlayColors (or fill white); overwrite selected star with gold }, [overlayColors, selectedId, idToIndex])`
- Always non-null — defaults to all-white when no overlay is active
- A new Float32Array is allocated on each recomputation (~288 KB; acceptable at this call frequency)

### Gold highlight constants (defined inside context module, not exported)

```
GOLD = [1, 0.84, 0]
WHITE fill = 1.0
```

### Exports

```typescript
export const MapContext = React.createContext<MapContextValue>(...)
export function MapProvider({ children }: { children: ReactNode }): JSX.Element
export function useMapContext(): MapContextValue   // throws if used outside provider
```

---

## Modified Files

### `web/src/pages/MapPage.tsx`

**Before:** owns `selectedSystemId`, `overlayConfig` state; calls `useLocationPods`, `useOverlayColors`; prop-drills everything through `GalaxyMap`.

**After:** mounts `<MapProvider>` wrapping `<MapPageInner>`. All state and hooks move into the context. `MapPage` becomes:

```tsx
export function MapPage() {
  return (
    <MapProvider>
      <MapPageInner />
    </MapProvider>
  );
}
```

`MapPageInner` reads from context for the few things it still composes (sidebar tab state, layout).

`sidebarTab` state lives in the context alongside the other map state.

---

### `web/src/components/map/GalaxyMap.tsx`

**Remove props:** `overlayColors`, `selectedId`, `onSelect`, `idToIndex` (all now consumed from context by the children directly or via `GalaxyMap` reading context).

**Remaining props:** `sceneOverlays?: ReactNode`, `hudOverlays?: ReactNode` — kept for structural composition.

`GalaxyMap` reads `positions` from context for the `<Canvas>` camera and orbit setup. It no longer passes data props to `SolarSystemPoints`.

---

### `web/src/components/map/SolarSystemPoints.tsx`

**Remove all props.** Reads everything from `useMapContext()`.

**Replace two competing effects with:**

1. One `useEffect([finalStarColors])`:
   ```
   buf.set(finalStarColors)
   colorAttr.needsUpdate = true
   ```
   Single responsibility: sync the derived buffer to the GPU. No selection logic. No restoreColor bookkeeping.

2. Raycaster threshold effect unchanged — `useEffect(() => { raycaster.params.Points = { threshold: 50 }; }, [raycaster])`.

No `prevIdRef`, no `restoreColorRef`, no `GOLD` constant, no `WHITE` constant — all gold highlight logic lives in the context's `finalStarColors` derivation.

---

### `web/src/components/map/GlowLayer.tsx`

**Remove all props.** Reads `positions`, `glowMask`, and uses `ACCENT_COLOR` from `overlayPalette` directly.

The component only renders when `glowMask` is non-null (caller is responsible for conditional render).

---

### `web/src/components/map/DensityGradientLayer.tsx`

**Remove all props.** Reads `positions`, `densityMask`, and uses `ACCENT_COLOR` from `overlayPalette` directly.

---

### `web/src/components/map/OverlayPanel.tsx`

**Remove `overlayConfig`, `onChange`, `pods` props.** Reads `overlayConfig`, `setOverlayConfig`, `pods` from `useMapContext()`.

---

### `web/src/components/map/SystemInfoPanel.tsx`

No change — already receives `selectedSystemId` as a prop from `MapPageInner`. Keeping as-is avoids making a presentational component depend on context.

---

## Component Tree (after)

```
MapPage
└── MapProvider  (owns all state + derivations)
    └── MapPageInner
        ├── CanvasArea
        │   └── GalaxyMap  (reads positions from context; structural wrapper)
        │       └── Canvas
        │           ├── SolarSystemPoints  (reads finalStarColors, ids, positions from context)
        │           ├── SelectionIndicator (reads selectedId, positions, idToIndex from context)
        │           ├── CameraController   (reads selectedId, positions, idToIndex from context)
        │           ├── [GlowLayer]        (reads glowMask, positions from context; rendered conditionally)
        │           └── [DensityGradientLayer] (reads densityMask, positions from context; rendered conditionally)
        └── InfoSidebar
            ├── [SystemInfoPanel]  (prop: selectedSystemId from MapPageInner)
            └── [OverlayPanel]     (reads/writes overlayConfig, pods from context)
```

Note: `SelectionIndicator` and `CameraController` already receive `positions`, `idToIndex`, `selectedId` as props from `GalaxyMap`. These should also migrate to reading from context, removing `GalaxyMap`'s role as a data pipe entirely.

---

## Data Flow (after)

```
User selects filter
  → setOverlayConfig (context)
  → useOverlayColors recomputes → overlayColors (Float32Array)
  → finalStarColors recomputes (useMemo) → new Float32Array with overlay colors
  → SolarSystemPoints useEffect fires → buf.set(finalStarColors) → needsUpdate=true
  → Three.js re-uploads buffer → GPU → visible star colors ✓

User clicks a star
  → setSelectedId (context)
  → finalStarColors recomputes (useMemo) → overlay colors + gold at selected index
  → SolarSystemPoints useEffect fires → buf.set(finalStarColors) → needsUpdate=true
  → GPU → gold highlight visible ✓

User deselects (clicks again or selects None)
  → setSelectedId(null)
  → finalStarColors recomputes → overlay colors only, no gold
  → GPU → gold removed ✓
```

---

## Definition of Done

### Correctness
- [ ] Selecting any overlay filter immediately changes star colors (visible within one frame)
- [ ] Selecting a star while an overlay is active shows gold highlight; all other stars retain their overlay color
- [ ] Deselecting a star restores the correct overlay color (not white) to the previously highlighted star
- [ ] Switching overlay filters while a star is selected correctly updates all star colors including the selected one
- [ ] Deactivating the overlay (selecting "None") restores all stars to white
- [ ] Glow mode renders the `GlowLayer` additive overlay; density gradient mode renders the cloud layer

### Regression
- [ ] The System tab continues to show correct system info for the selected star
- [ ] The gold selection ring (`SelectionIndicator`) still appears on the selected star
- [ ] Camera fly-to on star click still works
- [ ] No TypeScript errors (`npx tsc --noEmit` passes)
- [ ] All 83 existing tests pass (`npx vitest run`)

### Architecture
- [ ] `SolarSystemPoints` has exactly one `useEffect` for the color buffer (plus the raycaster threshold effect)
- [ ] No `restoreColorRef`, `prevIdRef`, or `GOLD`/`WHITE` constants in `SolarSystemPoints`
- [ ] `GalaxyMap` passes no overlay or selection props to its children (all consumed from context)
