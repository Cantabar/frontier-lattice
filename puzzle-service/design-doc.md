# Puzzle Service

## Overview

The puzzle service is the player-facing game server for Frontier Corm's Continuity Engine. It serves an HTMX-driven UI where players interact with a corm through three phases: awakening (Phase 0), contract discovery puzzles (Phase 1), and trustless contract execution (Phase 2). It acts as a bidirectional relay between players' browsers and the corm-brain AI backend.

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

- **Session Store** (`internal/puzzle`) — in-memory concurrent map of player sessions. Each session tracks phase, puzzle state (grid, cipher params, target address, decrypted/garbled cells), AI hint state, click logs, contract list, and a corm event ring buffer.
- **Corm Relay** (`internal/corm`) — WebSocket hub that accepts connections from corm-brain. Broadcasts player events to all connected brains and dispatches corm actions (log streams, difficulty adjustments, hint toggles, state syncs) back to the target session's action channel.
- **Handlers** (`internal/handlers`) — HTTP handlers for each game interaction, returning HTMX partial HTML fragments. The decrypt handler implements three distinct code paths: address group reveal, trap explosion, and normal cell decrypt — each with pulse data for client-side animation.
- **Puzzle Generator** (`internal/puzzle`) — creates dynamically-sized cipher grids (rows and columns computed from the client's viewport) with configurable difficulty. Places a target contract address (or random address), decoy addresses, trap nodes, and sensor nodes, then applies a tiered cipher.

### Game Phases

- **Phase 0 (Awakening)** — player clicks UI elements on a dead terminal; after a random threshold (3–5 clicks) the corm "awakens" and transitions to Phase 1 via an animated rewrite sequence.
- **Phase 1 (Contract Discovery)** — player helps the AI discover the contract system by decrypting cipher grids. Each puzzle targets a specific contract address from the player's contract list. A contract list sidebar shows all available contracts; clicking one starts a puzzle for that contract's address. Sensor nodes provide proximity information. Trap nodes explode and permanently garble nearby cells. AI controls hint systems (heatmap, vectors, decode, signal) and adjusts difficulty dynamically.
- **Phase 2 (Contract Execution)** — player interacts with on-chain trustless contracts through the corm. The corm-brain generates up to 5 contracts at a time, pushed via `contract_created` actions. Players see a contracts dashboard with card-based UI showing type, narrative description, reward, deadline, and an "EXECUTE" link to the main app. Contract completion/failure flows back through corm-brain as `contract_updated` actions.

## Phase 1 Mechanics

### Contract Discovery

The player has access to a set of trustless contracts. The left sidebar shows all contracts in a scrollable list. Each contract displays its type (CoinForCoin, ItemForCoin, etc.) and a status indicator (encrypted/recovered). Clicking an unsolved contract starts a puzzle for that contract.

The puzzle target is the contract's shortened address (12 characters: `0x` + 10 hex chars) hidden in the cipher grid. The grid also contains 4+ decoy addresses of the same format. All addresses are placed horizontally.

Cells belonging to the same address share a `StringID` (e.g. `"target_main"`, `"decoy_0"`). **Clicking any cell of an address reveals the entire address** — all cells with the same StringID are decrypted simultaneously. The clicked cell is returned as the primary HTMX swap target and the remaining cells are returned as OOB `outerHTML` swaps so the fixed-size grid is updated in place instead of gaining extra DOM nodes.

**Auto-complete on target discovery:** When the target address is revealed (via clicking any of its cells), the puzzle auto-completes: the contract is marked as solved, the solve count increments, a `submit` event (with `auto_discovered: true` and `contract_id`) is emitted to corm-brain, and a **"CONTRACT INTERFACE RECOVERED" overlay** replaces the grid. The overlay displays the confirmed address, contract type and description, and the solve progress counter. The contract list sidebar updates via OOB swap to reflect the newly solved contract. The overlay elements use staggered fade-in animations. Target address cells briefly receive a `cell--target-locked` glow animation before the overlay appears.

**Contract selection after solve:** The target-found overlay shows a single "NEXT INTERFACE" button that loads a randomly pre-selected unsolved contract (`GET /puzzle?contract_id=<id>&transition=1`). The random selection happens server-side when building the overlay data. If all contracts have been solved, the button is replaced with an "ALL INTERFACES RECOVERED" completion message. The same overlay appears on correct word submissions via the terminal.

Players can also type the full address into the terminal input (`submit 0x...`) to win without clicking the address cells directly — this remains as a secondary win path. After a correct terminal submission, the target-found overlay with random next button appears via OOB swap. The `next` terminal command also randomly selects the next unsolved contract.

**Defensive fallback:** If `GET /puzzle` is loaded without a `contract_id` and no active contract is set (e.g. after the Phase 0 → Phase 1 transition), the server randomly selects an unsolved contract to prevent generating aimless puzzles with random addresses. If the active contract is already solved, the server also randomly selects a new unsolved contract.

### Cell Types

- **Noise** — random hex characters (`0-9a-f`) filling 40% of empty cells. Blends with address content.
- **Symbol** — non-alphabet printable ASCII (`#@%&*~^|<>{}[]` etc.) filling 60% of empty cells.
- **Target** — cells of the hidden SUI address. White text on reveal, green border.
- **Decoy** — cells of decoy addresses. Same group-reveal behavior as target but no win. Visually distinct after reveal: dim orange text at reduced opacity, no border, subtle orange-tinted background with a brief fade-in animation — contrasting with the target's bright white text and green border.
- **Trap** — anomaly nodes. On reveal, explode with Euclidean radius 3, permanently garbling all cells in the blast zone (setting them to `CellGarbled`). Garbled cells display unique foreign-script glyphs with a purple flicker and cannot be interacted with. If any target address cell is caught in the explosion, the game is over. Trap nodes are not static — they are attracted toward sonar pulse sources (see Trap Sonar Attraction below).
- **Sensor** — hint nodes (~4.8% of noise/symbol cells). Three subtypes:
  - **Sonar** `[S]` (cyan) — on reveal, triggers a triple pulse: 3 pulses at 1-second intervals, Euclidean radius 5, revealing the color signature of all cells in range.
  - **Thermal** `[T]` (blue→red gradient) — on reveal, the sensor cell's text color, background, and glow are set to a smooth blue-to-red gradient based on Manhattan distance to the target. Close to the target = red (hue 0°), far away = blue (hue 240°). The color is computed server-side via HSL interpolation and applied as an inline style. This is independent of the AI-controlled heatmap hint toggle.
  - **Vector** `[V]` (gold) — on reveal, inherently shows a directional CSS indicator (pulsing radial gradient) pointing toward the target on the sensor cell itself. This is independent of the AI-controlled vectors hint toggle.
- **Garbled** — permanently corrupted by trap explosion. Foreign-script glyph, purple flicker, no interaction.

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

### Trap Sonar Attraction

Trap nodes are attracted to sonar pulse sources. After every cell decrypt, undecrypted trap nodes that were **revealed by the pulse** (i.e., within the pulse radius and flashed red) move one cell closer to the pulse origin by swapping positions with an adjacent noise/symbol cell. Only traps that the player actually saw in the pulse are affected — there is no separate detection range.

Since regular decrypts pulse at radius 2 and sonar sensors pulse at radius 5, sonar sensors attract traps from a much wider area. This creates a risk/reward dynamic: sonar sensors reveal more information but also draw more distant traps closer.

**Movement rules:**
- Traps move toward the adjacent cell (including diagonals) that minimizes Euclidean distance to the pulse source
- Traps can only swap with noise or symbol cells — they cannot overwrite addresses, sensors, other traps, garbled cells, or decrypted cells
- Multiple traps moving in the same pulse cannot claim the same destination cell
- Trap explosions do not trigger movement (the trap is detonating, not pulsing)
- The server emits OOB cell swaps for both old (now noise) and new (now trap) positions, plus a `#trap-move-data` JSON payload for client-side arrival animation
- Trap moves are included in the decrypt event payload sent to corm-brain (`trap_moves` field)

**Visual feedback:** A subtle red flicker animation (`cell--trap-arrive`) is applied to the new trap position for 600ms. This is faint enough not to definitively reveal trap identity but rewards attentive players.

### Color-Coded Legend

A node key panel in the right sidebar (cipher analysis panel) displays the cell type legend:
- `[S]` Sonar (cyan)
- `[T]` Thermal (blue)
- `[V]` Vector (gold)
- `■` Anomaly (red)

### Cipher Tiers

- **Tier 1 — Caesar Shift (puzzles 1–3):** fixed shift for entire grid
- **Tier 2 — Variable Shift (puzzles 4–6):** per-row shift values
- **Tier 3 — Position-Based Shift (puzzles 7+):** shift = f(row, col)

All ciphers operate on printable ASCII range 0x21–0x7E (94 characters). The cipher parameters are never sent to the client.

### Dynamic Grid Sizing

The grid dimensions are computed at puzzle generation time based on the player's viewport. On the first `GET /puzzle`, the server renders an empty placeholder; client-side JS measures `.puzzle-main`'s available width and height, then re-requests `GET /puzzle?cw=<width>&ch=<height>`. The server divides each dimension by `MinCellPx` (32 px) and clamps the result (cols: 14–30, rows: 6–30). The computed dimensions are cached on the session so subsequent puzzle loads ("next puzzle", phase transitions) reuse them without re-measuring. An `htmx:configRequest` interceptor also appends `cw`/`ch` to any HTMX-initiated `/puzzle` request, keeping the dimensions fresh if the viewport changes.

The CSS grid uses explicit `grid-template-rows` and `grid-template-columns` with `1fr` tracks so cells fill the container without overflow. `.puzzle-main` has `overflow: hidden` — the grid never scrolls.

Fallback: when no viewport dimensions are available (e.g. non-browser clients), the grid defaults to 20×20.

### Difficulty Scaling

Difficulty scales with solve count:
- Tier 1: 4 decoy addresses, 40 trap nodes
- Tier 2: 4+ decoy addresses (scales with solve count), 70 trap nodes
- Tier 3: 5+ decoy addresses, 100 trap nodes

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
- **Client-side JS:** Minimal — pulse animation system, terminal command dispatcher, collapsible sidebar, streaming log relay, grid-entrance cleanup. No framework.
- **Layout:** Fixed viewport (`100vh`) split vertically — puzzle area on top, terminal bar (120px–30vh) on bottom. Left sidebar: contract list (200px, Phase 1 only — hidden during Phase 0 and revealed via OOB swap on transition). Right sidebar: node key + cipher analysis (280px). The grid is dynamically sized to fit the available space without scrolling (`overflow: hidden`).

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
- `GET /contracts` — Phase 2 contracts page (standalone, SSE-populated)
- `GET /phase2/transition` — Phase 1→2 transition animation
- `GET /phase2` — Phase 2 contracts dashboard
- `GET /stream` — SSE endpoint for real-time corm log entries, boost effects, contract updates
- `GET /status` — current session status (phase, meters, hints)

All game routes are also available under `/ssu/{entity_id}/` for in-game SSU iframe embedding.

### Corm-brain facing

- `WS /corm/ws` — WebSocket for bidirectional event/action relay
- `GET /corm/events?session_id=X` — HTTP fallback: poll buffered events for a session
- `POST /corm/actions` — HTTP fallback: deliver a corm action to a session

## Data Model

All state is in-memory (no persistent storage). Key structures:

- **Session** — player address, context (browser/SSU), phase, puzzle state, hint state, click log, event buffer, action channel, contract list (Phase 1), AI contracts list (Phase 2), active contract ID, garbled cell set, target destroyed flag, pattern alignment, completed patterns count
- **Contract** — ID, full address, shortened address, contract type, description, solved flag
- **AIContract** — ID, contract type, description, reward, deadline, detail URL, status (active/completed/expired/cancelled), created timestamp
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
│   │   ├── trap_movement.go    # Trap sonar attraction: movement logic, pulse strengths
│   │   └── session.go          # Per-player session state, session store
│   ├── handlers/
│   │   ├── handlers.go         # Handlers struct, rate limiter
│   │   ├── game.go             # Puzzle page, decrypt, submit, pulse data, cipher analysis
│   │   ├── phase0.go           # Phase 0 awakening interactions
│   │   ├── contracts.go        # Contracts panel rendering
│   │   ├── phase2.go           # Phase 2 contracts dashboard + transition
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
│       ├── meters.html          # Stability/corruption meter partial (legacy)
│       ├── contract-list.html   # Contract list sidebar partial
│       ├── cipher-analysis.html # Node key + substitution table + frequency analysis sidebar
│       ├── log-entry.html       # Corm log message partial
│       ├── contract-card.html   # Contract entry partial
│       ├── contracts.html       # Contracts list panel
│       ├── transition-rewrite.html # Phase 0→1 transition animation
│       ├── transition-phase2.html  # Phase 1→2 transition animation
│       ├── phase2-content.html    # Phase 2 contracts dashboard + card template
│       └── target-found.html    # Target address discovery overlay (auto-complete)
├── static/
│   └── style.css               # Grid, sensors, pulses, garbled, legend, animations
└── tests/
    ├── cipher_test.go
    ├── generator_test.go
    ├── handler_test.go
    └── trap_movement_test.go
```

## Deployment

- **Local:** built and run via `mprocs.yaml` (`go build -o ./puzzle-service .`)
- **Production:** Dockerfile present for containerized deployment on AWS ECS/Fargate
- Stateless (sessions lost on restart) — designed for single-instance use per environment

## Features

- Three-phase game progression: awakening (Phase 0), contract discovery puzzles (Phase 1), trustless contract execution (Phase 2)
- Phase 0 awakening with random frustration trigger threshold (3–5 clicks) and animated transition sequence
- Phase 1 contract-driven cipher grid puzzles: player selects a contract from the left sidebar to start a puzzle for that contract's address
- Dynamically-sized grid (viewport-fitted, min 32px/cell), configurable difficulty, and three cipher tiers (Caesar, variable shift, position-based)
- Contract address discovery mechanic with group-reveal (clicking any cell reveals the entire address)
- Auto-complete on target address discovery with "CONTRACT INTERFACE RECOVERED" overlay showing contract type, description, and a randomly pre-selected "NEXT INTERFACE" button
- Seven cell types: noise, symbol, target, decoy, trap, sensor (sonar/thermal/vector), garbled
- Trap explosion system with Euclidean radius 3 blast zone and permanent garbling
- Trap sonar attraction: trap nodes revealed by a sonar pulse move one cell toward the pulse source, with subtle red flicker animation on arrival
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
- Cipher analysis sidebar with substitution table, frequency analysis, and node key legend
- Contract list sidebar with solved/unsolved status and progress tracking
- Phase 1→2 transition animation (lock-open rings, scanline, rewrite status lines) triggered when all base contracts are solved
- Phase 2 contracts dashboard with AI-generated contract cards (type, narrative, reward, deadline, execute link)
- Phase 2 contract lifecycle management via SSE (contract_created → active card, contract_updated → completed/expired state)
- Phase 2 contract slot indicators (5 max active contracts)
- Dual Phase 2 transition triggers: puzzle-service detects AllSolved, corm-brain detects stability ≥ 100 — whichever fires first wins

## Phase 2 Mechanics

### Transition Trigger
When the player solves the last of the 5 base contracts (Phase 1), the target-found overlay shows "ALL INTERFACES RECOVERED — INITIATING PHASE TRANSITION..." and auto-loads the Phase 2 transition animation after 3 seconds. The transition can also be triggered by corm-brain sending a `state_sync` action with `phase: 2` (stability threshold).

### Transition Animation
The `transition-phase2.html` template renders:
1. A central hexagon icon with expanding green ring pulses ("last lock opening")
2. A scanline sweep
3. Staggered status lines: ALL CONTRACT INTERFACES RECOVERED → EXTERNAL PATTERN RECOGNITION ONLINE → INITIATING DIRECTIVE GENERATION → AWAITING CORM DIRECTIVES
4. Sibling OOB swaps to hide the Phase 1 sidebars (contracts-sidebar + cipher-analysis)
5. HTMX auto-load of `GET /phase2?transition=1` after 3.5 seconds

The transition animation div is the **main content** of the response (swapped into `#main-display` via `innerHTML`). The sidebar-hiding OOB elements are siblings outside the main div — not nested inside it. This avoids HTMX extracting the entire response as OOB content and leaving `#main-display` empty.

The `corm-phase-transition` SSE event (emitted when corm-brain advances the phase via `state_sync`) is received by a hidden `#phase-transition-receiver` div in the layout footer, which targets `#main-display` with `innerHTML`.

### Phase 2 UI
The Phase 2 view replaces the cipher grid in `#main-display`. It is a contracts dashboard:
- **Header:** Phase label, pattern completion counter, inline stability/corruption meters
- **Contract cards:** Up to 5 active cards, each showing contract type, corm narrative, reward (CORM), deadline, status, and an "EXECUTE →" link to the main app
- **Empty state:** Pulsing placeholder when no contracts have been generated yet
- **Slot indicators:** 5 horizontal bars at the bottom, filled proportional to active contract count

### AI Contract Lifecycle
1. Corm-brain sends `contract_created` via WebSocket → puzzle-service stores an `AIContract` on the session with status "active" → SSE delivers a rendered `phase2-card.html` to the browser
2. Player executes the contract in the game world → event flows through corm-brain
3. Corm-brain sends `contract_updated` with status "completed"/"expired"/"cancelled" → puzzle-service updates the session → SSE delivers an OOB card update (completed state or deletion)

## Known Constraints

- **Grid entrance vs pulse specificity** — the `.grid-entrance .cell` cascade animation (specificity 0,2,0) overrides lower-specificity `animation` declarations on cells. Pulse, garble, and heat-trap selectors use `.cell.cell--pulse-*` compound selectors to match specificity and win by source order. A JS cleanup timer removes the `.grid-entrance` class ~800 ms after it appears (post-animation) as a belt-and-suspenders safeguard.

## Open Questions / Future Work

- Session persistence (Redis or Postgres) for multi-instance deployment
- SSU context integration (in-game Smart Storage Unit iframe embedding)
- Dynamic contract list sync from corm-brain (currently uses hardcoded test contracts)
- Additional sensor types or hybrid sensor behaviors
- Phase 2 pattern alignment tracking (currently stored on session but not calculated — lives in corm-brain trait reducers)
- Phase 3 transition mechanics (agenda-driven multi-step contracts)
