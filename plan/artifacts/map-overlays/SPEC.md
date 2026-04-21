# Spec: Map Overlays

## API Contracts

No new API endpoints required.

The **My Structures** overlay reuses the existing Shadow Location Network endpoint:

### GET /locations/tribe/:tribeId (existing, no changes)
- **Auth:** Bearer session token (existing `createLocationSession` flow)
- **Response (200):** Array of `LocationPodResponse` — decrypted client-side via `useLocationPods`
- **Side effects:** None
- **Notes:** Already consumed by LocationsPage. The map will call the same hook (`useLocationPods`) when the My Structures filter is active and the user is authenticated.

---

## Data Model Changes

No database or backend schema changes.

### New static asset: `web/src/data/overlay-data.json`

Generated at build time by a new script (`scripts/build-overlay-data.mjs`) from existing static-data files. Contains per-system overlay attributes not present in `solar-systems.json`.

**Source files consumed by the script:**
- `static-data/data/phobos/resource_pickle/res__staticdata_starmapcache.json`
- `static-data/data/phobos/sqlite/app__bin64_staticdata_mapObjects_celestials.json`
- `static-data/data/phobos/sqlite/app__bin64_staticdata_mapObjects_npcStations.json`

**Output format** — compact tuple array, one entry per solar system (24,426 entries):
```
[solarSystemId, factionId|null, totalPlanets, planetTypeBitmask, moonCount, hasNpcStation]
```

Planet type bitmask bit positions (0-indexed):
- bit 0 → typeID 11 (Temperate)
- bit 1 → typeID 12 (Ice)
- bit 2 → typeID 13 (Gas)
- bit 3 → typeID 2014 (Oceanic)
- bit 4 → typeID 2015 (Lava)
- bit 5 → typeID 2016 (Barren)
- bit 6 → typeID 2063 (Plasma)

**Estimated uncompressed size:** ~790 KB. Gzip compression reduces this to ~200 KB.

**Regeneration:** `node scripts/build-overlay-data.mjs` (reads local static-data — no network calls).

---

## UI Specification

### Routes / Pages

No new routes. All changes are on the existing `/map` route (`MapPage.tsx`).

---

### State Changes

New state added to `MapPage`:

| State | Type | Initial Value |
|-------|------|---------------|
| `sidebarTab` | `'system' \| 'overlays'` | `'system'` |
| `overlayConfig` | `OverlayConfig \| null` | `null` |

New types (defined in `web/src/lib/overlayTypes.ts`):

```
OverlayMode    = 'color' | 'glow' | 'densityGradient'

OverlayFilter  = 'region'
               | 'constellation'
               | 'ancientCivilizations'
               | 'planetCount'
               | 'planetType'
               | 'moonCount'
               | 'npcStations'
               | 'myStructures'

OverlayConfig  = { filter: OverlayFilter; mode: OverlayMode; planetTypeId?: number }
```

---

### Component Changes

#### Modified components

**`MapPage.tsx`**
- Adds `sidebarTab` and `overlayConfig` state
- Passes `overlayConfig` and decrypted `pods` (when My Structures is active) to `useOverlayColors`
- Passes resulting `colors` Float32Array to `GalaxyMap`
- Renders sidebar with two tabs: **System** and **Overlays**
- System tab: wraps existing `<SystemInfoPanel>`
- Overlays tab: renders new `<OverlayPanel>`

**`GalaxyMap.tsx`**
- No prop interface changes (already accepts `sceneOverlays` and `hudOverlays`)
- Caller (`MapPage`) passes `<GlowLayer>` into `sceneOverlays` when mode is `glow`
- Caller passes `<DensityGradientLayer>` into `hudOverlays` when mode is `densityGradient`

**`SolarSystemPoints.tsx`**
- Adds optional prop: `overlayColors: Float32Array | null`
- When non-null, uses it as the color buffer (replacing the uniform white default)
- When null, reverts to the existing white default
- Selected-system gold highlight continues to apply on top of overlay colors

#### New components

**`web/src/components/map/GlowLayer.tsx`**
- Three.js `<points>` rendered inside the Canvas (via `sceneOverlays`)
- Uses the same `positions` buffer as `SolarSystemPoints`
- Accepts `glowMask: Float32Array` (per-system opacity 0–1) and `glowColor: THREE.Color`
- Rendered with additive blending and larger point size than the base layer
- Non-qualifying systems receive `glowMask` value of 0 (invisible)

**`web/src/components/map/DensityGradientLayer.tsx`**
- HTML `<canvas>` absolutely positioned over the Three.js canvas (via `hudOverlays`)
- Receives `qualifyingPositions: Float32Array` (x/z galaxy-plane coords of matching systems) and `color: string`
- Projects 3D positions to 2D screen space via the current Three.js camera
- Paints a Gaussian splat at each qualifying system position
- Redraws on camera change via a forwarded `OrbitControls` change listener
- Alpha-composited over the scene

**`web/src/components/map/OverlayPanel.tsx`**
- Tab content for the Overlays sidebar tab
- Contains:
  - Filter selector: labelled list of all 8 filters plus "None"
  - Render mode selector: radio group (Color / Glow / Density Gradient), shown only when a filter is active
  - Secondary planet-type selector: shown only when filter = `planetType`
  - `<OverlayLegend>` beneath controls
  - My Structures filter rendered disabled with explanatory note when pods are unavailable

