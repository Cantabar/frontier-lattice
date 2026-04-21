# Design: MapContext Refactor

## Context Bridging Note

This project uses `@react-three/fiber` v9. R3F v9 explicitly bridges React context from the outer fiber tree into the Canvas inner renderer. Canvas-internal components (`SolarSystemPoints`, `GlowLayer`, etc.) can call `useMapContext()` directly — no prop-drilling through `GalaxyMap` required.

---

## File Plan

| Action | File |
|--------|------|
| **Create** | `web/src/contexts/MapContext.tsx` |
| **Modify** | `web/src/pages/MapPage.tsx` |
| **Modify** | `web/src/components/map/GalaxyMap.tsx` |
| **Modify** | `web/src/components/map/SolarSystemPoints.tsx` |
| **Modify** | `web/src/components/map/SelectionIndicator.tsx` |
| **Modify** | `web/src/components/map/CameraController.tsx` |
| **Modify** | `web/src/components/map/GlowLayer.tsx` |
| **Modify** | `web/src/components/map/DensityGradientLayer.tsx` |
| **Modify** | `web/src/components/map/OverlayPanel.tsx` |

`SystemInfoPanel` is not modified — it stays a pure presentational component receiving `selectedSystemId` as a prop from `MapPage`.

---

## `MapContext.tsx` — Full Interface

```typescript
type SidebarTab = 'system' | 'overlays';

interface MapContextValue {
  // Galaxy geometry (stable after mount)
  positions: Float32Array;
  ids: number[];
  idToIndex: Map<number, number>;

  // UI state
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;

  // Selection
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;

  // Overlay
  overlayConfig: OverlayConfig | null;
  setOverlayConfig: (cfg: OverlayConfig | null) => void;
  pods: DecryptedPod[];

  // Derived overlay outputs (from useOverlayColors)
  overlayColors: Float32Array | null;   // null → no overlay or densityGradient mode
  glowMask: Float32Array | null;         // non-null only in glow mode
  densityMask: Float32Array | null;      // non-null only in densityGradient mode

  // Final composited star colors — single source of truth for every star's RGB
  // Always non-null; encodes overlay base colors + gold highlight for selectedId
  finalStarColors: Float32Array;
}
```

### `finalStarColors` derivation

```typescript
const GOLD_R = 1, GOLD_G = 0.84, GOLD_B = 0;

const finalStarColors = useMemo<Float32Array>(() => {
  const N = ids.length;
  // Allocate a new array and fill from overlay or default white
  const buf = new Float32Array(N * 3);
  if (overlayColors) {
    buf.set(overlayColors);
  } else {
    buf.fill(1);
  }
  // Overwrite the selected star with gold
  if (selectedId !== null) {
    const idx = idToIndex.get(selectedId);
    if (idx !== undefined) {
      buf[idx * 3]     = GOLD_R;
      buf[idx * 3 + 1] = GOLD_G;
      buf[idx * 3 + 2] = GOLD_B;
    }
  }
  return buf;
}, [overlayColors, selectedId, idToIndex, ids.length]);
```

**Why allocate a new array instead of mutating:** `useMemo` must return a new reference when deps change so React detects the change and re-runs the downstream `useEffect` in `SolarSystemPoints`. Mutating in place would leave the reference unchanged and the effect would not fire.

**Performance:** `new Float32Array(N * 3)` + `.set()` for N ≈ 24,500 allocates ~288 KB and runs in < 1 ms. This is acceptable given it only fires on filter change or star click — both user-initiated, non-continuous events.

---

## Execution Order

Steps must be executed in this order since later steps depend on the context existing.

### Step 1 — Create `MapContext.tsx`

Implement the full context including `MapProvider` and `useMapContext`. Import and call `useOverlayColors` and `useLocationPods` here. Compute `finalStarColors`. At this point nothing consumes the context yet — existing components still use props.

### Step 2 — Migrate `MapPage.tsx`

Wrap in `<MapProvider>`. Move all state, hooks, and derivations out of `MapPage` (they now live in the provider). `MapPage` becomes a thin shell:

```tsx
export function MapPage() {
  return (
    <MapProvider>
      <MapPageInner />
    </MapProvider>
  );
}
```

`MapPageInner` reads `sidebarTab`, `setSidebarTab`, `selectedId`, `overlayConfig` from context. It no longer computes `sceneOverlays` as an IIFE — instead it reads `glowMask` and `densityMask` from context and conditionally renders `<GlowLayer>` and `<DensityGradientLayer>` inline (they read from context themselves so no props needed).

