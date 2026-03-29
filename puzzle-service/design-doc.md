# Puzzle Service

## Overview

The puzzle service is the player-facing game server for Frontier Corm's Continuity Engine. It serves an HTMX-driven UI where players interact with a corm through three phases: awakening (Phase 0), SUI address discovery puzzles (Phase 1), and trustless contracts (Phase 2). It acts as a bidirectional relay between players' browsers and the corm-brain AI backend.

## Architecture

```
Browser (HTMX)                   puzzle-service                    corm-brain
┌───────────────┐   HTTP/SSE    ┌─────────────────────┐   WS     ┌──────────┐
│  Phase 0 UI   │ ◄──────────► │  Handlers           │ ◄──────► │  AI      │
│  Puzzle Grid  │               │    ├─ Phase0        │          │  Engine  │
│  Contracts    │               │    ├─ Puzzle        │          └──────────┘
│  Log Stream   │               │    ├─ Contracts     │
└───────────────┘               │    └─ Stream (SSE)  │
                                ├─────────────────────┤
                                │  Session Store      │
                                │    └─ In-memory map │
                                ├─────────────────────┤
                                │  Corm Relay         │
                                │    ├─ WS hub        │
                                │    └─ Event buffer  │
                                └─────────────────────┘
```

### Key Components

- **Session Store** (`internal/puzzle`) — in-memory concurrent map of player sessions. Each session tracks phase, puzzle state (grid, cipher params, target address, decrypted/garbled cells), AI hint state, click logs, stability/corruption meters, and a corm event ring buffer.
- **Corm Relay** (`internal/corm`) — WebSocket hub that accepts connections from corm-brain. Broadcasts player events to all connected brains and dispatches corm actions (log streams, difficulty adjustments, hint toggles, state syncs) back to the target session's action channel.
- **Handlers** (`internal/handlers`) — HTTP handlers for each game interaction, returning HTMX partial HTML fragments. The decrypt handler implements three distinct code paths: address group reveal, trap explosion, and normal cell decrypt — each with pulse data for client-side animation.
- **Puzzle Generator** (`internal/puzzle`) — creates 20×20 cipher grids with configurable difficulty. Places a target SUI address, decoy addresses, trap nodes, and sensor nodes, then applies a tiered cipher.

### Game Phases

- **Phase 0 (Awakening)** — player clicks UI elements on a dead terminal; after a random threshold (3–5 clicks) the corm "awakens" and transitions to Phase 1 via an animated rewrite sequence.
- **Phase 1 (Puzzle)** — player decrypts cells in a cipher grid to discover a hidden SUI address among decoys. Sensor nodes provide proximity information. Trap nodes explode and permanently garble nearby cells. AI controls hint systems (heatmap, vectors, decode, signal) and adjusts difficulty dynamically.
- **Phase 2 (Contracts)** — player interacts with on-chain trustless contracts through the corm.

## Phase 1 Mechanics

### SUI Address Discovery

The puzzle target is a shortened SUI address (12 characters: `0x` + 10 hex chars) hidden in the cipher grid. The grid also contains 4+ decoy addresses of the same format. All addresses are placed horizontally.

Cells belonging to the same address share a `StringID` (e.g. `"target_main"`, `"decoy_0"`). **Clicking any cell of an address reveals the entire address** — all cells with the same StringID are decrypted simultaneously. The clicked cell is returned as the primary HTMX swap target and the remaining cells are returned as OOB `outerHTML` swaps so the fixed-size grid is updated in place instead of gaining extra DOM nodes.

**Auto-complete on target discovery:** When the target address is revealed (via clicking any of its cells), the puzzle auto-completes: stability is gained, the solve count increments, a `submit` event (with `auto_discovered: true`) is emitted to corm-brain, and a **"PATTERN ANCHOR ISOLATED" overlay** replaces the grid. The overlay displays the confirmed address, stability gain, and solve count, with a `[ RESOLVE NEXT ANCHOR ]` button the player must click to proceed to the next puzzle. The overlay elements use staggered fade-in animations. Target address cells briefly receive a `cell--target-locked` glow animation before the overlay appears.

