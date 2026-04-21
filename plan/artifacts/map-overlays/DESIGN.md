# Design: Map Overlays

## File Plan

| File | Action | Purpose |
|------|--------|---------|
| `scripts/build-overlay-data.mjs` | create | Reads starmapcache + celestials + npcStations static data; emits `web/src/data/overlay-data.json` |
| `web/src/data/overlay-data.json` | generate | Compact per-system overlay attributes + region/constellation adjacency lists |
| `web/src/lib/overlayTypes.ts` | create | `OverlayMode`, `OverlayFilter`, `OverlayConfig` type definitions |
| `web/src/lib/overlayData.ts` | create | Imports overlay-data.json; builds Maps indexed by systemId; exports `PLANET_TYPES` metadata array; exports `REGION_ADJACENCY` and `CONSTELLATION_ADJACENCY` |
| `web/src/lib/overlayPalette.ts` | create | Fixed base palette (≥ 12 colors); `assignCategoricalColors()`; `gradientColor()`; one-time palette maps built at module load |
| `web/src/hooks/useOverlayColors.ts` | create | Accepts `overlayConfig`, `ids`, `pods`; returns `{ colors: Float32Array \| null; glowMask: Float32Array \| null; densityMask: Float32Array \| null }` via `useMemo` |
| `web/src/components/map/GlowLayer.tsx` | create | Second `<points>` layer inside Canvas; additive blending; accepts `positions`, `glowMask`, `glowColor` |
| `web/src/components/map/DensityGradientLayer.tsx` | create | `<points>` layer inside Canvas; large soft-sprite points (sizeAttenuation=true) with a radial-gradient circular texture; additive blending; qualifying systems emit large glowing blobs that merge into cloud-like volumes in dense regions |
| `web/src/components/map/OverlayLegend.tsx` | create | Categorical swatches or gradient bar; hidden when no overlay active |
| `web/src/components/map/OverlayPanel.tsx` | create | Overlay tab content: filter selector, mode selector, planet-type secondary selector, legend, My Structures auth button |
| `web/src/components/map/SolarSystemPoints.tsx` | modify | Add `overlayColors: Float32Array \| null` prop; fix selection highlight restore to use overlay color instead of hardcoded white |
| `web/src/components/map/GalaxyMap.tsx` | modify | Forward `overlayColors` prop through to `SolarSystemPoints` |
| `web/src/pages/MapPage.tsx` | modify | Add `sidebarTab` + `overlayConfig` state; call `useOverlayColors`; call `useLocationPods` for My Structures auth; render sidebar tabs; pass overlay layers to GalaxyMap |
| `web/src/lib/overlayPalette.test.ts` | create | Unit tests for `assignCategoricalColors` and `gradientColor` |
| `web/src/hooks/useOverlayColors.test.ts` | create | Hook tests for all 8 filter computations; `densityMask` and `glowMask` return correctly by mode; mock `overlayData` module |

---

## Execution Order

1. **`scripts/build-overlay-data.mjs`** — run offline first; produces `overlay-data.json` which subsequent steps depend on
2. **`web/src/data/overlay-data.json`** — committed artifact; must exist before the web build
3. **`web/src/lib/overlayTypes.ts`** — type definitions; all other web files depend on this
4. **`web/src/lib/overlayData.ts`** — depends on `overlay-data.json` and `overlayTypes`
5. **`web/src/lib/overlayPalette.ts`** — depends on `overlayTypes`; pure functions, no other dependencies
6. **`web/src/hooks/useOverlayColors.ts`** — depends on `overlayData`, `overlayPalette`, `overlayTypes`, `useLocationPods` (existing)
7. **`web/src/components/map/GlowLayer.tsx`** — depends on Three.js only
8. **`web/src/components/map/DensityGradientLayer.tsx`** — depends on Three.js and `@react-three/fiber`
9. **`web/src/components/map/OverlayLegend.tsx`** — depends on `overlayTypes`, `overlayPalette`, `overlayData`
10. **`web/src/components/map/OverlayPanel.tsx`** — depends on `overlayTypes`, `overlayData`, `OverlayLegend`
11. **Modify `SolarSystemPoints.tsx`** — depends on `overlayTypes`
12. **Modify `GalaxyMap.tsx`** — depends on modified `SolarSystemPoints`
13. **Modify `MapPage.tsx`** — depends on all of the above

---

## Data Flow

### Build time

