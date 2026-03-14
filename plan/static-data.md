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
`dev-tools/giveitem-helper/public/items.json` now contains **236 items** — full coverage
of every type ID referenced by the 221 blueprints, plus starter ships and the Forager.

Icons are stored in `dev-tools/giveitem-helper/public/icons/` and the canonical copies
live in `static-data/data/icons/`.

### Icon extraction results
- **118 items** extracted via standard `iconID` pipeline (modules, ammo, materials, etc.)
- **15 items** extracted via SOF `graphicID` pipeline (ships/vehicles)
- **4 items** have transparent placeholder icons (no icon data in game client):
  - 77729 — Rough Old Crude Matter (no iconID, no graphicID)
  - 78434 — Rough Young Crude Matter (no iconID, no graphicID)
  - 92394 — Fine Young Crude Matter (graphicID exists but no SOF icon render)
  - 92414 — Fine Old Crude Matter (graphicID exists but no SOF icon render)

### Blueprint-referenced item categories
- Raw materials & ores (Feldspar, Nickel-Iron, Silicon Dust, Tholin, Crude Matter variants, etc.)
- Refined materials (Printed Circuits, Reinforced Alloys, Carbon Weave, Thermal Composites, batched/packaged)
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
