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

**Environment tagging:** Each `CormEvent` carries an `Environment` field (e.g. `"default"`) that the event processor uses to select the correct per-environment chain client. The `Handlers` struct holds a `defaultEnv` string (set from `cfg.Environments[0].Name` at startup) and stamps it on every event via its `buildEvent()` method.

### Key Components

- **Dispatcher** (`internal/dispatch`) — bridges the HTTP layer and the reasoning layer. `EmitEvent` pushes player events to the event channel; `SendAction` routes corm actions to the correct session's channel.
- **Session Store** (`internal/puzzle`) — in-memory concurrent map of player sessions. Each session tracks phase, puzzle state, hints, contracts, event buffer, and an action channel for SSE delivery. Because sessions contain Go channels and non-serializable state, multi-task deployments require ALB sticky sessions (configured in the CDK stack) to pin each player to a single task.
- **Handlers** (`internal/handlers`) — HTTP handlers for each game interaction, returning HTMX partial HTML fragments.
- **Puzzle Generator** (`internal/puzzle`) — creates dynamically-sized cipher grids with configurable difficulty.
- **Reasoning Handler** (`internal/reasoning`) — processes event batches: runs trait reduction, detects phase transitions, delivers deterministic transition messages, and executes phase-specific effects (Phase 0 escalation, Phase 1 hints/difficulty, Phase 2 contract generation).
- **Trait Reducer** (`internal/memory`) — deterministic trait mutations (stability, corruption, patience, paranoia, etc.) applied inline on every event batch.
- **Chain Client** (`internal/chain`) — per-environment Sui RPC client for on-chain state writes.

### Goroutines

1. **HTTP Server** — standard `http.ListenAndServe` serving all game routes and SSE.
2. **Event Processor** — reads from the dispatcher's event channel, debounces events into per-session batches, dispatches to the reasoning handler.

### Concurrency Safety

Session fields are accessed by multiple goroutines (HTTP handlers, SSE stream goroutine, event processor). Two patterns keep this safe:

- **Buffered template rendering** — `renderTemplate` and `renderPartial` render into a `bytes.Buffer` before writing to the `ResponseWriter`. If template execution fails, the client receives a clean 500 instead of partial HTML. Errors are logged with the template name.
- **Session snapshots** — Page handlers that read multiple session fields use snapshot methods (e.g. `SnapshotPhase2()`) that acquire the session mutex once and return a value struct. This prevents TOCTOU races where the SSE handler's `ActionStateSync` could mutate `Phase` between a redirect check and data construction.
- **`SetStateSync`** — The SSE handler's `ActionStateSync` uses `sess.SetStateSync()` to atomically update `Phase`, `Stability`, and `Corruption` under the session mutex.

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
- `DATABASE_URL` — Postgres connection string (local dev / direct override)
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` — individual DB fields injected by ECS from AWS Secrets Manager; `entrypoint.sh` assembles these into `DATABASE_URL` at container startup when `DATABASE_URL` is not already set
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
- `SECURE_COOKIES` — when `true`, session cookies use `SameSite=None; Secure` for cross-origin iframe embedding (default: false)

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
- **Production (utopia/stillness):** Dockerfile for containerized deployment on AWS ECS/Fargate; `entrypoint.sh` assembles `DATABASE_URL` from `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USERNAME`/`DB_PASSWORD` injected by ECS from AWS Secrets Manager (`{prefix}/db-credentials`)
- Requires: running Postgres (with pgvector extension), Sui RPC access, funded Sui keypair
- **pgvector:** The `001_initial.sql` migration runs `CREATE EXTENSION IF NOT EXISTS vector`. On AWS RDS Postgres 16 this works automatically — pgvector is a supported extension and the master DB user has sufficient privileges. Local dev uses the `pgvector/pgvector:pg16` Docker image.

### Docker Image Data Files

The item registry (`internal/chain/registry.go`) reads three files from disk at runtime. The Dockerfile's build context is the repo root (`docker build -f continuity-engine/Dockerfile .`) so these files can be copied into the final image.

The final Alpine image layout:

```
/usr/local/bin/continuity-engine   # Go binary
/data/
  registry/
    types.json                     # item type definitions
    groups.json                    # item group names
  item-values.json                 # LUX valuations