Players can also type the full address into the terminal input (`submit 0x...`) to win without clicking the address cells directly — this remains as a secondary win path.

### Cell Types

- **Noise** — random hex characters (`0-9a-f`) filling 40% of empty cells. Blends with address content.
- **Symbol** — non-alphabet printable ASCII (`#@%&*~^|<>{}[]` etc.) filling 60% of empty cells.
- **Target** — cells of the hidden SUI address. White text on reveal, green border.
- **Decoy** — cells of decoy addresses. Same reveal behavior as target but no win.
- **Trap** — anomaly nodes. On reveal, explode with Euclidean radius 3, permanently garbling all cells in the blast zone (setting them to `CellGarbled`). Garbled cells display a purple flickering glyph and cannot be interacted with. The clicked trap cell is returned as the primary swap and the rest of the blast zone is returned as OOB `outerHTML` swaps so the grid dimensions stay stable. If any target address cell is caught in the explosion, the game is over.
- **Sensor** — hint nodes (~0.8% of noise/symbol cells). Three subtypes:
  - **Sonar** `[S]` (cyan) — on reveal, triggers a triple pulse: 3 pulses at 1-second intervals, Euclidean radius 5, revealing the color signature of all cells in range.
  - **Thermal** `[T]` (blue) — on reveal, shows proximity-based coloring (distance to target).
  - **Vector** `[V]` (gold) — on reveal, shows directional indicators pointing toward the target.
- **Garbled** — permanently corrupted by trap explosion. Purple flicker, no interaction.

### Pulse System

Every cell decrypt triggers a **localized sonar pulse** (Euclidean radius 2) centered on the clicked cell. Unrevealed, non-garbled cells in range briefly flash with a color indicating their type:

- Green — target or decoy address cell
- Red — trap / anomaly
- Cyan — sonar sensor
- Blue — thermal sensor
- Gold — vector sensor
- Dim white — noise or symbol

The pulse is delivered as a server-side JSON payload in a hidden `#pulse-data` div (OOB-swapped). Client-side JavaScript reads the JSON, applies temporary CSS animation classes (`cell--pulse-{color}`) to the affected cells, and removes them after 1 second.

Sonar sensor nodes override the default radius 2 pulse with a **triple pulse** at radius 5 with 1-second intervals between each iteration. The JSON payload includes `pulseCount` and `pulseInterval` fields that the JS pulse handler uses to schedule repeated animations.

### Color-Coded Legend

A legend panel in the left sidebar displays the node key:
- `[S]` Sonar (cyan)
- `[T]` Thermal (blue)
- `[V]` Vector (gold)
- `■` Anomaly (red)

### Cipher Tiers

- **Tier 1 — Caesar Shift (puzzles 1–3):** fixed shift for entire grid
- **Tier 2 — Variable Shift (puzzles 4–6):** per-row shift values
- **Tier 3 — Position-Based Shift (puzzles 7+):** shift = f(row, col)

All ciphers operate on printable ASCII range 0x21–0x7E (94 characters). The cipher parameters are never sent to the client.

### Difficulty Scaling

Base grid size is 20×20. Difficulty scales with solve count:
- Tier 1: 4 decoy addresses, 4 trap nodes
- Tier 2: 4+ decoy addresses (scales with solve count), 7 trap nodes
- Tier 3: 5+ decoy addresses, 10 trap nodes

The corm-brain AI can dynamically adjust grid size, decoy count, trap count, and cipher tier via `DifficultyMod` applied on the next puzzle generation.

### AI Hint Systems

Four hint systems are controlled by the corm-brain (global toggles or per-cell):