**`web/src/components/map/OverlayLegend.tsx`**
- Categorical mode: row of color swatches with labels; shows up to 8 entries and a "+ N more" label for large sets
- Gradient mode: horizontal gradient bar labeled with min and max values (e.g. "0 moons" → "47 moons")
- Hidden when no overlay is active

#### New lib / hooks

**`web/src/lib/overlayData.ts`**
- Imports `overlay-data.json` and builds lookup structures indexed by solar system ID:
  - `SYSTEM_FACTION: Map<number, number | null>`
  - `SYSTEM_PLANET_COUNT: Map<number, number>`
  - `SYSTEM_PLANET_BITMASK: Map<number, number>`
  - `SYSTEM_MOON_COUNT: Map<number, number>`
  - `SYSTEM_HAS_NPC_STATION: Set<number>`
- Exports `PLANET_TYPES` array: `{ typeId: number; name: string; bit: number }[]`

**`web/src/hooks/useOverlayColors.ts`**
- Inputs: `overlayConfig: OverlayConfig | null`, `ids: number[]`, `pods: DecryptedPod[]`
- Returns: `{ colors: Float32Array | null; glowMask: Float32Array | null }`
- Uses `useMemo`; recomputes only when `overlayConfig` or `pods` changes
- `colors`: `Float32Array` of length `ids.length * 3` (RGB per system), or null when no overlay
- `glowMask`: `Float32Array` of length `ids.length` (0–1 per system), or null when mode ≠ `glow`
- Categorical filters: uses palette assignment from `overlayPalette.ts`
- Gradient filters: linear interpolation between a dark neutral and an accent color, normalized to dataset min/max

**`web/src/lib/overlayPalette.ts`**
- Exports a fixed base palette of at least 12 perceptually distinct colors
- Exports `assignCategoricalColors(categoryIds: number[], adjacency: Map<number, number[]>): Map<number, THREE.Color>` — greedy graph coloring over the adjacency graph, cycling the palette when all colors are exhausted, prioritizing high contrast between spatially neighboring categories
- Exports `gradientColor(value: number, min: number, max: number, from: THREE.Color, to: THREE.Color): THREE.Color`

---

### Inter-App Messaging

N/A — no iframe or postMessage involvement.

---

## Cross-Package Checklist

| Item | Answer |
|------|--------|
| New shared types needed | No — `OverlayConfig`, `OverlayFilter`, `OverlayMode` are web-internal only |
| New shared components needed | No |
| Consuming packages to update after shared pkg bump | N/A |
| Auth changes | No new auth. My Structures filter reuses the existing `useLocationPods` session flow (identical to LocationsPage). Filter is disabled when pods are unavailable. |
| Data passing strategy | `useOverlayColors` receives `ids[]` and `pods[]` from `MapPage`; returns typed Float32Arrays passed as props into Three.js components |
| Data store decision | All overlay state is local component state in `MapPage` (no persistence in v1). Static overlay data is bundled via Vite static import of `overlay-data.json`. |
| New static asset | `web/src/data/overlay-data.json` — generated by `scripts/build-overlay-data.mjs`, committed to repo alongside `solar-systems.json` |
| New generation script | `scripts/build-overlay-data.mjs` — reads from `static-data/`, writes to `web/src/data/` |
| Background processing | N/A |

---

## Definition of Done

### Feature correctness
- [ ] All 8 overlay filters render in **Color** mode; star colors visually match the data dimension (verified manually against known systems)
- [ ] **Glow** mode renders a visible additive-blended point layer; non-qualifying systems are visibly dimmed
- [ ] **Density Gradient** mode renders a semi-transparent haze that is denser over clusters of qualifying systems
- [ ] Switching filters updates all star colors within a single frame (no flash to white between transitions)
- [ ] Selected-system gold highlight renders on top of any active overlay color
- [ ] **Planet Type** filter shows a secondary selector listing all 7 named types (Temperate, Ice, Gas, Oceanic, Lava, Barren, Plasma)
- [ ] **My Structures** filter item is disabled (not hidden) when `useLocationPods` returns no pods; explanatory note is visible
- [ ] **My Structures** filter correctly highlights all systems containing at least one user POD location
- [ ] Selecting "None" removes all overlay colors and restores white default

### UI
- [ ] Sidebar renders **System** and **Overlays** tabs; switching tabs does not re-render the Three.js scene
- [ ] System tab content is identical to current `SystemInfoPanel` — no regression
- [ ] Legend renders categorical swatches for categorical filters and a gradient bar for numeric filters
- [ ] Legend updates immediately on filter or mode change

### Data pipeline
- [ ] `scripts/build-overlay-data.mjs` runs to completion and writes `web/src/data/overlay-data.json`
- [ ] Generated file contains entries for all 24,426 solar systems
- [ ] Faction IDs 500074, 500075, 500078 map to the three Ancient Civilization categories; all other systems have `null`

### Performance
- [ ] Color buffer recompute for 24,500 systems completes in < 16 ms (verified via `performance.now()` in dev)
- [ ] DensityGradientLayer redraws do not cause visible lag during camera pan/zoom
- [ ] `overlay-data.json` is served gzip-compressed (confirmed in browser Network tab)
