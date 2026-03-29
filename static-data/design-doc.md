# Static Data

## Overview

The static-data directory holds Eve Frontier game data extracted from the Phobos data export and icon assets. This data is used to enrich in-game items with metadata (categories, groups, tiers, tags) and provide icon assets for the web UI and contracts.

## Architecture

```
Phobos export (Eve Frontier)
    │
    ▼
working-dir/
    ├─ phobos/          Raw Phobos JSON exports
    ├─ extract_icons.py         Extract item icons
    └─ extract_structure_icons.py  Extract structure icons
    │
    ▼
data/
    ├─ phobos/          Processed game data (items, types, groups)
    └─ icons/           Extracted icon assets
```

### Components

- **Phobos Data** (`data/phobos/`, `working-dir/phobos/`) — raw and processed JSON exports from Eve Frontier's Phobos data export tool. Contains item type definitions, group hierarchies, and metadata.
- **Icon Extraction** (`working-dir/extract_icons.py`, `working-dir/extract_structure_icons.py`) — Python scripts that extract and organize icon assets from the Phobos export.
- **Item Enrichment** (`scripts/enrich-items.mjs`) — Node.js script (at project root) that reads Phobos data and enriches `items.json` with category, group, tier, and tag metadata for use by the web UI and contracts.
- **Ore Seeding** (`scripts/seed-ores.ts`) — TypeScript script that seeds ore items into a Smart Storage Unit for local testing (requires world-contracts deployed).

## Tech Stack

- **Extraction:** Python 3
- **Enrichment:** Node.js (ES modules)
- **Seeding:** TypeScript (tsx)

## Configuration

No environment variables. Scripts read from local file paths within the directory.

## API / Interface

Makefile targets (from project root):

- `make enrich-items` — run the item enrichment script
- `make seed-ores` — seed ore items into SSU for Player A

## Data Model

- `data/phobos/` — JSON files with Eve Frontier type/group/category hierarchies
- `data/icons/` — PNG icon assets organized by item type
- Enriched `items.json` — flat JSON with fields: `typeId`, `name`, `category`, `group`, `tier`, `tags`, `iconPath`

## Deployment

Not deployed — data is consumed at build time by the web frontend and at runtime by seeding scripts. Icons are bundled into the web build.

## Features

- Phobos data extraction and processing for Eve Frontier item types, groups, and categories
- Icon extraction scripts for item and structure icons
- Item enrichment with category, group, tier, and tag metadata
- Ore seeding for local SSU testing
- Makefile targets for enrichment and seeding workflows

## Open Questions / Future Work

- Automate Phobos re-export when Eve Frontier updates game data
- Include structure type metadata for witnessed contract UI
- Version tracking for data freshness
