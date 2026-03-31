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
- **Chain Client** (`internal/chain`) — per-environment Sui RPC client for on-chain state writes. Uses `pattonkan/sui-go` for JSON-RPC, PTB building, Ed25519 signing, and BCS decoding. Implements real PTB transactions for CormState creation (`install`), state updates (`update_state`), CORM minting (`corm_coin::mint`), and `coin_for_item` contract creation. Falls back to stub logging when package/object IDs are not configured (graceful degradation for dev environments). Exposes `CanCreateContracts()` and `CanMintCORM()` for pre-flight capability checks. Inventory and SSU reads remain seed-mode stubs pending SUI dynamic field integration (requires `getDynamicFields` + `getDynamicFieldObject` RPC calls per SSU, similar to the web app's `useSsuInventory` hook).

**Corm ID vs Chain State ID:** Internally, each corm is identified by a UUID (e.g. `08c0145b-...`), stored in DB tables and used for session/trait lookups. On-chain, each corm's `CormState` shared object has a Sui hex object ID (e.g. `0xabc123...`). The `corm_network_nodes.chain_state_id` column maps between them — it stores the Sui object ID returned by `CreateCormState()`. Chain methods (`MintCORM`, `GetCormState`, `UpdateCormState`) require the Sui hex ID; `ResolveChainStateID()` looks up the primary network node's `chain_state_id` for a given corm UUID.

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
- `SUI_PRIVATE_KEY` — Ed25519 private key for chain operations. Accepts bech32 `suiprivkey1...` format (as exported by `sui keytool export`) or hex-encoded 32-byte seed (with or without `0x` prefix). Stored in Secrets Manager (`fc-{env}/sui-signer`).
- `CORM_STATE_PACKAGE_ID` — deployed corm_state package ID
- `TRUSTLESS_CONTRACTS_PACKAGE_ID` — deployed trustless_contracts package ID
- `CORM_AUTH_PACKAGE_ID` — deployed corm_auth package ID
- `CORM_CONFIG_OBJECT_ID` — shared CormConfig object ID (for corm install); auto-populated by `publish-contracts.sh`. If missing, run `scripts/recover-object-ids.sh`.
- `COIN_AUTHORITY_OBJECT_ID` — shared CoinAuthority object ID (for CORM minting); auto-populated by `publish-contracts.sh` from the `corm_state` publish transaction. If missing, run `scripts/recover-object-ids.sh`.
- `CORM_CHARACTER_ID` — brain's on-chain Character object ID (for posting contracts); set manually after Character creation. **Required** for `CanCreateContracts()` — without it, all contract creation is skipped.
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
  - Phase 0: escalating awareness messages at click-count thresholds (passive noise → fragment awareness → growing awareness). Terminal input is available from page load with navigation commands (`scan`, `ping`, `calibrate`, `query <sector>`) that count toward the transition threshold alongside star-map clicks.
  - Phase 1: struggling hints (heatmap/signal on every 4th incorrect submit), boost evaluation
  - Phase 2: contract generation, pattern alignment tracking
- Dynamically-sized cipher grids, three cipher tiers, sensor/trap mechanics
  - Sonar sensors: radius-5 pulse revealing nearby cell types (3 pulses, 1000ms interval), triggers trap movement
  - Thermal sensors: radius-4 area-of-effect applying heatmap proximity hints to nearby cells (2 pulses, 500ms interval), own cell shows blue-to-red gradient based on distance to target
  - Vector sensors: directional arrow toward target on revealed cell
- Contract address discovery with group-reveal and auto-complete
- Four AI-controlled hint systems: heatmap, vectors, decode, signal
- Deterministic Phase 2 contract generation from traits + inventory state with automatic slot fill-up (up to 5 active contracts per corm, triggered on page load, node bind, and contract completion/failure; rate-limited by `CONTRACT_GENERATION_COOLDOWN_MS`)
- Goal-directed contract generation: when standard generation fails (empty inventories/zero CORM), the corm falls back to a recipe-driven goal planner that generates `coin_for_item` acquisition contracts for raw materials needed to build target ships (Reflex, then Reiver)
- Recipe registry (`internal/chain/recipes.go`): hardcoded dependency trees for Reflex and Reiver, with recursive flattening to raw ore requirements (Feldspar Crystals, Silica Grains, Iron-Rich Nodules, Palladium, Fossilized Exotronics)
- Bootstrap CORM minting: when the corm has zero CORM balance and the chain client is fully configured (`CanMintCORM()`), a seed amount (1000 CORM) is minted to fund acquisition contracts. When chain config is incomplete, minting returns 0 (no phantom balance) and contract generation falls through to empty-state feedback.
- Contract generation pre-flight: before running the goal-directed planner, the engine checks `CanCreateContracts()` (signer + trustless contracts package + corm state package + character ID). If any are missing, generation is skipped with a WARN log and the player receives empty-state feedback immediately.
- Empty-state player feedback: when no contracts can be generated (including when goal-directed intents are generated but all fail at creation), the corm sends an in-character log message directing the player to gather specific raw materials (corruption-scaled: coherent at low corruption, garbled at high). A `contract_status` SSE event (`ActionContractStatus`) also updates the contracts panel placeholder with the same message, so feedback is visible even if the player isn't watching the log stream
- On-chain state writes (phase transitions, stability/corruption updates)
- Multi-environment support via per-environment chain clients
- HTMX server-rendered UI with SSE log streaming
- In-game SSU iframe embedding support (`/ssu/{entity_id}/` routes)
- Phase-aware root routing: `GET /` redirects to the correct phase handler (`/phase0`, `/puzzle`, or `/phase2`) based on session state, preserving query parameters for cookie-loss resilience
- Cross-origin iframe cookie support (`SameSite=None; Secure` via `SECURE_COOKIES=true`)
- Debug terminal commands for development troubleshooting:
  - `contracts` — force-generate AI contracts up to the 5-slot cap (bypasses cooldown)
  - `phase2` — skip to Phase 2 contracts dashboard (forces phase transition in both session and DB traits)

### Chain Client Troubleshooting

The chain client logs initialization status at startup:
- `"chain: initialized signer for address 0x..."` — signer OK
- `"chain: WARNING — no SUI_PRIVATE_KEY set"` — key missing from Secrets Manager
- `"chain: failed to initialize signer: ..."` — key present but in unrecognized format
- `"chain: invalid object ID"` — malformed package/object ID env var

If `CanCreateContracts()` returns false (WARN log: `"chain client not fully configured"`), check:
1. `SUI_PRIVATE_KEY` in Secrets Manager (`fc-{env}/sui-signer`) is populated and valid
2. `CORM_STATE_PACKAGE_ID`, `TRUSTLESS_CONTRACTS_PACKAGE_ID`, `CORM_CHARACTER_ID` are set in the ECS task definition (run `make deploy-infra ENV={env}` to sync from `.env.{env}`)
3. The on-chain Character object exists (`sui client object <CORM_CHARACTER_ID>`)

## Responsive Layout

Three CSS breakpoints handle different screen sizes:

- **Desktop (>1100px):** Full three-column layout — contracts sidebar (200px), puzzle grid (flex), analysis sidebar (280px) — plus terminal bar below.
- **Tablet (769px–1100px):** Contracts sidebar narrows to 140px with truncated text. Analysis sidebar defaults to collapsed (user can expand via toggle). Grid cells enforce 40px minimum touch targets. Terminal bar capped at 25vh. Server-side grid generation uses `MinCellPx=38` and allows as few as 10 columns to produce fewer, larger cells.
- **Mobile (≤768px):** Vertical stack. Contracts sidebar converts to a compact horizontal scrollable strip (type + status only, address hidden). Analysis sidebar stacks below with horizontal toggle bar. Grid cells enforce 36px minimum. Terminal bar capped at 40vh.

The analysis sidebar collapse state is persisted in `sessionStorage`. On tablet viewports, the JS init script defaults to collapsed if no user preference has been saved.

Grid sizing is viewport-adaptive: client JS measures the available space in `.puzzle-main` and passes `cw`/`ch` to the server, which computes grid dimensions via `GridDimensionsForViewport()` (min 10 cols, max 30 cols, min 6 rows, max 30 rows).

## Testing

Run all tests: `go test ./...` from the `continuity-engine/` directory (or `make test-go` from the repo root).

### Test layout

- **`tests/`** — integration-style tests (external test package `tests`). 7 files covering cipher round-trips, puzzle generation, HTTP handler logic, contract generation, trait reduction, prompt processing, and trap movement.
- **`internal/handlers/game_test.go`** — unit tests for puzzle decrypt handlers with real template rendering, OOB swap verification.
- **`internal/reasoning/transitions_test.go`** — unit tests for deterministic transition message selection (determinism, corruption tolerance, in-character validation).
- **`internal/chain/recipes_test.go`** — unit tests for recipe registry flattening (Reflex/Reiver raw material resolution, unknown items, raw material detection).
- **`internal/reasoning/goals_test.go`** — unit tests for goal planner (acquisition contract generation from empty inventory, partial inventory subtraction, slot limits, empty-state messages at varying corruption levels).
- **`internal/reasoning/phase2_test.go`** — unit tests for `sendEmptyStateFeedback` (verifies log stream + `contract_status` dispatch at low and high corruption).

### What's tested

- Cipher encrypt/decrypt round-trips for all three tiers (Caesar, Variable, Position)
- Noise and trap symbol encoding within cipher range
- Tier selection based on solve count
- Session lifecycle: click recording, phase transitions, decrypt tracking, word checking
- HTTP handler responses: health endpoint, puzzle decrypt with OOB swaps, trap explosions
- Puzzle generation: grid layout, target word embedding, address cell grouping
- Contract generation from trait state and inventory
- Goal-directed contract generation from recipe registry (empty inventory fallback, material priority ordering)
- Recipe registry flattening (Reflex/Reiver dependency trees to raw ores)
- Deterministic trait reduction
- Transition message determinism, corruption resilience, and in-character tone
- Trap movement mechanics
- Empty-state feedback dispatch (log stream + contract_status panel update)