```
static-data/
  res__staticdata_starmapcache.json   (14 MB)
  app__bin64_staticdata_mapObjects_celestials.json  (81 MB)
  app__bin64_staticdata_mapObjects_npcStations.json
        │
        ▼
scripts/build-overlay-data.mjs
        │
        ├─ Reads solarSystems from starmapcache:
        │    factionID, planetCountByType per system
        │
        ├─ Reads celestials: counts moons (groupID=8) per system
        │
        ├─ Reads npcStations: builds set of systems with stations
        │
        ├─ Reads jumps from starmapcache: builds region + constellation
        │    adjacency maps (which regions/constellations share a gate)
        │
        └─ Emits web/src/data/overlay-data.json:
             {
               systems: [[sysId, factionId|null, totalPlanets,
                           planetTypeBitmask, moonCount, hasStation], ...],
               regionAdj: [[r1, r2], ...],       // ~200-500 pairs
               constAdj:  [[c1, c2], ...]         // ~2000-5000 pairs
             }
```

### Runtime — happy path (Color mode, Region filter)

```
Module load
  overlayData.ts imports overlay-data.json
  → builds SYSTEM_FACTION, SYSTEM_PLANET_COUNT, etc. Maps
  → REGION_ADJACENCY: Map<number, number[]>

  overlayPalette.ts
  → builds REGION_COLOR_MAP via assignCategoricalColors(
        all regionIds, REGION_ADJACENCY
    ) at module load time (one-time)

User opens /map
  MapPage renders: overlayConfig=null, sidebarTab='system'
  useOverlayColors({ config: null, ids, pods: [] }) → { colors: null, glowMask: null }
  SolarSystemPoints receives overlayColors=null → white default

User clicks "Overlays" tab
  sidebarTab → 'overlays'
  OverlayPanel renders with config=null

User selects "Region" filter + "Color" mode
  overlayConfig → { filter: 'region', mode: 'color' }
  useOverlayColors recomputes (useMemo):
    for each id in ids[]:
      regionId = SOLAR_SYSTEMS.get(id).regionId
      color    = REGION_COLOR_MAP.get(regionId)
      write RGB to colors[idx*3..]
    returns { colors: Float32Array(N*3), glowMask: null }
  MapPage passes colors to GalaxyMap → SolarSystemPoints
  SolarSystemPoints.useEffect:
    copies new overlayColors into colorAttr buffer → needsUpdate=true
  GPU re-renders; stars colored by region
  OverlayLegend shows categorical swatches (up to 8, + N more)
```

### Runtime — My Structures auth path

```
User selects "My Structures" filter
  MapPage checks pods.length === 0
  OverlayPanel shows disabled filter + "Authenticate" button

User clicks "Authenticate"
  MapPage triggers solo POD fetch (exact call TBD — see Risks)
    → wallet sign challenge → POST /locations/solo
    → decrypts PODs client-side → pods[] populated

  useOverlayColors recomputes:
    qualifyingSystems = new Set(pods.map(p => p.location.solarSystemId))
    for each id in ids[]:
      color = qualifyingSystems.has(id)
              ? MY_STRUCTURE_COLOR
              : DIM_COLOR
    returns { colors, glowMask: null }
  Stars in user's systems highlighted
```

### Runtime — Glow mode

```
overlayConfig → { filter, mode: 'glow' }
useOverlayColors:
  computes glowMask: Float32Array(N)
    qualifying system: 1.0
    non-qualifying:    0.0
  colors: same categorical/gradient assignment as Color mode

MapPage passes glowMask to GlowLayer (via sceneOverlays in GalaxyMap)
SolarSystemPoints: base colors dimmed for non-qualifying (multiplied by 0.3)
GlowLayer: additive-blended Points with glowMask as opacity per vertex
  → qualifying stars appear bright + larger; others fade
```

### Runtime — Density Gradient mode

```
overlayConfig → { filter, mode: 'densityGradient' }
useOverlayColors:
  returns { colors: null, glowMask: null, densityMask: Float32Array(N) }
    densityMask[i] = 1.0 if ids[i] qualifies, else 0.0

MapPage passes densityMask + overlayColor to DensityGradientLayer (via sceneOverlays)
DensityGradientLayer:
  On mount: generates 64×64 radial-gradient sprite texture (once)
  On densityMask change:
    writes densityMask into per-vertex color alpha channel → needsUpdate=true
  Renders <points> geometry (same positions as SolarSystemPoints):
    - size: ~2000 (world units), sizeAttenuation: true
    - map: sprite texture
    - blending: THREE.AdditiveBlending
    - depthWrite: false, transparent: true
  Qualifying systems emit large soft blobs;
  overlapping blobs merge into cloud-like volumes in dense regions
  Non-qualifying systems invisible (opacity = 0)
  SolarSystemPoints renders normally on top (overlayColors = null in this mode)
```

