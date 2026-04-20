# Design: 3D Solar System Map

## File Plan

| File | Action | Purpose |
|------|--------|---------|
| `web/package.json` | modify | Add runtime deps: `three`, `@react-three/fiber`, `@react-three/drei`, `@types/three`, `three-mesh-bvh`; add test devDeps: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `@playwright/test`; add scripts: `"test:e2e": "playwright test"` |
| `web/vite.config.ts` | modify | Add `test` block: `environment: 'jsdom'`, `setupFiles: ['./src/test-setup.ts']`, `globals: true` |
| `web/src/test-setup.ts` | create | Vitest setup file; imports `@testing-library/jest-dom` to extend `expect` matchers |
| `web/src/lib/galaxyMap.ts` | create | Pure functions extracted for testability: `buildGalaxyBuffer(systems)` → `{positions, ids, idToIndex}`; `computeGalaxyBounds(regions)` → bounding box used for camera init |
| `web/src/lib/galaxyMap.test.ts` | create | Unit tests for `buildGalaxyBuffer` (correct Float32 values, parallel array alignment, idToIndex reverse map) and `computeGalaxyBounds` |
| `web/src/pages/MapPage.tsx` | create | Page shell; owns `selectedSystemId` state; calls `buildGalaxyBuffer` once via `useMemo`; renders `GalaxyMap` + `SystemInfoPanel` side by side; imports `GalaxyMap` via `React.lazy` |
| `web/src/components/map/GalaxyMap.tsx` | create | r3f `<Canvas>` wrapper; mounts `OrbitControls`, `SolarSystemPoints`, `SelectionIndicator`; accepts `sceneOverlays?: React.ReactNode` (Three.js scene children, unused extensibility slot) and `hudOverlays?: React.ReactNode` (DOM children rendered outside Canvas, unused) |
| `web/src/components/map/SolarSystemPoints.tsx` | create | `THREE.Points` + `BufferGeometry` using pre-built Float32Array; handles raycaster click → `onSelect(id)` |
| `web/src/components/map/SelectionIndicator.tsx` | create | Small bright sphere mesh repositioned to the selected system's world coordinates |
| `web/src/components/map/SystemInfoPanel.tsx` | create | HTML overlay panel; resolves name/constellation/region from `selectedSystemId`; shows empty-state prompt when null |
| `web/src/components/map/SystemInfoPanel.test.tsx` | create | Component tests: renders system name/constellation/region for a given id; renders empty-state when `selectedSystemId` is null |
| `web/src/App.tsx` | modify | Add `React.lazy` import for `MapPage` wrapped in `Suspense`; add `<Route path="/map">` after `/forge` route |
| `web/src/components/layout/Sidebar.tsx` | modify | Add `{ to: "/map", label: "Map", icon: Globe }` to `mainEntries`; add `Globe` to lucide-react imports |
| `web/playwright.config.ts` | create | Playwright config; `webServer` runs `vite preview` on port 4173 (tests the built artifact); baseURL `http://localhost:4173` |
| `web/e2e/map.spec.ts` | create | E2E tests: canvas renders, frame rate ≥30fps via rAF measurement, OrbitControls survives mouse drag, click→SystemInfoPanel shows system name, Sidebar "Map" link navigates to `/map` |

## Execution Order

1. Install dependencies (`web/package.json`) — must precede all Three.js and testing-library imports
2. Add `test` block to `web/vite.config.ts` + create `web/src/test-setup.ts` — test infra before any test files
3. Create `web/src/lib/galaxyMap.ts` — pure functions; no component deps
4. Create `web/src/lib/galaxyMap.test.ts` — verifies step 3 immediately
5. Create `SolarSystemPoints.tsx` — core rendering primitive
6. Create `SelectionIndicator.tsx` — standalone mesh
7. Create `GalaxyMap.tsx` — composes steps 5 & 6 inside `<Canvas>`
8. Create `SystemInfoPanel.tsx` — pure HTML; uses existing lib utilities only
9. Create `SystemInfoPanel.test.tsx` — component tests; verifies step 8
10. Create `MapPage.tsx` — composes steps 7 & 8; calls `buildGalaxyBuffer` via `useMemo`
11. Modify `App.tsx` — `React.lazy` import + route
12. Modify `Sidebar.tsx` — nav entry
13. Create `web/playwright.config.ts` — E2E config (requires `npx playwright install` for browser binaries)
14. Create `web/e2e/map.spec.ts` — E2E tests; run after a successful build (`npm run build` first)

## Data Flow

```
web/src/data/solar-systems.json (static bundle, 24 502 entries)
  │
  ▼ imported at module load by solarSystems.ts
SOLAR_SYSTEMS: Map<number, SolarSystemEntry>   (BigInt x/y/z in game metres)
  │
  ▼ MapPage useMemo (runs once on mount)
Float32Array positions[N*3]   (divided by METERS_PER_LY → light-year scale floats)
ids: number[]                  (parallel array: ids[i] = system at positions[i*3])
idToIndex: Map<number,number>  (reverse map: system id → buffer index, for SelectionIndicator)
  │
  ├──▶ GalaxyMap  (props: positions, ids, idToIndex, selectedId, onSelect, overlays?)
  │      └──▶ <Canvas> (r3f, WebGL)
  │             ├── OrbitControls     ← mouse events (rotate / pan / zoom)
  │             ├── SolarSystemPoints ← positions + ids → THREE.Points draw call
  │             │     └── click event → raycast → ids[hitIndex] → onSelect(id)
  │             └── SelectionIndicator ← idToIndex.get(selectedId) → positions[idx*3] → sphere mesh
  │
  └──▶ SystemInfoPanel
         selectedSystemId → solarSystemName() / constellationName() / regionName()
         → rendered HTML overlay (outside Canvas, normal React DOM)
```

