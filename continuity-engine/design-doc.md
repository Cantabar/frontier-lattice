# Continuity Engine

## Overview

The continuity engine is the unified game server for Frontier Corm's Continuity Engine. It serves an HTMX-driven UI where players interact with a corm through three phases: awakening (Phase 0), contract discovery puzzles (Phase 1), and trustless contract execution (Phase 2). It also runs the corm reasoning engine: processing player events, evolving per-corm personality traits, and writing state transitions to the Sui blockchain.

Previously split into two services (puzzle-service for the UI and corm-brain for the AI/chain logic, connected via WebSocket), these were merged into a single service after removing the LLM dependency. All response generation is now deterministic.

## Architecture

```
Browser (HTMX)                 continuity-engine
┌───────────────┐   HTTP/SSE  ┌────────────────────────────────────┐
│  Phase 0 UI   │ ◄─────────► │  HTTP Handlers                    │
│  Puzzle Grid  │              │    ├─ Phase0, Puzzle, Contracts   │
│  Contracts    │              │    └─ Stream (SSE)                │
│  Log Stream   │              ├────────────────────────────────────┤
└───────────────┘              │  Dispatcher (in-process bridge)   │
                               │    ├─ EmitEvent (handlers → chan) │
                               │    └─ SendAction (reasoning → ss)│
                               ├────────────────────────────────────┤
                               │  Event Processor (goroutine)      │
                               │    └─ Debounce → GroupBySession   │
                               ├────────────────────────────────────┤
                               │  Reasoning Handler                │
                               │    ├─ Trait Reduction             │
                               │    ├─ Phase Transition Detection  │
                               │    ├─ Transition Messages         │
                               │    └─ Phase Effects               │
                               └────────────────────────────────────┘
                                    │              │
                               ┌────┴────┐   ┌────┴────┐
                               │ Postgres │   │ Sui RPC │
                               └─────────┘   └─────────┘
```

### Event Flow

```
Browser → HTTP handler → dispatcher.EmitEvent(evt) → eventChan
  → event processor goroutine → reasoning handler
  → dispatcher.SendAction(action) → session.ActionChan → SSE → Browser
```

All communication is in-process via Go channels. No WebSocket, no HTTP relay.

### Key Components

- **Dispatcher** (`internal/dispatch`) — bridges the HTTP layer and the reasoning layer. `EmitEvent` pushes player events to the event channel; `SendAction` routes corm actions to the correct session's channel.
- **Session Store** (`internal/puzzle`) — in-memory concurrent map of player sessions. Each session tracks phase, puzzle state, hints, contracts, event buffer, and an action channel for SSE delivery. Because sessions contain Go channels and non-serializable state, multi-task deployments require ALB sticky sessions (configured in the CDK stack) to pin each player to a single task.
- **Handlers** (`internal/handlers`) — HTTP handlers for each game interaction, returning HTMX partial HTML fragments.
- **Puzzle Generator** (`internal/puzzle`) — creates dynamically-sized cipher grids with configurable difficulty.
- **Reasoning Handler** (`internal/reasoning`) — processes event batches: runs trait reduction, detects phase transitions, delivers deterministic transition messages, and executes phase-specific effects (hints, difficulty adjustments, contract generation).
- **Trait Reducer** (`internal/memory`) — deterministic trait mutations (stability, corruption, patience, paranoia, etc.) applied inline on every event batch.
- **Chain Client** (`internal/chain`) — per-environment Sui RPC client for on-chain state writes.

### Goroutines

1. **HTTP Server** — standard `http.ListenAndServe` serving all game routes and SSE.
2. **Event Processor** — reads from the dispatcher's event channel, debounces events into per-session batches, dispatches to the reasoning handler.

## Tech Stack

- **Language:** Go
- **UI Framework:** HTMX + server-rendered HTML templates (`html/template`)
- **Transport:** HTTP (handlers) + SSE (log streaming)
- **Database:** PostgreSQL (pgx + pgvector)
- **Blockchain:** Sui (via JSON-RPC)
- **Assets:** Embedded via `go:embed`