---

## Key Design Decisions

### DensityGradientLayer: 3D soft-sprite cloud (confirmed scene overlay)

Confirmed by the user: the density gradient renders inside the 3D scene and should look like a cloud — volumetric, not flat.

**Approach:** A `<points>` layer using the same `positions` buffer as `SolarSystemPoints`, with a custom circular radial-gradient texture applied as a point sprite. `sizeAttenuation: true` makes blobs grow as the camera zooms in, preserving the spatial relationship. Additive blending means overlapping blobs from clustered systems accumulate brightness, naturally producing denser/brighter clouds where systems are concentrated and wispy tendrils where they're sparse.

The `densityMask` Float32Array (0.0 for non-qualifying systems, 1.0 for qualifying) drives per-vertex opacity via a vertex color channel. Non-qualifying systems are invisible; only qualifying systems contribute blobs.

**Sprite texture:** A small (64×64) circular gradient texture (white centre → transparent edge) is generated once at component mount from a 2D canvas and loaded into a `THREE.CanvasTexture`. It does not change on filter updates — only the `densityMask` vertex data changes.

**Why this beats PlaneGeometry + CanvasTexture:**
- Naturally 3D — blobs have perspective depth and scale with the camera
- No projection math needed (positions are already in world space)
- Only the vertex opacity buffer updates on filter change (cheap GPU upload vs. full texture repaint)
- Simpler code path — no camera-sync problem, no texture re-bake per frame

### Region/constellation adjacency in overlay-data.json

The web bundle doesn't include the `jumps` array from starmapcache. Graph coloring requires an adjacency graph. Rather than including a second large static file, the `build-overlay-data.mjs` script emits `regionAdj` and `constAdj` edge lists directly into `overlay-data.json`. This adds ~15–20 KB to the file and keeps the web bundle self-contained.

### Selection highlight with active overlay

`SolarSystemPoints` currently hardcodes `[1,1,1]` as the restore color when deselecting. With overlay active, this is wrong. The `overlayColorsRef` approach is also unsafe: if the overlay filter changes while a system is selected, the ref is updated but the selection effect doesn't re-run, so deselection would restore the new overlay color rather than the one that was under the gold highlight.

**Fix:** Store the restore color at the moment of selection, not at deselection. A `restoreColorRef = useRef<[number, number, number]>([1,1,1])` captures the overlay color (or white default) for the just-selected system at the moment `selectedId` changes. On deselection, `restoreColorRef.current` holds the correct value regardless of subsequent overlay changes. This is safe and eliminates the spurious-update problem.

### My Structures: solo PODs only

Tribe PODs require TLK distribution (already deferred). The map overlay shows structures from solo PODs only. Users with tribe structures see only their solo-registered structures; the OverlayPanel notes this limitation explicitly.

`useLocationPods` has no dedicated `fetchSoloPods` — it exposes `fetchPods(tribeId, tlkBytes)`, and solo mode is entered when `tribeId = "solo:<address>"`. The hook also directly wraps `getSoloLocationPods` from the API module. **Before implementing MapPage auth:** read `useLocationPods.ts` lines that call `getSoloLocationPods` to confirm the exact invocation — a small `fetchSoloPods()` convenience method may need to be added to the hook, or MapPage can call the API module directly. See Risks section.

MapPage calls `useLocationPods()` at top level; the hook's `pods` state starts empty and is populated on authenticate.

### Palette assignment at module load time

`assignCategoricalColors` for regions and constellations is called once in `overlayData.ts` / `overlayPalette.ts` at module load, not per render. The resulting `REGION_COLOR_MAP` and `CONSTELLATION_COLOR_MAP` are module-level constants. `useOverlayColors` only does the per-system color assignment (fast array writes), not graph coloring.

The greedy graph coloring must be deterministic: process region/constellation IDs in ascending numeric order as the input sequence. This ensures the same palette assignment across reloads and test runs.

---

## Risks and Unknowns