```

Only `types.json` and `groups.json` are copied from `fsd_built/` — the rest of that directory (~150 MB+) is not needed at runtime. Both the ECS task definition and `docker-compose.yml` set `ITEM_REGISTRY_PATH=/data/registry` and `ITEM_VALUES_PATH=/data/item-values.json` to match. The config.go defaults (`./static-data/...`) remain unchanged for bare-metal local dev (running from the repo root without Docker).

## Features

- Three-phase game progression: awakening (Phase 0), contract discovery puzzles (Phase 1), trustless contract execution (Phase 2)
- Deterministic in-character transition responses (no LLM dependency)
- Real-time deterministic trait reduction on every event batch
- Corruption-proportional garbling of transition response text
- Phase-aware event processing with corm responses:
  - Phase 0: escalating awareness messages at click-count thresholds (passive noise → fragment awareness → growing awareness)
  - Phase 1: struggling hints (heatmap/signal on every 4th incorrect submit), boost evaluation
  - Phase 2: contract generation, pattern alignment tracking
- Dynamically-sized cipher grids, three cipher tiers, sensor/trap mechanics
  - Sonar sensors: radius-5 pulse revealing nearby cell types (3 pulses, 1000ms interval), triggers trap movement
  - Thermal sensors: radius-4 area-of-effect applying heatmap proximity hints to nearby cells (2 pulses, 500ms interval), own cell shows blue-to-red gradient based on distance to target
  - Vector sensors: directional arrow toward target on revealed cell
- Contract address discovery with group-reveal and auto-complete
- Four AI-controlled hint systems: heatmap, vectors, decode, signal
- Deterministic Phase 2 contract generation from traits + inventory state with automatic slot fill-up (up to 5 active contracts per corm, triggered on page load, node bind, and contract completion/failure; rate-limited by `CONTRACT_GENERATION_COOLDOWN_MS`)
- On-chain state writes (phase transitions, stability/corruption updates)
- Multi-environment support via per-environment chain clients
- HTMX server-rendered UI with SSE log streaming
- In-game SSU iframe embedding support (`/ssu/{entity_id}/` routes)
- Phase-aware root routing: `GET /` redirects to the correct phase handler (`/phase0`, `/puzzle`, or `/phase2`) based on session state, preserving query parameters for cookie-loss resilience
- Cross-origin iframe cookie support (`SameSite=None; Secure` via `SECURE_COOKIES=true`)
- Debug terminal commands for development troubleshooting:
  - `contracts` — force-generate AI contracts up to the 5-slot cap (bypasses cooldown)
  - `phase2` — skip to Phase 2 contracts dashboard (forces phase transition if needed)

## Testing

Run all tests: `go test ./...` from the `continuity-engine/` directory (or `make test-go` from the repo root).

### Test layout

- **`tests/`** — integration-style tests (external test package `tests`). 7 files covering cipher round-trips, puzzle generation, HTTP handler logic, contract generation, trait reduction, prompt processing, and trap movement.
- **`internal/handlers/game_test.go`** — unit tests for puzzle decrypt handlers with real template rendering, OOB swap verification.
- **`internal/reasoning/transitions_test.go`** — unit tests for deterministic transition message selection (determinism, corruption tolerance, in-character validation).

### What's tested

- Cipher encrypt/decrypt round-trips for all three tiers (Caesar, Variable, Position)
- Noise and trap symbol encoding within cipher range
- Tier selection based on solve count
- Session lifecycle: click recording, phase transitions, decrypt tracking, word checking
- HTTP handler responses: health endpoint, puzzle decrypt with OOB swaps, trap explosions
- Puzzle generation: grid layout, target word embedding, address cell grouping
- Contract generation from trait state and inventory
- Deterministic trait reduction
- Transition message determinism, corruption resilience, and in-character tone
- Trap movement mechanics