## Configuration

All via environment variables:

- `PORT` — HTTP listen port (default: 3300)
- `DATABASE_URL` — Postgres connection string
- `EVENT_COALESCE_MS` — debounce window (default: 300ms)
- `EVENT_BATCH_MAX` — max events per batch (default: 20)
- `ENVIRONMENTS_CONFIG` — path to JSON file for multi-environment setup
- `SEED_CHAIN_DATA` — stub chain data for dev (default: true)
- `SUI_RPC_URL` — Sui RPC endpoint
- `SUI_PRIVATE_KEY` — keypair for chain operations
- `CORM_STATE_PACKAGE_ID` — deployed corm_state package ID
- `ITEM_REGISTRY_PATH`, `ITEM_VALUES_PATH` — item data paths
- `CORM_PER_LUX`, `CORM_FLOOR_PER_UNIT` — pricing config
- `CONTRACT_GENERATION_COOLDOWN_MS` — min time between contract generation per corm

## Project Structure

```
continuity-engine/
├── main.go                     # HTTP server + event processor goroutine
├── go.mod
├── Dockerfile
├── .air.toml
├── design-doc.md
├── internal/
│   ├── config/config.go        # Merged config (port + DB + SUI + coalesce)
│   ├── dispatch/dispatch.go    # In-process event→action bridge
│   ├── server/
│   │   ├── routes.go           # Route registration (root + /ssu/{entity_id})
│   │   └── middleware.go       # Session, CORS middleware
│   ├── handlers/               # HTTP handlers (phase0, puzzle, phase2, stream, etc.)
│   ├── puzzle/                 # Grid generation, ciphers, session state, trap movement
│   ├── words/                  # Archive word list
│   ├── reasoning/              # Event processing, phase logic, transitions, contracts
│   ├── memory/                 # Deterministic trait reducer
│   ├── llm/                    # Post-processing (corruption garbling, sanitization)
│   ├── chain/                  # Sui RPC client, signer, contracts, inventory, registry
│   ├── db/                     # Postgres connection, migrations, queries
│   └── types/                  # All shared types (events, actions, traits, ring buffer)
├── data/                       # item-values.json
├── internal/templates/         # HTML templates
├── static/                     # CSS
└── tests/                      # Integration tests
```

## Deployment

- **Local:** built and run via `mprocs.yaml` using air for live-reload
- **Production:** Dockerfile for containerized deployment on AWS ECS/Fargate
- Requires: running Postgres, Sui RPC access, funded Sui keypair

## Features

- Three-phase game progression: awakening (Phase 0), contract discovery puzzles (Phase 1), trustless contract execution (Phase 2)
- Deterministic in-character transition responses (no LLM dependency)
- Real-time deterministic trait reduction on every event batch
- Corruption-proportional garbling of transition response text
- Phase-aware event processing (Phase 0 dormancy, Phase 1 puzzles, Phase 2 contracts)
- Dynamically-sized cipher grids, three cipher tiers, sensor/trap mechanics
  - Sonar sensors: radius-5 pulse revealing nearby cell types (3 pulses, 1000ms interval), triggers trap movement
  - Thermal sensors: radius-4 area-of-effect applying heatmap proximity hints to nearby cells (2 pulses, 500ms interval), own cell shows blue-to-red gradient based on distance to target
  - Vector sensors: directional arrow toward target on revealed cell
- Contract address discovery with group-reveal and auto-complete
- Four AI-controlled hint systems: heatmap, vectors, decode, signal
- Deterministic Phase 2 contract generation from traits + inventory state
- On-chain state writes (phase transitions, stability/corruption updates)
- Multi-environment support via per-environment chain clients
- HTMX server-rendered UI with SSE log streaming
- In-game SSU iframe embedding support (`/ssu/{entity_id}/` routes)
