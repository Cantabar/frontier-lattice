# Spec: 3D Solar System Map

## API Contracts

None. All solar system data is static JSON already bundled in the web app (`web/src/data/solar-systems.json`). No new backend endpoints are required.

## Data Model Changes

None. No database, indexer, or on-chain changes. The existing `SolarSystemEntry` type and `SOLAR_SYSTEMS` map in `web/src/lib/solarSystems.ts` are the sole data source.

## UI Specification

### Routes / Pages

| Route | Component | Notes |
|-------|-----------|-------|
| `/map` | `MapPage` | New standalone page; added to React Router in `App.tsx` |

A "Map" nav entry is added to `Sidebar.tsx` using a `<NavLink to="/map">` with a suitable lucide-react icon (e.g. `Globe`).

### State Changes

Selection state is local to `MapPage` — no global context or store entry required.

| State | Type | Owner | Initial value |
|-------|------|-------|---------------|
| `selectedSystemId` | `number \| null` | `MapPage` (useState) | `null` |

No loading state is needed; the JSON is bundled and parsed synchronously on first render.

### Component Changes

```
MapPage                              /pages/MapPage.tsx
├── GalaxyMap                   /components/map/GalaxyMap.tsx
│   └── <Canvas> (r3f)
│       ├── OrbitControls            (@react-three/drei)
│       ├── SolarSystemPoints        /components/map/SolarSystemPoints.tsx
│       │     THREE.Points with BufferGeometry — one draw call, all systems
│       └── SelectionIndicator       /components/map/SelectionIndicator.tsx
│             Small highlight mesh at selected system position
└── SystemInfoPanel                  /components/map/SystemInfoPanel.tsx
      Sidebar/HUD panel; shows name, ID, constellation, region for selected system
      Empty state: "Select a solar system" prompt
```

**SolarSystemPoints** receives `onSelect: (id: number) => void` and `selectedId: number | null`. It uses `three-mesh-bvh` (or raycaster with `threshold` tuning) for click hit-testing at scale.

**SystemInfoPanel** receives `systemId: number | null` and resolves name, constellation, and region via the existing `solarSystemName()`, `constellationName()`, and `regionName()` utilities.

**GalaxyMap** receives `selectedId` and `onSelect` from `MapPage`, keeping the Canvas stateless.

**`web/src/lib/galaxyMap.ts`** exposes `buildGalaxyBuffer(systems: SolarSystemEntry[])` and `computeGalaxyBounds(regions: RegionEntry[])` as pure functions extracted from `MapPage` for testability.

**Coordinate normalisation:** Bigint coordinates are converted to `Float32` for the GPU buffer by scaling relative to the galaxy's bounding extents. Precision loss at `Float32` is acceptable for visualisation (sub-LY accuracy is not required).

**Initial camera:** Positioned to frame the full galaxy bounding box on mount using the existing region bounding box data (`getRegionBounds`).

**Overlay extensibility:** `GalaxyMap` accepts an optional `overlays` prop typed as `React.ReactNode` rendered inside the `<Canvas>` scene graph. This prop is unused in this iteration but reserves the slot for future overlay layers without structural change.

### Inter-App Messaging

N/A — no postMessage events, no iframe interaction, no URL params passed to embedded apps.

### Loading / Error / Empty States

| State | Component | Behaviour |
|-------|-----------|-----------|
| No system selected | `SystemInfoPanel` | Shows "Select a solar system" placeholder |
| Data unavailable | N/A | Static bundle — cannot fail independently of app load |

## Cross-Package Checklist

| Item | Answer |
|------|--------|
| New shared types needed | No — `SolarSystemEntry`, `ConstellationEntry`, `RegionEntry` in `web/src/lib/` are sufficient; new `GalaxyBuffer` return type stays in `galaxyMap.ts` |
| New shared components needed | No — all new components are scoped to the `web` package under `components/map/` |
| Consuming packages to update after shared pkg bump | N/A |
| Auth changes | None — map page is unauthenticated; no wallet connection required to view |
| Data passing strategy | Static JSON bundled with web app; no fetch, no API call |
| Data store decision | Local `useState` in `MapPage`; selection does not need to persist across navigation |

### New Dependencies (`web` package only)

| Package | Purpose |
|---------|---------|
| `@react-three/fiber` | React renderer for Three.js |
| `@react-three/drei` | OrbitControls, helpers |
| `three` | 3D engine (peer dep of r3f) |
| `@types/three` | TypeScript types |
| `three-mesh-bvh` | Spatial index for raycasting 24k+ points efficiently |
| `@testing-library/react` | Component test utilities (devDep) |
| `@testing-library/user-event` | User interaction simulation in tests (devDep) |
| `@testing-library/jest-dom` | Extended `expect` matchers for DOM assertions (devDep) |
| `jsdom` | DOM environment for vitest (devDep) |
| `@playwright/test` | E2E test runner with real Chromium/WebGL (devDep) |

## Definition of Done

- [ ] `/map` route renders `MapPage` without errors in dev and production build
- [ ] All ~24,500 solar systems appear as points at their correct relative 3D positions
- [ ] Orbit (rotate), pan, and scroll-zoom all work via mouse
- [ ] Clicking a point sets `selectedSystemId`; `SystemInfoPanel` displays the system's name, ID, constellation, and region
- [ ] Selected point is visually distinct from unselected points (colour or size change)
- [ ] `SystemInfoPanel` shows "Select a solar system" when nothing is selected
- [ ] Camera frames the full galaxy on initial load
- [ ] "Map" link appears in `Sidebar.tsx` and highlights as active on the `/map` route
- [ ] Frame rate is ≥30 fps on a mid-range machine with all systems loaded (verified manually)
- [ ] `overlays` prop exists on `GalaxyMap` (typed, accepted, unused) — extensibility slot is in place
- [ ] `MapPage` is loaded via `React.lazy` + `Suspense`; the initial bundle for all other pages is not increased by the Three.js dependency
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] `npm test` passes: `buildGalaxyBuffer` unit tests and `SystemInfoPanel` component tests all green
- [ ] `npm run test:e2e` passes: canvas renders, frame rate ≥30fps, OrbitControls drag survives, click updates `SystemInfoPanel`, Sidebar "Map" link navigates correctly
- [ ] No regressions on existing pages verified by E2E smoke tests for Dashboard, Forge Planner, and Locations routes
