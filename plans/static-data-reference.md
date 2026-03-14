# Static Data Reference

All static data lives in `static-data/data/phobos/fsd_built/` as JSON files extracted
from the game client via Phobos. The files are pre-committed and should not be modified
by hand — they are the source of truth for all in-game type, attribute, and fitting data.

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