- **Density cloud blob size tuning**: The point sprite `size` (world units) determines how large each cloud blob is. Too small → individual dots, not clouds. Too large → everything blurs into one mass. Starting value of ~2000 ly (world units) needs visual validation; expose as a tuning constant. `sizeAttenuation: true` means size also depends on camera distance — validate at several zoom levels.

- **Density gradient sprite texture clamp**: The 64×64 radial gradient texture must use `THREE.ClampToEdgeWrapping` and `THREE.LinearFilter` to avoid bleeding artefacts at the point sprite edges.

- **`positions.length` alignment**: `positions` is `Float32Array(N*3)` and `ids` is `number[N]`. The overlay color buffer must also be `Float32Array(N*3)`. These are built from the same `SOLAR_SYSTEMS.values()` array in `buildGalaxyBuffer()`. The `ids` ordering must be used as the index basis in `useOverlayColors` — confirmed by reading `galaxyMap.ts` which returns `{ positions, ids, idToIndex }` with parallel ordering.

- **My Structures solo POD fetch — exact API call unverified**: `useLocationPods` has `fetchPods(tribeId, tlkBytes)` with solo mode triggered by `isSoloTribeId(tribeId)`. The exact invocation (tribeId construction, whether tlkBytes is required or can be empty for solo) must be confirmed by reading the hook's solo-mode code path before implementing `MapPage`. A small `fetchSoloPods()` convenience method may be needed on the hook.

- **overlay-data.json staleness**: Both `overlay-data.json` and `solar-systems.json` enumerate systems and can diverge if starmapcache is updated but the build script isn't re-run. `useOverlayColors` will silently return the dim/default color for unknown systems. `build-overlay-data.mjs` should validate that its system IDs are a superset of `solar-systems.json`'s system IDs and exit non-zero if not.

- **overlay-data.json committed artifact in CI**: If CI runs `npm run build` without first running `build-overlay-data.mjs`, the JSON may be absent or stale. **Mitigation:** Add a CI step that runs the script and diffs the output against the committed JSON; fail if there's a mismatch. Document the regeneration step in the repo's `scripts/README` or equivalent.

- **Constellation palette scale**: ~1,000 constellations vs. ≥12 palette colors → heavy cycling. Adjacent constellations may share a color after several cycles despite graph coloring. This is inherent to a bounded palette over a large graph. The OverlayPanel should note "Colors repeat — not unique per constellation."

- **My Structures scope gap (spec)**: The spec says "auth-gated" without specifying solo vs. tribe. The design limits v1 to solo PODs only. OverlayPanel must display "Showing solo-registered structures only." This is a spec gap acknowledged in the design.

---

## Test File Plan

| Test File | Covers |
|-----------|--------|
| `web/src/lib/overlayPalette.test.ts` | `assignCategoricalColors`: correct color assignment; no two adjacent categories share a color; cycles gracefully when categories > palette size; `gradientColor`: interpolates correctly at 0, 0.5, and 1.0; clamps out-of-range values |
| `web/src/hooks/useOverlayColors.test.ts` | Returns `null` when `overlayConfig=null`; Region filter: each system's RGB matches its region's assigned color; Constellation filter: same for constellations; Ancient Civilizations: faction-null systems get the unclaimed color; Planet Count: gradient values scale with count; Planet Type filter: systems with bit set are accent color, others are dim; Moon Count: gradient values scale with count; NPC Stations: has-station systems get accent color; My Structures: systems in pods[] get accent color, others get dim; `glowMask` is null when mode≠glow; `glowMask` has 1.0 for qualifying systems and 0.0 for non-qualifying when mode=glow |

**Files with no unit tests (noted):**
- `scripts/build-overlay-data.mjs` — offline data generation script; correctness validated by inspecting output JSON against known systems
- `web/src/lib/overlayTypes.ts` — type definitions only; no runtime behavior
- `web/src/lib/overlayData.ts` — module-level data loading; correctness validated by overlayPalette + useOverlayColors tests which consume it
- `web/src/components/map/GlowLayer.tsx` — Three.js geometry; no testable pure logic; covered by E2E visual test
- `web/src/components/map/DensityGradientLayer.tsx` — canvas drawing; no testable pure logic; covered by E2E visual test
- `web/src/components/map/OverlayLegend.tsx` — presentational; covered by E2E visual test
- `web/src/components/map/OverlayPanel.tsx` — presentational + event wiring; DoD items for sidebar tabs and legend updates covered by Playwright E2E tests (see Phase 4 test plan)
- `web/src/components/map/SolarSystemPoints.tsx` (modified) — color buffer mutation; DoD items for per-filter rendering and selection highlight are covered by Playwright E2E tests

