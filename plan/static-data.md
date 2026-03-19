# Static Data

## Overview
All static data lives in `static-data/data/phobos/fsd_built/` as JSON files extracted
from the game client via [Phobos](https://github.com/pyfa-org/Phobos). The files are
pre-committed and should not be modified by hand — they are the source of truth for all
in-game type, attribute, and fitting data.

---

## Key Files

### `types.json`
Maps `typeID (string)` → base type record.

Relevant fields:
- `typeName` — human-readable name (e.g. `"Skip"`)
- `groupID` — links to `groups.json`
- `mass`, `volume`, `capacity` — base physical stats
- `marketGroupID` — market category
- `metaGroupID` — meta tier
- `published` — `1` if visible in-game
- `iconID` — links to `iconids.json`
- `graphicID` — links to `graphicids.json` (ships/vehicles with 3D models)
- `tags` — array of tag IDs

Example — Skip module:
```json
"92389": {
  "typeName": "Skip",
  "groupID": 1289,
  "mass": 60000.0,
  "volume": 20.0,
  "published": 1
}
```

---

### `typedogma.json`
Maps `typeID (string)` → `{ dogmaAttributes, dogmaEffects }`.

This is the primary source for **fitting requirements** and **module attributes**.

- `dogmaAttributes` — array of `{ attributeID, value }` pairs
- `dogmaEffects` — array of `{ effectID, isDefault }` pairs

Slot type is determined by the `dogmaEffects` entry (see `dogmaeffects.json`).

Example — Skip module (`92389`) resolved attributes:

| attributeID | Name | Value | Meaning |
|---|---|---|---|
| 6 | `capacitorNeed` | 5.0 | Activation Cost (GJ) |
| 20 | `speedFactor` | 420.0 | Max Velocity Bonus (%) |
| 30 | `power` | 8.0 | Powergrid Usage (MW) |
| 50 | `cpu` | 5.0 | CPU Usage (tf) |
| 73 | `duration` | 6000.0 | Activation Duration (ms) |
| 567 | `speedBoostFactor` | 43000000.0 | Thrust |
| 669 | `moduleReactivationDelay` | 40000.0 | Reactivation Delay (ms) |
| 796 | `massAddition` | 0.0 | Mass Addition |
| 1298 | `canFitShipGroup01` | 31.0 | Fittable ship group |
| 1544 | `maxGroupFitted` | 1.0 | Max of this module group fitted |
| 5619 | `rechargePenalty` | 0.5 | Capacitor Recharge Penalty |
| 5707 | `maxAngularSpeedBonus` | -100.0 | Turn Rate Bonus (%) |
| 6060 | `AngularAgilityBonus` | -99.9 | Angular Agility Bonus |

Example — Skip module dogmaEffects:

| effectID | effectName | Meaning |
|---|---|---|
| 13 | `medPower` | **Medium slot module** |
| 16 | `online` | Can be onlined |
| 4160 | `massAddPassive` | Passive mass addition |
| 6730 | `moduleBonusMicrowarpdrive` | MWD behavior bonus |

---

### `industry_blueprints.json`
221 blueprints mapping inputs → outputs with `runTime`.

Fields per blueprint entry:
- `inputs` — array of `{ typeID, quantity }` input materials
- `outputs` — array of `{ typeID, quantity }` output items
- `primaryTypeID` — the main output type (used for display/lookup)
- `runTime` — base production time in seconds

**Note:** No assembly type information is stored here. Use `industry_facilities.json` to determine where a blueprint can be run.

---

### `industry_facilities.json`
Maps `facilityTypeID (string)` → facility record listing which blueprints can run there.

Fields per facility entry:
- `blueprints` — array of `{ blueprintID, maxInputRuns, maxOutputRuns }` entries
- `inputCapacity` — max total input volume the facility can accept
- `outputCapacity` — max total output volume the facility can produce

12 facilities are present, corresponding to the Industry-group smart assemblies:

| typeID | Name           |
|--------|----------------|
| 87119  | Mini Printer   |
| 87120  | Heavy Printer  |
| 87161  | Field Refinery |
| 87162  | Field Printer  |
| 88063  | Refinery       |
| 88064  | Heavy Refinery |
| 88067  | Printer        |
| 88068  | Assembler      |
| 88069  | Mini Berth     |
| 88070  | Berth          |
| 88071  | Heavy Berth    |
| 91978  | Nursery        |

**Lookup pattern — blueprint → valid facilities:**
The relationship is stored facility-first. To find which assemblies can run a given blueprint, invert the map at runtime: iterate all facility entries and collect those whose `blueprints[]` array contains the target `blueprintID`.

---

### `dogmaattributes.json`
Maps `attributeID (string)` → attribute metadata.

Relevant fields:
- `name` — internal attribute name (e.g. `"cpu"`, `"power"`)
- `displayName` — UI label (e.g. `"CPU usage"`, `"Powergrid Usage"`)
- `unitID` — links to `dogmaunits.json` for the unit of measure
- `defaultValue` — fallback if not set on a type
- `highIsGood` — whether higher values are beneficial

Use this to resolve raw `attributeID` integers from `typedogma.json` into names.

Key fitting-related attribute IDs:
- `30` — `power` — Powergrid Usage (MW)
- `50` — `cpu` — CPU Usage (tf)
- `6`  — `capacitorNeed` — Activation Cost (GJ)
- `73` — `duration` — Activation Duration (ms)

---

### `dogmaeffects.json`
Maps `effectID (string)` → effect metadata.

Used primarily to determine **slot type** of a module:

| effectID | effectName | Slot |
|---|---|---|
| 11 | `loPower` | Low slot |
| 12 | `hiPower` | High slot |
| 13 | `medPower` | Medium slot |

Other notable effects:
- `16` — `online` — module can be onlined
- `4160` — `massAddPassive` — passive mass applied while fitted

---

### `graphicids.json`
Graphic metadata — SOF hull names and icon folder paths.

### `iconids.json`
Standard icon file mappings (`iconID` → `res:/ui/texture/icons/…`).

### `groups.json`
Maps `groupID` → `{ groupName, categoryID, ... }`.
Use to determine the broader category of a type (e.g. Propulsion Modules, Weapons, etc.).

### `categories.json`
Maps `categoryID` → `{ categoryName, ... }`.
Top-level grouping above `groups.json` (e.g. Module, Ship, Charge).

### `dogmaunits.json`
Maps `unitID` → `{ unitName, displayName, ... }`.
Resolves the unit of measure for dogma attribute values (tf, MW, GJ, ms, %, etc.).

---

## Lookup Pattern

To fully describe a module:

1. Find `typeID` in `types.json` by `typeName` → base stats and `groupID`
2. Look up `typeID` in `typedogma.json` → raw attribute/effect pairs
3. Resolve `attributeID` values via `dogmaattributes.json` → names and units
4. Resolve `effectID` values via `dogmaeffects.json` → slot type and behaviors
5. Optionally resolve `groupID` via `groups.json` → module category

---

## Icon Extraction

### Two icon pipelines
Items in `types.json` reference icons via **two different systems**:

1. **Standard icons** (`iconID` field) — most modules, materials, ammo, etc.
   - `iconID` → `iconids.json` → `iconFile` path (e.g. `res:/ui/texture/icons/5_64_11.png`)
   - Extracted by `static-data/working-dir/extract_icons.py`

2. **SOF render icons** (`graphicID` field) — ships and vehicles with 3D models.
   - `graphicID` → `graphicids.json` → `iconInfo.folder` path
     (e.g. `res:/dx9/model/SpaceObjectFactory/icons/data_frig_mine_01`)
   - Pre-rendered PNGs exist at `{folder}/{graphicID}_{size}.png` (sizes: 64, 128, 512)
   - These are **not** extracted by the existing `extract_icons.py` script, which only
     handles `iconID`-based lookups.

### Extraction from game client
Both pipelines resolve to files inside the game client's `ResFiles` directory. The
`resfileindex.txt` maps virtual resource paths to physical file locations:

```
Game client:   /media/djones/Games/CCP/EVE Frontier/
ResFiles:      /media/djones/Games/CCP/EVE Frontier/ResFiles/
Index:         /media/djones/Games/CCP/EVE Frontier/stillness/resfileindex.txt
```

Format of resfileindex.txt:
```
<virtual_path>,<physical_subpath>,<hash>,<size1>,<size2>
```

Physical file = `ResFiles/<physical_subpath>`

---

## Ship & Vehicle Type Mapping

### Frontier-specific ships (craftable from frames)

| typeID | Name    | Frame Used                  | graphicID | SOF Hull              |
|--------|---------|-----------------------------|-----------|-----------------------|
| 81609  | USV     | Archangel Protocol Frame    | 27372     | data_frig_mine_01     |
| 81611  | Chumaq  | Equilibrium Program Frame   | 27370     | trad_bcr_haul_01      |
| 81808  | TADES   | Apocalypse Protocol Frame   | 27401     | data_dest_assa_01     |
| 81904  | MCF     | Exterminata Protocol Frame  | 27373     | data_frig_heavy_01    |
| 82424  | HAF     | Exterminata Protocol Frame  | 27377     | data_frig_assa_01     |
| 82425  | LAI     | Exterminata Protocol Frame  | 27407     | data_frig_light_01    |
| 82426  | LORHA   | Bastion Program Frame       | 27375     | data_frig_haul_01     |
| 82430  | MAUL    | Apocalypse Protocol Frame   | 27405     | data_cr_assa_01       |
| 85156  | Forager | (no blueprint)              | 28005     | syn_corv_mine_01      |
| 87698  | Wend    | Nomad Program Frame         | 28382     | data_kayak_01         |
| 87846  | Recurve | Nomad Program Frame         | 28380     | data_longbow_01       |
| 87847  | Reflex  | Nomad Program Frame         | 28320     | data_shortbow_01      |
| 87848  | Reiver  | Nomad Program Frame         | 26977     | ship_data_corv_01     |
| 91106  | Stride  | Nomad Program Frame         | 28931     | trad_corv_01          |
| 91107  | Carom   | Nomad Program Frame         | 28934     | trad_corv_02          |

### Starter ships (already had icons)

| typeID | Name      |
|--------|-----------|
| 77728  | Sophrogon |
| 77753  | Embark    |

### Ship frames (already had icons)

| typeID | Name                        | Blueprint inputs                               |
|--------|-----------------------------|------------------------------------------------|
| 78416  | Apocalypse Protocol Frame   | Still Knot ×1, Echo Chamber ×1, Kerogen Tar ×128 |
| 78417  | Bastion Program Frame       | Still Knot ×1, Echo Chamber ×1, Kerogen Tar ×38  |
| 78418  | Nomad Program Frame         | Fossilized Exotronics ×5                         |
| 78420  | Archangel Protocol Frame    | Still Knot ×1, Echo Chamber ×1, Kerogen Tar ×38  |
| 78421  | Exterminata Protocol Frame  | Still Knot ×1, Echo Chamber ×1, Kerogen Tar ×38  |
| 78422  | Equilibrium Program Frame   | Still Knot ×1, Echo Chamber ×1, Aromatic Carbon Weave ×1347 |

### Shells (craftable from frames, already had icons)

| typeID | Name             | Frame Used                  |
|--------|------------------|-----------------------------| 
| 91749  | Reaping Shell    | Exterminata Protocol Frame  |
| 91967  | Aggressive Shell | Nomad Program Frame         |
| 91968  | Rugged Shell     | Apocalypse Protocol Frame   |

---

## Giveitem Helper Coverage

### Current state
`dev-tools/giveitem-helper/public/items.json` now contains **238 items** — full coverage
of every type ID referenced by the 221 blueprints, plus starter ships, the Forager,
and the Synod/Exclave Technocore manufacturing components.

Icons are stored in `dev-tools/giveitem-helper/public/icons/` and the canonical copies
live in `static-data/data/icons/`.

### Icon extraction results
- **120 items** extracted via standard `iconID` pipeline (modules, ammo, materials, etc.)
- **15 items** extracted via SOF `graphicID` pipeline (ships/vehicles)
- **4 items** have transparent placeholder icons (no icon data in game client):
  - 77729 — Rough Old Crude Matter (no iconID, no graphicID)
  - 78434 — Rough Young Crude Matter (no iconID, no graphicID)
  - 92394 — Fine Young Crude Matter (graphicID exists but no SOF icon render)
  - 92414 — Fine Old Crude Matter (graphicID exists but no SOF icon render)

### Blueprint-referenced item categories
- Raw materials & ores (Feldspar, Nickel-Iron, Silicon Dust, Tholin, Crude Matter variants, etc.)
- Refined materials (Printed Circuits, Reinforced Alloys, Carbon Weave, Thermal Composites, batched/packaged)
- Technocores (Synod Technocore, Exclave Technocore)
- Fuels (D1, D2, EU-40, EU-90, SOF-40, SOF-80)
- Ship frames (6 types: Apocalypse, Bastion, Nomad, Archangel, Exterminata, Equilibrium)
- Ships & vehicles (15 craftable + 2 starters + Forager)
- Shells (Aggressive, Reaping, Rugged)
- Ship stacks & stack slices (Stride Stack, Carom Stack, 10 slice variants)
- Weapons — small & medium (Autocannons, Coilguns, Howitzers, Rapid Plasma, Cutting Lasers, Cryogenic Ejector)
- Ammo (AC Gyrojet, Rapid Plasma, Coilgun, Howitzer, EM Disintegrator — S and M sizes)
- Armor modules (Bulky/Coated/Reactive/Nimble Armor Plates, Armor Restorers, Nanitic Armor Weaves)
- Shield modules (Bulwark/Attuned/Reinforced Shield Generators, Shield Restorers, Field Arrays)
- Nanite braces (Thermal-electro, Explonetic-electro, Explo-electro, Thermalnetic — tiers II-IV)
- Navigation (Afterburners II-IV, Warp Entanglers II-VI, Stasis Nets II-VI)
- Propulsion (Hop, Skip, Lunge, Drive components — Velocity/Celerity/Tempo)
- Cargo (Cargo Grid II-VI)
- Mining lenses (Synthetic, Eclipsite, Radiantium, Gravionite, Luminalis)
- Nanite sequencers (Kinetic, Explosive, EM, Thermal)
- Utility (Hull Repairer, Heat Exchangers, Building Foam, Sojourn, Compressed Coolant)

---

## Structure & Smart Assembly Icons

All structures and smart assemblies live in category 22 (Deployable) in `types.json`.
They use the SOF `graphicID` pipeline (not `iconID`) for icons. Pre-rendered PNGs
exist in the game client at 64px, 128px (PNG), and 512px (JPG) sizes.

None of these icons have been extracted yet. Extraction follows the same SOF
pipeline documented in the Icon Extraction section above.

### Published Smart Assemblies by Group

#### Core (group 4885) — 5 structures

| typeID | Name           | graphicID | SOF Hull                   |
|--------|----------------|-----------|----------------------------|
| 87160  | Refuge         | 28046     | dep_hangar_s_01v01         |
| 87161  | Field Refinery | 28053     | dep_refinery_s_01v01       |
| 87162  | Field Printer  | 27957     | dep_smart_printer_s_01     |
| 87566  | Field Storage  | 27959     | dep_smart_warehouse_s_01   |
| 88092  | Network Node   | 28034     | dep_base_core_01v01        |

#### Industry (group 4848) — 11 structures

| typeID | Name          | graphicID | SOF Hull                       |
|--------|---------------|-----------|--------------------------------|
| 87119  | Mini Printer  | 28050     | dep_printer_s_01v01            |
| 88067  | Printer       | 28049     | dep_printer_m_01v01            |
| 87120  | Heavy Printer | 28048     | dep_printer_b_01v01            |
| 88063  | Refinery      | 28052     | dep_refinery_m_01v01           |
| 88064  | Heavy Refinery| 28051     | dep_refinery_b_01v01           |
| 88069  | Mini Berth    | 28056     | dep_shipyard_s_01v01           |
| 88070  | Berth         | 28055     | dep_shipyard_m_01v01           |
| 88071  | Heavy Berth   | 28054     | dep_shipyard_b_01v01           |
| 88068  | Assembler     | 28033     | dep_assembly_line_s_01v01      |
| 90184  | Relay         | 28941     | dep_terminal_s_01v01           |
| 91978  | Nursery       | 29354     | dep_clone_facility_m           |

#### Storage (group 4849) — 3 published structures

| typeID | Name          | graphicID | SOF Hull                     |
|--------|---------------|-----------|------------------------------|
| 88082  | Mini Storage  | 27959     | dep_smart_warehouse_s_01     |
| 88083  | Storage       | 28063     | dep_warehouse_m_01v01        |
| 77917  | Heavy Storage | 26307     | dep_smart_storage_01v01      |

#### Gates (group 4850) — 2 structures

| typeID | Name       | graphicID | SOF Hull                |
|--------|------------|-----------|-------------------------|
| 88086  | Mini Gate  | 28064     | dep_stargate_s_01v01    |
| 84955  | Heavy Gate | 26510     | st_gen_02v01            |

#### Defense (group 4851) — 3 structures

| typeID | Name         | graphicID | SOF Hull             | Icons  |
|--------|--------------|-----------|----------------------|--------|
| 92279  | Mini Turret  | 28243     | dep_turret_s_01v01   | ❌ Use 28244 fallback |
| 92401  | Turret       | 28244     | dep_turret_m_01v01   | ✅     |
| 92404  | Heavy Turret | 28245     | dep_turret_b_01v01   | ❌ Use 28244 fallback |

Mini Turret and Heavy Turret have `sofHullName` but no `iconInfo.folder` and no
pre-rendered PNGs. Use the mid-size Turret icon (graphicID 28244) as fallback.

#### Hangars (group 4854) — 3 structures

| typeID | Name          | graphicID | SOF Hull                |
|--------|---------------|-----------|-------------------------|
| 91871  | Nest          | 29353     | dep_clone_hangar_m      |
| 88093  | Shelter       | 28045     | dep_hangar_m_01v01      |
| 88094  | Heavy Shelter | 28044     | dep_hangar_b_01v01      |

#### Miscellaneous / Decorative (group 4855) — 10 structures

| typeID | Name          | graphicID | SOF Hull              |
|--------|---------------|-----------|-----------------------|
| 88098  | Monolith 1    | 28058     | dep_totem_s_01v01     |
| 88099  | Monolith 2    | 28059     | dep_totem_s_02v01     |
| 88100  | Wall 1        | 28060     | dep_wall_b_01v01      |
| 88101  | Wall 2        | 28061     | dep_wall_b_01v02      |
| 89775  | SEER I        | 28394     | dep_totem_b_01v01     |
| 89776  | SEER II       | 28395     | dep_totem_b_01v02     |
| 89777  | HARBINGER I   | 28396     | dep_totem_b_02v01     |
| 89778  | HARBINGER II  | 28397     | dep_totem_b_02v02     |
| 89779  | RAINMAKER II  | 28398     | dep_totem_m_01v01     |
| 89780  | RAINMAKER I   | 28399     | dep_totem_m_01v02     |

#### Beacon (group 4814) — 1 structure

| typeID | Name              | graphicID | SOF Hull                 |
|--------|-------------------|-----------|--------------------------|
| 85291  | Deployable Beacon | 26471     | ph_prop_cube_gen_01v01   |

### Construction site duplicates (group 5021)

Every published smart assembly above also has a Construction site counterpart
(different typeID, same graphicID). These share icons with the active versions.

### Icon coverage summary
- **38 published smart assemblies** across 8 groups (Core, Industry, Storage,
  Gates, Defense, Hangars, Misc, Beacon)
- **35 unique graphicIDs** with pre-rendered icons in the game client
- **2 graphicIDs missing icons** (Mini Turret 28243, Heavy Turret 28245) —
  use Turret (28244) as fallback
- 512px renders are JPGs; 64px and 128px are PNGs
- `_no_background` variants also available for most

---

## Item Grouping & Classification

The static data provides four grouping systems that can be used to organize items in
UI contexts. The fields live on each type record in `types.json`.

### 1. Category → Group hierarchy (primary structure)
Resolution: `types.json` → `groupID` → `groups.json` → `categoryID` → `categories.json`

100% coverage across all 238 items. Clean 2-level tree.

**7 categories, ~40 groups across our items:**

- **Ship** (15 items): Corvette (5), Frigate (5), Shuttle (2), Destroyer (1), Cruiser (1), Combat Battlecruiser (1)
- **Module** (118 items): Defensive System (21), Shield Hardener (13), Nanitic Brace (12),
  Crude Engines (7), Energy Lance (6), Mass Driver Weapon (6), Plasma Weapon (6),
  Projectile Weapon (6), Expanded Cargohold (5), Stasis Web (5), Warp Scrambler (5),
  Warp Accelerator (4), Propulsion Module (3), Armor Repair Unit (3), Asteroid Mining Laser (3),
  Flex Armor Hardener (3), Heat Ejector (3), Shield Recharger (3), Hydrogen Engines (2),
  Crude Extractor (1), Hull Repair Unit (1)
- **Charge** (21 items): Asteroid Mining Crystal (5), Nanitic Armor Weave Sequencer (4),
  Gyrojet Ammunition (3), Plasma Charge (3), Coilgun Charge (2),
  EM Disintegrator Charge (2), Projectile Ammo (1), Heat Sink Charge (1)
- **Material** (42 items): Manufacturing Component (23), Mineral (14), Rogue Drone Components (5)
- **Commodity** (27 items): Miscellaneous (12), Exotronic Frames (7), Crude Fuel (4),
  Hydrogen Fuel (2), Salvage (2)
- **Asteroid** (12 items): Rift (4), plus Char/Comet/Dewdrop/Ember/Glint/Ingot/Slag/Soot Ores (1 each)
- **Shell** (3 items): Synthetic (3)

### 2. Tags (cross-cutting filters)
Resolution: `types.json` → `tags[]` → `tags.json` → `internalName`

98 of 238 items have tags (mostly modules, ships, charges). Tags are multi-valued.
Useful tag families:

- **Slot type**: `high_slot` (14), `mid_slot` (19), `low_slot` (13), `engine_slot` (9)
- **Size**: `small_size` (27), `medium_size` (24), `large_size` (4)
- **Role**: `defense` (23), `mining` (9), plus specialized module-family tags
- **Origin/faction**: `Synod` (16), `Exclave` (24)
- **Industry grade**: `industry_grade_0` through `industry_grade_6`

### 3. Meta Group (quality/rarity tier)
Resolution: `types.json` → `metaGroupID` → `metagroups.json` → `name`

135 of 238 items have a `metaGroupID`. Tier progression:

Basic (9) → Standard (42) → Enhanced (40) → Prototype (30) → Experimental (10) → Exotic (4)

### 4. Market Group (alternative hierarchy)
Resolution: `types.json` → `marketGroupID` → `marketgroups.json` → `parentGroupID` (tree)

226 of 238 items have a `marketGroupID`. Provides a deeper market-oriented tree with
`parentGroupID` for nesting. Overlaps heavily with Category→Group but has more levels.

### Recommended UI approach
- **Primary navigation**: Category → Group (2-level tree, 100% coverage)
- **Filters/facets**: Tags for slot type, size, and role
- **Tier badge/indicator**: `metaGroupID` for rarity/quality coloring

---

## Solar System / Starmap Data

### Static data files

#### `res__staticdata_starmapcache.json`
24,426 solar systems keyed by system ID (e.g. `"30000001"`).

Fields per system:
- `center` — `[x, y, z]` float64 coordinates (galactic absolute, meters)
- `constellationID` — integer
- `regionID` — integer
- `factionID` — integer (nullable)
- `sunTypeID` — integer
- `neighbours` — array of neighbor system IDs with jump types

**No `name` field exists.** System names are stored separately in the localization file.

#### `res__localizationfsd_localization_fsd_en-us.json`
Contains ~23,301 map name entries (messageIDs 825730–860000) with system, constellation,
and region names interleaved. Names are keyed by sequential `messageID`, **not** by
system ID. There is no mapping table between `messageID` and `systemID` in the available
static data.

Attempted approaches to derive a mapping:
- Walking the region→constellation→system hierarchy and assuming sequential messageID
  assignment — produced incorrect mappings (messageIDs are not assigned in hierarchy order).
- Cross-referencing with the World API confirmed the ordering does not match.

### World API comparison
The Stillness World API (`/v2/solarsystems`) provides 24,502 systems with:
- `id` — system ID
- `name` — human-readable name (e.g. "A 2560")
- `constellationId`, `regionId`
- `location: { x, y, z }` — exact integer coordinates

The API has 76 more systems than the starmap cache (24,502 vs 24,426).

### Coordinate precision comparison
Starmap cache uses float64; API uses exact integers.

- Max absolute error per axis: ~1.4e12 meters (~9.4 AU, ~0.0001 LY)
- Max relative distance error: ~2.6e-4 (tested on systems 30000004↔30000005)
- For a "within 10 LY" proximity claim: error margin is 0.001% — negligible
- For sub-LY proximity claims: error is still only ~9 AU

Float64 precision is adequate for display and coarse proximity, but the API's exact
integers are preferred for cryptographic commitments (Poseidon hashes) and on-chain
verifiable proximity claims where bit-exact values matter.

### Coordinate handling notes
- Z-axis values can reach ~7.6e19, exceeding JS `Number.MAX_SAFE_INTEGER` (9e15).
  Must use BigInt in TypeScript / string representation in JSON.
- On-chain representation adds `1 << 255` to each component (unsigned offset).
- Axis transform for 3D rendering: `(x, y, z)_api → (x, z, -y)_display` per
  [scetrov coordinate docs](https://frontier.scetrov.live/develop/coordinate_systems/).

### Conclusion
The World API is the only reliable source for solar system data — it pairs IDs with
names (which the static data cannot) and provides exact integer coordinates. The build
script `scripts/fetch-solar-systems.ts` fetches from the API and commits the result as
`web/src/data/solar-systems.json`.
