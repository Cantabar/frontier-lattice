# Discovery: Map Overlays

## Problem Statement

The galaxy map currently renders all solar systems as identical white points with no data-driven visual differentiation. Players have no way to visually understand the spatial distribution of game data (faction territory, planet resources, asteroid belts, their own structures, etc.) without clicking individual systems. This feature adds a data overlay system that encodes game attributes as visual properties of the stars themselves.

## User Story

As a player, I want to apply data overlays to the galaxy map so that I can visually identify regions of interest — faction territory, resource-rich systems, my structure locations — without having to click each system individually.

## Acceptance Criteria

### Overlay Render Modes
Three distinct visual render modes, selectable per filter:

- [ ] **Color Mode** — Changes the vertex color of each star's point based on its data value. Uses the existing per-vertex color buffer in `SolarSystemPoints`. Default mode.
- [ ] **Glow Mode** — Stars satisfying the filter become slightly larger and emit a soft glow (additive-blended second Points layer with transparency). Non-matching stars dim slightly.
- [ ] **Density Gradient Mode** — A background gradient layer reflects the local density of matching stars — clusters of qualifying systems produce visible "clouds" of color. Implemented as a projected texture or shader pass over the scene.

Only one overlay render mode may be active per filter at a time.

### Overlay Filters (Data Dimensions)
Each filter below can be applied using any of the three render modes:

| Filter | Data Source | Color Scheme | Coverage |
|--------|-------------|--------------|----------|
| Region | `solar-systems.json` | Categorical — cycling palette, high-contrast between adjacent regions | 100% |
| Constellation | `solar-systems.json` | Categorical — cycling palette, high-contrast between adjacent constellations | 100% |
| Ancient Civilizations | `res__staticdata_starmapcache.json` (`factionID`) | Categorical — 4 predefined colors (3 factions + unclaimed) | 100% |
| Planet Count | `res__staticdata_starmapcache.json` (`planetCountByType`) | Gradient — 0 planets (dark) → high count (bright) | ~98% |
| Planet Type | `res__staticdata_starmapcache.json` (`planetCountByType`) | Per-type selection: user picks one of 7 named types; systems containing that type highlighted, others dimmed | ~98% |
| Moon Count | `app__bin64_staticdata_mapObjects_celestials.json` (groupID=8) | Gradient — 0 moons (dark/neutral) → 47 moons (bright/rich) | 100% (0 = no moons) |
| NPC Stations | `app__bin64_staticdata_mapObjects_npcStations.json` | Categorical — has station / no station (2 colors) | 100% |
| My Structures | Shadow Location Network (decrypted PODs, auth required) | Categorical — has my structure / no structure (2 predefined colors) | Auth-gated; graceful fallback when not authenticated |

#### Planet Type Names (from `fsd_built/types.json`)
| Type ID | Name |
|---------|------|
| 11 | Planet (Temperate) |
| 12 | Planet (Ice) |
| 13 | Planet (Gas) |
| 14 | Planet (Oceanic) |
| 2015 | Planet (Lava) |
| 2016 | Planet (Barren) |
| 2063 | Planet (Plasma) |

#### Note on Asteroid Belts
There are no asteroid belt entries in the available static data. What appeared to be groupID=10 "belts" are actually **Stargate (O-Type)** and **Stargate (R-Type)** objects — already excluded per scope. Moon Count (groupID=8, range 0–47) serves as the resource-richness proxy instead.

### Color Scheme Rules
- **Categorical data** (clear delineation between values): predefined color per category
- **Numeric data** (continuous or ordered scale): gradient from neutral/dark → accent color

### UI — Sidebar Tabs
- [ ] The existing right-hand info sidebar gains two tabs: **System** (existing content, unchanged) and **Overlays** (new)
- [ ] The **Overlays** tab contains:
  - A filter selector (which data dimension to visualise)
  - A render mode selector (Color / Glow / Density Gradient)
  - A color legend appropriate to the active filter (category swatches or gradient bar)
  - For Planet Type filter: a secondary selector for which planet type to highlight
- [ ] When no overlay is active, all stars render as the current default (white)
- [ ] The System tab continues to show info for the clicked/selected system regardless of overlay state

### My Structures Overlay (Auth)
- [ ] Requires the user to have authenticated with the Shadow Location Network (same flow as LocationsPage)
- [ ] When not authenticated, the "My Structures" filter option is visible but disabled, with a prompt to authenticate on the Locations page
- [ ] When authenticated, PODs are decrypted client-side; systems with at least one structure are highlighted

## Out of Scope

- Gate connectivity and connectivity degree overlays (explicitly excluded)
- Asteroid belt overlays (no asteroid belt data in static data — stargates use same groupID and are already excluded)
- Multi-overlay layering (only one overlay active at a time)
- Overlays for tribe structures (tribe PODs require TLK distribution — deferred)
- Public location tags as an overlay (region/constellation level only, redundant with static overlays)
- Security status overlay (not present in static data)
- Sun type overlay (only one unique sun typeID in the dataset — no differentiation)
- User-configurable custom color palettes
- Saving/persisting overlay selection across sessions (future)

## Open Questions

- None — all prior questions resolved.

## Package Scope

- [x] `web` — primary implementation (MapPage, GalaxyMap, SolarSystemPoints, new overlay components, sidebar tabs)
- [ ] `static-data` — no changes required; data already present in existing JSON files
- [ ] `indexer` — no changes required; My Structures overlay uses existing location POD API