---

## Spec Gaps / Resolutions

1. **DensityGradientLayer as HUD overlay (spec) → scene overlay (confirmed by user)**: User confirmed the density gradient renders inside the 3D scene and should look cloud-like. The spec's "HUD overlay" language was incorrect. Implementation uses soft-sprite `<points>` inside the Canvas. Design supersedes spec on this point.
2. **My Structures: solo vs tribe scope**: Spec says "auth-gated" without specifying solo-only. Design limits v1 to solo PODs. OverlayPanel will note "Showing solo-registered structures only." Tribe structures require TLK (deferred).

---

## Test Plan

| Test | File | DoD Item Covered |
|------|------|-----------------|
| `assignCategoricalColors` returns a color for every input id | `overlayPalette.test.ts` | Data pipeline: faction IDs map correctly |
| No two adjacent categories share the same color | `overlayPalette.test.ts` | Region/constellation high-contrast adjacency |
| Color assignment is deterministic (same input → same output) | `overlayPalette.test.ts` | Palette determinism (greedy, ascending ID order) |
| Cycles palette gracefully when categories > palette size | `overlayPalette.test.ts` | Constellation filter with ~1,000 categories |
| Empty input returns empty map | `overlayPalette.test.ts` | Edge case |
| Processes categories in ascending ID order | `overlayPalette.test.ts` | Determinism requirement |
| `gradientColor` returns `from` color at min | `overlayPalette.test.ts` | Planet Count/Moon Count gradient lower bound |
| `gradientColor` returns `to` color at max | `overlayPalette.test.ts` | Planet Count/Moon Count gradient upper bound |
| `gradientColor` returns midpoint at halfway value | `overlayPalette.test.ts` | Gradient interpolation correctness |
| `gradientColor` clamps below min | `overlayPalette.test.ts` | Edge case: systems with 0 moons/planets |
| `gradientColor` clamps above max | `overlayPalette.test.ts` | Edge case: outlier high-count systems |
| `gradientColor` does not mutate input colors | `overlayPalette.test.ts` | Module-level constant safety |
| Returns null for all outputs when config is null | `useOverlayColors.test.ts` | Selecting "None" restores white default |
| Region filter colors match region color map | `useOverlayColors.test.ts` | All 8 filters render in Color mode (region) |
| Constellation filter colors match constellation color map | `useOverlayColors.test.ts` | All 8 filters render in Color mode (constellation) |
| Ancient Civilizations assigns faction colors; null → unclaimed | `useOverlayColors.test.ts` | All 8 filters render in Color mode (factions) |
| Planet Count gradient scales with planet count | `useOverlayColors.test.ts` | All 8 filters render in Color mode (planet count) |
| Planet Type accent for bit-set systems; dim for others | `useOverlayColors.test.ts` | Planet Type secondary selector + rendering |
| Moon Count gradient scales with moon count | `useOverlayColors.test.ts` | All 8 filters render in Color mode (moon count) |
| NPC Stations accent vs dim | `useOverlayColors.test.ts` | All 8 filters render in Color mode (NPC stations) |
| My Structures accent for pod systems; dim for others | `useOverlayColors.test.ts` | My Structures highlights user's structure systems |
| My Structures returns dim colors (not null) when pods empty | `useOverlayColors.test.ts` | My Structures disabled-but-visible behavior |
| Color mode: glowMask and densityMask are null | `useOverlayColors.test.ts` | Only one render mode output active at a time |
| Glow mode: glowMask is Float32Array; densityMask is null | `useOverlayColors.test.ts` | Glow mode renders additive layer |
| Glow mode: qualifying → 1.0, non-qualifying → 0.0 | `useOverlayColors.test.ts` | Glow mode: non-qualifying stars dimmed |
| Density Gradient mode: densityMask is Float32Array; glowMask is null | `useOverlayColors.test.ts` | Density Gradient mode renders cloud layer |
| Density Gradient mode: qualifying → 1.0, non-qualifying → 0.0 | `useOverlayColors.test.ts` | Density Gradient qualifying system blobs |
| `colors` length is always `3 * ids.length` for all filters | `useOverlayColors.test.ts` | Buffer alignment with positions array |