- **Heatmap** — revealed cells colored by Manhattan distance to target (critical/warm/cool/cold)
- **Vectors** — directional pseudo-element overlays pointing toward the target midpoint (N/S/E/W/NE/NW/SE/SW)
- **Decode** — whether revealed cells show plaintext or remain as cipher text (default: on)
- **Signal** — per-decrypt signal intensity meter feedback (critical/strong/weak/none/spike)

The AI can also set a **guided cell** — a specific cell the player is being directed toward, with a hint type reward when reached.

Vectors auto-enable after a random threshold of 4–8 non-target cell clicks per puzzle.

## Tech Stack

- **Language:** Go
- **UI Framework:** HTMX + server-rendered HTML templates (`html/template`)
- **Transport:** HTTP (handlers) + SSE (log streaming) + WebSocket (corm relay)
- **Assets:** Embedded via `go:embed` (templates in `internal/templates/`, static files in `static/`)
- **Client-side JS:** Minimal — pulse animation system, terminal command dispatcher, collapsible sidebar, streaming log relay. No framework.
- **Layout:** Fixed viewport (`100vh`) split vertically — scrollable puzzle area on top, terminal bar (120px–30vh) on bottom. The puzzle main area scrolls independently when the grid exceeds available height.

## Configuration

- `PUZZLE_PORT` — HTTP listen port (default: 3300)

## API / Interface

### Player-facing (HTMX)

- `GET /health` — health check
- `GET /phase0` — Phase 0 awakening page
- `POST /phase0/interact` — record Phase 0 click, returns updated UI fragment
- `GET /puzzle` — Phase 1 puzzle page (generates new puzzle)
- `POST /puzzle/decrypt` — decrypt a cell. Returns the updated cell (or group of cells for addresses), OOB cipher analysis update, and pulse data JSON. For traps, returns OOB swaps for all garbled cells.
- `POST /puzzle/submit` — submit an address guess via the terminal
- `GET /puzzle/grid` — re-render current grid state
- `GET /contracts` — Phase 2 contracts page
- `GET /stream` — SSE endpoint for real-time corm log entries, boost effects, contract updates
- `GET /status` — current session status (phase, meters, hints)

All game routes are also available under `/ssu/{entity_id}/` for in-game SSU iframe embedding.

### Corm-brain facing

- `WS /corm/ws` — WebSocket for bidirectional event/action relay
- `GET /corm/events?session_id=X` — HTTP fallback: poll buffered events for a session
- `POST /corm/actions` — HTTP fallback: deliver a corm action to a session

## Data Model

All state is in-memory (no persistent storage). Key structures:

- **Session** — player address, context (browser/SSU), phase, puzzle state, hint state, click log, event buffer, action channel, stability/corruption meters, garbled cell set, target destroyed flag
- **Grid** — 2D cell array. Each cell has: row/col, plaintext (server-only), encrypted character, decrypted flag, cell type, Manhattan distance to target, StringID (address group), HintType (sensor subtype), IsGarbled flag
- **Cell types** — `CellNoise`, `CellTarget`, `CellDecoy`, `CellTrap`, `CellSymbol`, `CellSensor`, `CellGarbled`
- **CormEvent** — player event envelope (session ID, player address, context, event type, payload, timestamp)
- **CormAction** — corm-brain command (action type, session ID, payload: log stream start/delta/end, boost, difficulty mod, state sync, contract created/updated, hint toggle, guided cell)

## Project Structure

