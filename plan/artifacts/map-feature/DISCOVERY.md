# Discovery: 3D Solar System Map

## Problem Statement

The web app has no spatial visualization of the Eve Frontier universe. Players cannot orient themselves geographically — they can look up a system by name, but cannot see where it sits relative to others. The static data already contains coordinates for ~24,500 solar systems (with ~26k expected once the Stillness API is fully populated); the map feature will render these in an interactive 3D view as a new standalone page.

## User Story

As a player using the Frontier Corm web app, I want to explore the Eve Frontier universe on an interactive 3D map so that I can visually navigate the solar system layout and select systems of interest.

## Acceptance Criteria

- [ ] A new "Map" page is accessible from the main navigation
- [ ] All ~24,500+ solar systems are rendered as 3D points in their correct spatial positions
- [ ] The map supports mouse-driven orbit (rotate), pan, and scroll-wheel zoom
- [ ] Clicking a solar system point selects it and surfaces its name and basic metadata (ID, constellation, region) in a sidebar or HUD panel
- [ ] The selected system remains visually distinguished (e.g. highlighted colour or size) after click
- [ ] Initial camera position frames the full galaxy on load
- [ ] Frame rate is acceptable (≥30 fps) on a mid-range machine with all systems loaded

## Out of Scope

- Live game data overlays (tribe locations, active contracts, gate status) — planned for a future iteration; map must be designed to accept overlay layers without structural changes
- Constellation / region highlight on selection — planned follow-on interaction
- Solar system detail modal (in-system view) — planned follow-on
- Search-to-fly-to navigation
- Embedding the map within other pages (e.g. Locations) — standalone page only for now

## Package Scope (preliminary)

- [ ] `web` — new `MapPage` component + `SolarSystemMap` 3D canvas; add route + nav entry
- [ ] `web` — new dependencies: `@react-three/fiber`, `@react-three/drei`, `three`, `three-mesh-bvh` (for raycasting at scale)

## Open Questions

*None — resolved during discovery.*

- System count: 24,502 is the expected count; no data gap to investigate.
- Point colour: solid-colour points for initial implementation (no per-region colouring).