### Step 3 — Migrate `SolarSystemPoints.tsx`

Remove all props. Read `positions`, `ids`, `finalStarColors` from context. Replace two competing effects with:

```typescript
// Effect 1: sync finalStarColors to GPU buffer
useEffect(() => {
  const attr = colorAttrRef.current;
  if (!attr) return;
  (attr.array as Float32Array).set(finalStarColors);
  attr.needsUpdate = true;
}, [finalStarColors]);

// Effect 2: raycaster threshold (unchanged)
useEffect(() => {
  raycaster.params.Points = { threshold: 50 };
}, [raycaster]);
```

Click handler reads `ids` from context. No `prevIdRef`, no `restoreColorRef`, no `GOLD`/`WHITE` constants.

### Step 4 — Migrate `SelectionIndicator.tsx`

Remove all props. Read `positions`, `idToIndex`, `selectedId` from context directly.

### Step 5 — Migrate `CameraController.tsx`

Remove `selectedId`, `positions`, `idToIndex` props. Read from context. Keep `controlsRef` as a prop — it is a React ref to a Three.js OrbitControls instance, created in `GalaxyMap` and shared only between `GalaxyMap` and `CameraController`. It is not state and other components have no need for it.

### Step 6 — Migrate `GalaxyMap.tsx`

Remove all props except `sceneOverlays?: ReactNode` and `hudOverlays?: ReactNode`. Read `positions` from context for the `<Canvas>` camera setup. Pass `controlsRef` to `CameraController` and `<OrbitControls>` as before (the only remaining prop threading).

The prop interface shrinks to:
```typescript
interface GalaxyMapProps {
  sceneOverlays?: ReactNode;
  hudOverlays?: ReactNode;
}
```

### Step 7 — Migrate `GlowLayer.tsx`

Remove all props. Read `positions` and `glowMask` from context. Import `ACCENT_COLOR` directly from `overlayPalette`. The component should only be rendered when `glowMask` is non-null (the caller — `MapPageInner` — is responsible for the conditional render).

### Step 8 — Migrate `DensityGradientLayer.tsx`

Remove all props. Read `positions` and `densityMask` from context. Import `ACCENT_COLOR` directly.

### Step 9 — Migrate `OverlayPanel.tsx`

Remove all props. Read `overlayConfig`, `setOverlayConfig`, `pods` from context.

---

## `MapPageInner` Component Structure (after)

```tsx
function MapPageInner() {
  const { sidebarTab, setSidebarTab, selectedId, glowMask, densityMask } = useMapContext();

  return (
    <PageContainer>
      <CanvasArea>
        <GalaxyMap
          sceneOverlays={
            <>
              {glowMask && <GlowLayer />}
              {densityMask && <DensityGradientLayer />}
            </>
          }
        />
      </CanvasArea>
      <InfoSidebar>
        <TabBar>...</TabBar>
        <TabContent>
          {sidebarTab === 'system' && <SystemInfoPanel selectedSystemId={selectedId} />}
          {sidebarTab === 'overlays' && <OverlayPanel />}
        </TabContent>
      </InfoSidebar>
    </PageContainer>
  );
}
```

---

## Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| R3F context bridging fails for canvas-internal components | Medium | R3F v9 bridges context automatically; if issues arise, `GalaxyMap` can read context and pass minimal props to canvas children as a fallback |
| `finalStarColors` allocation causes perceptible jank on low-end hardware | Low | ~288 KB alloc + memcpy runs < 1 ms; only fires on user-initiated events, never per-frame |
| `useMapContext()` called outside provider (e.g. in tests) | Low | `useMapContext` throws a descriptive error; test files that render these components must wrap with `<MapProvider>` or a mock context |
| `SystemInfoPanel` tests break due to prop change | None | `SystemInfoPanel` keeps its `selectedSystemId` prop; tests are unaffected |

---

## Test Impact

Existing tests do not render `SolarSystemPoints`, `GlowLayer`, `DensityGradientLayer`, `OverlayPanel`, or `GalaxyMap` — they test hooks and pure components in isolation. No test changes are required.

The `SystemInfoPanel.test.tsx` tests are unaffected since that component keeps its prop interface.

After implementation, `npx vitest run` should pass all 83 existing tests without modification.