```
puzzle-service/
├── main.go                     # Entry point, HTTP server setup
├── Dockerfile
├── go.mod
├── internal/
│   ├── server/
│   │   ├── routes.go           # Route registration (root + /ssu/{entity_id})
│   │   └── middleware.go       # Session, CORS middleware
│   ├── puzzle/
│   │   ├── generator.go        # Address generation, grid creation, sensor/trap placement
│   │   ├── cipher.go           # Caesar, variable, position-based shift ciphers
│   │   ├── grid.go             # Grid/Cell model, cell types, noise/trap symbols
│   │   └── session.go          # Per-player session state, session store
│   ├── handlers/
│   │   ├── handlers.go         # Handlers struct, rate limiter
│   │   ├── game.go             # Puzzle page, decrypt, submit, pulse data, cipher analysis
│   │   ├── phase0.go           # Phase 0 awakening interactions
│   │   ├── contracts.go        # Contracts panel rendering
│   │   ├── stream.go           # SSE endpoint
│   │   ├── status.go           # Session status endpoint
│   │   └── health.go           # Health check
│   ├── corm/
│   │   ├── relay.go            # WebSocket hub, event fan-out, action dispatch
│   │   ├── deaddrop.go         # HTTP fallback endpoints
│   │   └── types.go            # CormEvent, CormAction types
│   └── templates/
│       ├── layout.html          # Base layout (HTMX + SSE, meters, legend, log, pulse JS)
│       ├── phase0-content.html  # Phase 0 star map UI
│       ├── puzzle-content.html  # Phase 1 grid container
│       ├── grid.html            # Cipher grid partial + pulse-data container
│       ├── cell.html            # Single cell partial (sensor/garbled/address classes)
│       ├── result.html          # Word submission result partial
│       ├── meters.html          # Stability/corruption meter partial
│       ├── cipher-analysis.html # Substitution table + frequency analysis sidebar
│       ├── log-entry.html       # Corm log message partial
│       ├── contract-card.html   # Contract entry partial
│       ├── contracts.html       # Contracts list panel
│       ├── transition-rewrite.html # Phase 0→1 transition animation
│       └── target-found.html    # Target address discovery overlay (auto-complete)
├── static/
│   └── style.css               # Grid, sensors, pulses, garbled, legend, animations
└── tests/
    ├── cipher_test.go
    ├── generator_test.go
    └── handler_test.go
```

## Deployment

- **Local:** built and run via `mprocs.yaml` (`go build -o ./puzzle-service .`)
- **Production:** Dockerfile present for containerized deployment on AWS ECS/Fargate
- Stateless (sessions lost on restart) — designed for single-instance use per environment

## Features

- Three-phase game progression: awakening (Phase 0), SUI address discovery puzzles (Phase 1), trustless contracts (Phase 2)
- Phase 0 awakening with random frustration trigger threshold (3–5 clicks) and animated transition sequence
- Phase 1 cipher grid puzzles with 20×20 grid, configurable difficulty, and three cipher tiers (Caesar, variable shift, position-based)
- SUI address discovery mechanic with group-reveal (clicking any cell reveals the entire address)
- Auto-complete on target address discovery with "PATTERN ANCHOR ISOLATED" overlay and staggered entrance animation
- Seven cell types: noise, symbol, target, decoy, trap, sensor (sonar/thermal/vector), garbled
- Trap explosion system with Euclidean radius 3 blast zone and permanent garbling
- Localized sonar pulse system on every decrypt (radius 2) with color-coded type signatures
- Sonar sensor triple-pulse override (radius 5, 3 pulses at 1-second intervals)
- Four AI-controlled hint systems: heatmap, vectors, decode, signal
- AI-controlled guided cell targeting with hint type rewards
- Auto-enabling vectors after 4–8 non-target clicks per puzzle
- Difficulty scaling across three tiers with increasing decoys, traps, and cipher complexity
- Dynamic difficulty adjustment via corm-brain DifficultyMod
- HTMX server-rendered UI with SSE log streaming
- WebSocket relay for bidirectional corm-brain communication with HTTP fallback
- In-game SSU iframe embedding support (`/ssu/{entity_id}/` routes)
- Cipher analysis sidebar with substitution table and frequency analysis
- Stability and corruption meter UI

## Open Questions / Future Work

- Session persistence (Redis or Postgres) for multi-instance deployment
- SSU context integration (in-game Smart Storage Unit iframe embedding)
- Actual SUI contract addresses as puzzle targets (pull from on-chain data)
- Sensor node density tuning based on playtesting
- Additional sensor types or hybrid sensor behaviors
- Trap chain reactions (trap explosion garbling another trap, causing secondary explosion)