### Coordinate normalisation detail

```
scaledX = Number(entry.x / METERS_PER_LY)   // integer division in BigInt, then cast
```
Galaxy extent is ~±6 000 LY on the long axis. Float32 handles ±16 777 216 exactly, so LY-scale values have sub-LY precision — sufficient for visualisation. Division is done once in `useMemo`; the BigInt data is never touched again at runtime.

### Camera initialisation

On mount, the camera is positioned along the Z axis at a distance that frames the galaxy's X/Y bounding box using the union of all `getRegionBounds()` results. `OrbitControls.target` is set to the galaxy centroid.

### Raycasting strategy

`THREE.Raycaster` built-in `Points` intersection (O(n), ~0.5 ms for 24 k points) is used first. `raycaster.params.Points.threshold` is set to ~1.5 LY to balance hit accuracy against density. `three-mesh-bvh` is installed and imported but its accelerated raycasting is only wired up if click latency is observed to be problematic during testing — the package is present for future scale to 100 k+.

## Test File Plan

The `web` package has an existing vitest convention (`vitest run`, `describe/it/expect`, test files colocated with source). This feature also introduces jsdom + `@testing-library/react` for component tests — a one-time setup that benefits the whole package going forward.

| Test File | Covers |
|-----------|--------|
| `web/src/lib/galaxyMap.test.ts` | `buildGalaxyBuffer`: Float32 values match expected LY coords; `ids[i]` matches system id; `idToIndex` is the correct reverse map; `computeGalaxyBounds`: returns union bounding box across all regions |
| `web/src/components/map/SystemInfoPanel.test.tsx` | Renders system name, constellation, region for a known `selectedSystemId`; renders empty-state prompt when `selectedSystemId` is `null` |
| `web/e2e/map.spec.ts` | Playwright/Chromium E2E: `/map` route loads; `<canvas>` element is present and sized; frame rate ≥30fps measured via `requestAnimationFrame` over 2s; mouse drag on canvas does not crash; click on canvas updates `SystemInfoPanel` with a system name; Sidebar "Map" link navigates to `/map` |

**Not unit-tested:** Three.js object construction (`SolarSystemPoints`, `SelectionIndicator`, `GalaxyMap`) — WebGL-dependent internals not testable in jsdom. Covered by E2E tests (canvas renders, frame rate, interaction) and unit tests on `galaxyMap.ts` (buffer correctness). **No manual testing required.**

## Risks and Unknowns

1. **z-index conflict with global overlays:** `globalStyles.ts` applies `body::before` (scanline) and `body::after` (noise grain) pseudo-elements at z-index 9999 and 9998 with `pointer-events: none`. These will render on top of any HTML overlay (e.g. `SystemInfoPanel`) if the panel's stacking context is below 9999. Fix: give `SystemInfoPanel` `z-index: 10000` and `position: absolute` inside the page container.

2. **Float32 precision edge case:** If any coordinate after BigInt division produces a value outside the Float32 safe range (~±1.7×10³⁸) or NaN (e.g. from a zero `METERS_PER_LY` divisor), the buffer will silently misplace or lose systems. A dev-mode assertion in `useMemo` should validate min/max before uploading to GPU.

3. **Canvas height offset:** `BuildCanvasView` uses `calc(100vh - 200px)`. The correct offset for `MapPage` depends on the actual header/sidebar height. This must be measured at implementation time — use `100%` with a flex parent rather than a magic `calc()` if possible.

4. **OrbitControls + React StrictMode double-mount:** React 18 StrictMode double-invokes effects. r3f handles this correctly in v8+, but OrbitControls state (target, zoom) may briefly reset on dev mount. Not a production issue; note if disorienting in development.

5. **`overlays` prop semantics — two slots, not one:** r3f `<Canvas>` children are Three.js scene objects, not DOM elements. The extensibility slot is therefore split into `sceneOverlays?: React.ReactNode` (rendered inside `<Canvas>`, must be r3f-compatible) and `hudOverlays?: React.ReactNode` (rendered as a sibling `<div>` outside the Canvas, for DOM-based overlays). Both are unused in this iteration. Future implementors must place DOM content in `hudOverlays` and 3D geometry in `sceneOverlays`.

6. **three-mesh-bvh / Points raycasting fit:** `three-mesh-bvh` accelerates `Mesh` raycasting, not `Points`. Its value here is for future `InstancedMesh` selection (when LOD is added). For the initial Points implementation, the built-in raycaster is the correct tool. The package is still worth installing now for the 100k+ scale path.

7. **Bundle size impact:** `three` is ~600 KB minified. Combined with `@react-three/fiber` and `@react-three/drei`, this may add ~900 KB to the bundle. Route-level code splitting (`React.lazy` + `Suspense` on `MapPage`) is **required** at implementation time — without it, initial load time for all pages regresses. Added to Definition of Done in SPEC.md as a gap (see gate note below).

---
*(Test plan table appended after Phase 4)*
