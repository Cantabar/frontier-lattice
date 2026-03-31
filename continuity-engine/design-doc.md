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
- **Reasoning Handler** (`internal/reasoning`) — processes event batches: runs trait reduction, detects phase transitions, delivers deterministic transition messages, syncs state to chain, and executes phase-specific effects (Phase 0 escalation, Phase 1 hints/difficulty, Phase 2 contract generation).
- **Trait Reducer** (`internal/memory`) — deterministic trait mutations (stability, corruption, patience, paranoia, etc.) applied inline on every event batch.
- **Chain Client** (`internal/chain`) — per-environment Sui RPC client for on-chain state writes. Uses `pattonkan/sui-go` for JSON-RPC, PTB building, Ed25519 signing, and BCS decoding. Implements real PTB transactions for CormState creation (`install`), state updates (`update_state`), CORM minting (`corm_coin::mint`), and all trustless contract types: `coin_for_item`, `coin_for_coin`, `item_for_coin`, `item_for_item`. **Batch contract creation:** `CreateContracts` batches multiple contract creates into a single PTB, minimizing RPC round-trips and gas costs. Shared objects (Character, SSU, Clock) are resolved once; CORM escrow for all coin-based contracts is split in a single `SplitCoins` command; item-based contracts share a single `borrow_owner_cap`/`return_owner_cap` cycle with N withdrawals between them. The reasoning layer collects all intents first, resolves/validates each, then calls `CreateContracts` once. Single-contract fallback (`CreateContract`) remains for single-intent paths. **Character objects are shared objects** on Sui (not owned) — the PTB passes them as `SharedObject{Mutable: false}` for create calls and `{Mutable: true}` for `borrow_owner_cap`. This is required because `fill()` functions reference the poster's Character in a transaction signed by the filler. Item-based contracts (`item_for_coin`, `item_for_item`) use a 4-step PTB: `character::borrow_owner_cap` → `storage_unit::withdraw_by_owner` → `character::return_owner_cap` → create. They require `WORLD_PACKAGE_ID` and an `OwnerCap<StorageUnit>` received by the brain's Character; `CanCreateItemContracts()` gates this path. Falls back to stub logging when package/object IDs are not configured (graceful degradation for dev environments). Exposes `CanCreateContracts()`, `CanCreateItemContracts()`, `CanMintCORM()`, and `CanUpdateCormState()` for pre-flight capability checks. **Inventory reads** use the Sui `getDynamicFields` + `getDynamicFieldObject` RPC pair to enumerate SSU inventory slots and parse the on-chain `Inventory` `VecMap<u64, ItemEntry>`. `GetCormInventory` resolves the brain's SSUs by querying `OwnerCap<StorageUnit>` objects owned by the brain's Character and parsing the `object_id` field from each OwnerCap's content fields. `GetPlayerInventory` receives the already-fetched `NodeSSUs` list from `BuildSnapshot` Phase 1 and filters by `OwnerAddr == playerAddr`. Both functions merge items across all inventory slots via `mergeInventory` and populate `InventoryItem.TypeName` from the item registry attached to the client via `client.SetRegistry(registry)` (wired in `main.go` after both are created). `BuildSnapshot` runs in two phases: Phase 1 (parallel) fetches CORM balance, NodeSSUs, and NodeAssemblies; Phase 2 (parallel) fetches CormInventory and PlayerInventory using NodeSSUs from Phase 1. `findOwnerCapForSSU` (used in item-based contract PTBs) now parses the `object_id` field from each OwnerCap's content to select the OwnerCap for the correct SSU, with first-match fallback for single-SSU backward compatibility. **SSU and assembly discovery** is live: `GetNodeSSUs` and `GetNodeAssemblies` read the network node's `connected_assembly_ids` via `GetObject`, batch-fetch connected objects via `MultiGetObjects`, and filter by type (`storage_unit::StorageUnit` for SSUs, `type_id` field for assemblies). A shared `getConnectedAssemblyObjects` helper handles the two-step RPC flow; both methods fall back to seed data in seed mode and return nil on RPC failure (graceful degradation).

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
- `WORLD_PACKAGE_ID` — deployed Eve Frontier world contracts package ID (for `character`, `storage_unit`, `inventory` modules); required for item-based contracts (`item_for_coin`, `item_for_item`)
- `CORM_CONFIG_OBJECT_ID` — shared CormConfig object ID (for corm install); auto-populated by `publish-contracts.sh`. If missing, run `scripts/recover-object-ids.sh`.
- `COIN_AUTHORITY_OBJECT_ID` — shared CoinAuthority object ID (for CORM minting); auto-populated by `publish-contracts.sh` from the `corm_state` publish transaction. If missing, run `scripts/recover-object-ids.sh`.
- `CORM_CHARACTER_ID` — brain's on-chain Character **shared object** ID (for posting contracts); set manually after Character creation. **Required** for `CanCreateContracts()` — without it, all contract creation is skipped. Must be a shared object (not address-owned) because fill transactions reference it from a different signer.
- `ITEM_REGISTRY_PATH`, `ITEM_VALUES_PATH` — item data paths
- `CORM_PER_LUX`, `CORM_FLOOR_PER_UNIT` — pricing config
- `CONTRACT_GENERATION_COOLDOWN_MS` — min time between contract generation per corm
- `WITNESSED_CONTRACTS_PACKAGE_ID` — deployed witnessed_contracts package ID (for `build_request` on-chain contracts); required for `CanCreateBuildRequests()`
- `WITNESS_REGISTRY_OBJECT_ID` — shared WitnessRegistry object ID (for witnessed contract verification)
- `BUILD_REQUEST_BOUNTY` — CORM amount escrowed as bounty for build_request contracts (default: 500)
- `SSU_TYPE_ID` — in-game structure type ID for Storage Units, used as `requested_type_id` in build_request contracts (default: 84556)
- `SECURE_COOKIES` — when `true`, session cookies use `SameSite=None; Secure` for cross-origin iframe embedding (default: false)

## Project Structure

```
continuity-engine/
├── main.go                     # HTTP server + event processor goroutine
├── go.mod
├── Dockerfile
├── .air.toml
├── design-doc.md
├── cmd/set-phase/main.go       # CLI tool: set corm phase in DB + on-chain
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
- Deterministic Phase 2 contract generation from traits + inventory state with automatic slot fill-up (up to 5 active contracts per corm, triggered on page load, node bind, and contract completion/failure; rate-limited by `CONTRACT_GENERATION_COOLDOWN_MS`). All contracts for a fill cycle are batch-created in a single Sui PTB via `CreateContracts`, reducing RPC round-trips from N to 1.
- Contract access restriction: generated contracts are restricted to the interacting player's Character and tribe via the on-chain `allowed_characters` and `allowed_tribes` vectors. The web app passes `characterId` and `tribeId` query params in the iframe URL; the session middleware stores these on the session; events carry them to the reasoning layer; and `ResolveIntent` populates `PlayerCharacterID` and `AllowedTribes` on `ContractParams`. If the player has no Character ID, the contract is unrestricted (backwards-compatible). The on-chain `verify_filler_access()` enforces the restriction: if both vectors are non-empty, only the player's Character or a member of their tribe can fill the contract.
- Goal-directed contract generation: when standard generation fails (empty inventories/zero CORM), the corm falls back to a recipe-driven goal planner that generates `coin_for_item` acquisition contracts for raw materials needed to build target ships. Acquisition contracts use exact recipe deficit quantities (via `ExactQuantity` on the intent) rather than qualitative inventory fractions, so the full needed amount is requested in a single partial-fill-friendly contract
- Progressive ship build goals: the corm guides the player through a five-tier build pipeline — Reflex (corvette) → Reiver (corvette) → random frigate → TADES (destroyer) → MAUL (cruiser). The frigate is selected deterministically per-corm via SHA-256 hash of the corm ID. Completed goals are tracked in `GoalState.CompletedGoals` (persisted in `goal_state` JSONB column, migration `006_goal_state.sql`) and filtered from future contract generation.
- Three-phase goal lifecycle: each goal ship follows an acquiring → distributing → verifying lifecycle, tracked by `GoalState.GoalPhase`. In **acquiring**, the corm collects raw materials via `coin_for_item` contracts; standard generation protects goal-reserved inventory via `ReservedMaterials()`. In **distributing**, the corm gives collected materials back to the player via `item_for_coin` contracts at token prices (1 CORM); `GoalState.DistributedMaterials` tracks what's been handed off. In **verifying**, the corm treats full distribution as goal completion (indexer-based ship detection is a future enhancement), marks the goal complete, resets to acquiring for the next goal, and announces each transition in the corm log.
- Infrastructure checks: before generating material acquisition contracts for a goal, the planner walks the recipe tree to determine required manufacturing facilities (Printer, Berth, Heavy Printer, Heavy Berth). If any non-starter facilities are missing from the network node's assemblies, the corm generates infrastructure build-request contracts instead (`coin_for_item` targeting the facility itself), blocking material acquisition until the player deploys the required structures.
- SSU validation and build_ssu witnessed contracts: all contract types that reference an SSU (`coin_for_item`, `item_for_coin`, `item_for_item`) require a valid storage unit on the network node. `ResolveIntent` returns `ErrNoSSU` if `snapshot.NodeSSUs` contains no entries with non-empty, non-zero ObjectIDs. Before any contract generation in `attemptContractFill`, the engine checks `HasValidSSU(snapshot)`. If no SSUs exist, it creates an on-chain `BuildRequestContract<CORM_COIN>` via `witnessed_contracts::build_request::create` — a witnessed bounty contract that the indexer's witness service auto-fulfills when it detects the player has anchored a Storage Unit with CormAuth extension. The contract escrows `BUILD_REQUEST_BOUNTY` CORM (default 500) with a 7-day deadline, targeting the SSU structure type ID (`SSU_TYPE_ID`). When `CanCreateBuildRequests()` returns false (missing `WITNESSED_CONTRACTS_PACKAGE_ID` or chain config), falls back to a UI-only `build_ssu` directive (no on-chain transaction) for graceful degradation. Both paths are tracked in a per-corm `buildSSUActive` map (keyed by corm ID, value is contract ID) to prevent duplicates. When SSUs later appear on the network node, the directive/contract is auto-completed in the player's UI and an announcement is sent to the corm log. On-chain fulfillment is handled independently by the indexer's witness service. `GetNodeSSUs` queries the network node's `connected_assembly_ids` on chain, batch-fetches connected objects, and filters for `storage_unit::StorageUnit` types. In seed mode it returns hardcoded seed data. On RPC failure it returns an error, which marks the `WorldSnapshot` as `Degraded`; `attemptContractFill` detects this and skips all contract generation (including `build_ssu` directives) to avoid acting on unreliable data. The per-corm contract cooldown is cleared so the next event retries immediately.
- Facility registry (`internal/chain/facilities.go`): maps recipe Facility strings to type IDs, walks recipe trees to collect unique facility requirements, and compares against the node's assembly list. Starter facilities (Field Refinery, Field Printer, Mini Printer, Mini Berth) are excluded since all players have them.
- Recipe registry (`internal/chain/recipes.go`): hardcoded dependency trees for all ship tiers — corvettes (Reflex, Reiver), frigates (USV, LORHA, MCF, HAF, LAI), destroyer (TADES), cruiser (MAUL) — plus intermediates (batched/packaged alloys, carbon weave, thermal composites), program frames (Apocalypse, Bastion, Archangel, Exterminata), and raw-material-tier components (Still Kernel, Echo Chamber, Still Knot). Recursive flattening resolves any ship to its leaf-level raw ore requirements.
- On-demand CORM minting: the corm never runs out of CORM for escrow. When `splitCORMCoin` (used by all escrow-requiring contract types) cannot find an owned coin with sufficient balance, it falls back to `mintCORMCoinArg`, which adds a `corm_coin::mint_coin` MoveCall inline within the same PTB. The minted `Coin<CORM_COIN>` is returned as a PTB intermediate result and passed directly to `SplitCoins` or the contract create call — mint + split + create execute atomically in a single transaction. The on-chain `mint_coin` function (added alongside the existing `mint`) performs the same MintCap authorization but returns the coin instead of transferring it, enabling PTB composition. `CanMintInline()` gates this path (requires signer + `corm_state` package + `CoinAuthority` object). The existing `findOwnedCoin` path is tried first (zero overhead when the brain already has sufficient CORM), so minting only occurs when genuinely needed.
- Chain state auto-provisioning: if `CreateCormState` fails on a network node's first contact (e.g. RPC timeout, missing config), the `corm_network_nodes` row is created with NULL `chain_state_id`. Three recovery paths ensure the chain state is eventually provisioned: (1) **Phase transition guarantee** — `syncChainState` (called on every phase transition before phase effects run) detects a missing `chain_state_id` for a node-linked corm and provisions it immediately via `CreateCormState` + `SetChainStateID`. This is the primary path that ensures Phase 2 contract generation has chain state available. (2) In `processBatch`, every event with a `NetworkNodeID` checks if the linked node's `chain_state_id` is NULL and retries `CreateCormState` + `SetChainStateID`. For Phase 2+ corms, this bypasses the backfill cooldown to avoid delaying contract generation. (3) In `attemptContractFill`, if `ResolveChainStateID` returns empty, the engine resolves the corm's primary network node, attempts `CreateCormState`, and stores the result before proceeding; if provisioning fails, the per-corm contract cooldown is cleared so the next event retries immediately. Backfill retries in `processBatch` are rate-limited per node for Phase 0/1 corms: after a failed attempt, the node is suppressed for 60 seconds (`backfillCooldown`) to prevent log spam when the failure is persistent (e.g. empty signer wallet). The cooldown is cleared on success and bypassed entirely for Phase 2+ corms.
- Three-tier corm identity resolution: when the event processor receives events for an unknown session, it resolves the player's existing corm through a three-tier fallback chain before creating a new UUID: (1) **session → corm** via `corm_sessions` table, (2) **network node → corm** via `corm_network_nodes` table (if events carry a `NetworkNodeID`), (3) **player address → corm** via `corm_players` table. Only if all three fail is a new corm UUID created. The `corm_players` table (migration `005_corm_players.sql`) records player_address → corm_id associations, updated on every resolution path. This ensures returning players who lose their session cookie (server restart, cookie expiry, different browser) are reconnected to their existing corm. If the node resolution finds a different corm than the player-address resolution, the node's corm wins (authoritative) and the session/player links are updated with `ON CONFLICT DO UPDATE` (not `DO NOTHING`) so mismatch corrections persist and don't repeat on subsequent events.
- No-node corms: browser sessions without a `?node=` query parameter or SSU context create corms with no `corm_network_nodes` row. These corms function normally through Phase 0/1 (puzzle state lives in Postgres, not on-chain). On-chain `CormState` is created when a network node is bound — either via the `?node=` param on a subsequent session, or the Phase 2 manual bind form (`POST /phase2/bind-node`). `syncChainState` silently skips no-node corms (DEBUG log) since this is expected state, not an error.
- Contract generation pre-flight: before running the goal-directed planner, the engine checks `CanCreateContracts()` (signer + trustless contracts package + corm state package + character ID). If any are missing, generation is skipped with a WARN log and the player receives empty-state feedback immediately.
- Empty-state player feedback: when no contracts can be generated (including when goal-directed intents are generated but all fail at creation), the corm sends an in-character log message directing the player to gather specific raw materials (corruption-scaled: coherent at low corruption, garbled at high). A `contract_status` SSE event (`ActionContractStatus`) also updates the contracts panel placeholder with the same message, so feedback is visible even if the player isn't watching the log stream
- On-chain state sync: after `ProcessEventBatch` processes events, `syncChainState` writes the current phase/stability/corruption to the on-chain `CormState` shared object via `UpdateCormState`. Phase transitions trigger an unconditional sync. Stability/corruption changes trigger a sync only when significant: absolute delta ≥ 5 from the pre-batch value, or a threshold boundary crossing (0, 25, 50, 75, 100). Sync retries up to 3 attempts (100ms, 500ms backoff) on transient failures. Invalid stub `chain_state_id` values (e.g. `"corm_0x08a493"` from seed-mode) are detected via `IsValidChainStateID()` and rejected with an ERROR log. Postgres remains the authoritative store; on-chain state is eventually consistent. Requires `CanUpdateCormState()` (signer + `corm_state` package ID) and a resolved `chain_state_id` for the corm.
- On-chain state reconciliation: when a new session is created via `buildSessionSyncFn`, after restoring DB traits the engine reads the on-chain `CormState` via `GetCormState` and compares phase/stability/corruption. If any values differ, an immediate `UpdateCormState` call reconciles the drift. This catches accumulated desync (e.g. from failed `syncChainState` calls) on the next player connection.
- Multi-environment support via per-environment chain clients
- HTMX server-rendered UI with SSE log streaming
- In-game SSU iframe embedding support (`/ssu/{entity_id}/` routes)
- Network node auto-bind: the `node` query parameter (e.g. `?player=0x...&node=0x...`) is read by the session middleware on new session creation and sets `NetworkNodeID` on the session automatically. This allows the web app to pass the player's installed corm's network node ID through the iframe URL, skipping the Phase 2 manual bind form when the corm is already linked.
- Eager corm state sync: when a new session is created with a `node` query param, the middleware calls a `SessionSyncFn` callback (`buildSessionSyncFn` in `main.go`) that resolves node → corm → traits from the DB and initializes the session's Phase/Stability/Corruption from stored traits. This means a returning player with an existing corm lands on the correct phase immediately (e.g. Phase 2 at stability 80) instead of always starting at Phase 0. The session is linked to the corm in DB so `processBatch` finds it on the first event, and the player → corm association is recorded in `corm_players` for future session recovery. The web app also passes `cormStateId` in the iframe URL (e.g. `?player=0x...&node=0x...&cormStateId=0x...`) for future on-chain reconciliation.
- Initial SSE state push: when the SSE `/stream` connection opens, the handler sends an immediate `state_sync` event with the session's current Phase/Stability/Corruption/NetworkNodeID. This ensures the browser has correct meters and phase from first paint, without waiting for a player event round-trip.
- Phase-aware root routing: `GET /` redirects to the correct phase handler (`/phase0`, `/puzzle`, or `/phase2`) based on session state, preserving query parameters for cookie-loss resilience
- Cross-origin iframe cookie support (`SameSite=None; Secure` via `SECURE_COOKIES=true`)
- Debug terminal commands for development troubleshooting:
  - `contracts` — force-generate AI contracts up to the 5-slot cap (bypasses cooldown)
  - `phase2` — skip to Phase 2 contracts dashboard (forces phase transition in both session and DB traits)
- Debug HTTP endpoints:
  - `POST /debug/reconcile-chain` — scans all corms in the DB, compares each with its on-chain CormState, and syncs any drift. Returns a JSON summary of actions taken (synced, skipped, errors).
- JSON API endpoints:
  - `POST /api/reset-phase` — resets a corm's phase, stability, and corruption in both DB and on-chain. Accepts `{"network_node_id": "0x...", "phase": 0}`. Uses `corm_state::reset_state` on-chain (allows phase regression, unlike `update_state`). Called by the web UI Settings page.
- CLI tools:
  - `make set-phase NODE=0x... PHASE=N ENV=stillness` — directly updates both the DB `corm_traits.phase` and the on-chain `CormState` for a given network node. Useful for testing and operational recovery.

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

The analysis sidebar uses **granular OOB updates** for per-interaction refreshes (cell decrypts, word submits). Instead of replacing the entire `#cipher-analysis` aside on every action — which would destroy sidebar/panel collapse state and cause layout shifts on smaller screens — the server renders `cipher-analysis-oob.html`, which emits three `innerHTML` OOB swaps targeting only the panel body elements (`#analysis-subst-body`, `#analysis-stats-body`, `#analysis-freq-body`). The `<aside>`, `<section>`, and toggle button elements are never replaced, so collapse classes and JS event listeners are naturally preserved. The full `cipher-analysis.html` template is only used for initial page renders and phase transitions.

Grid sizing is viewport-adaptive: client JS measures the available space in `.puzzle-main` and passes `cw`/`ch` to the server, which computes grid dimensions via `GridDimensionsForViewport()` (min 10 cols, max 30 cols, min 6 rows, max 30 rows).

## Testing

Run all tests: `go test ./...` from the `continuity-engine/` directory (or `make test-go` from the repo root).

### Test layout

- **`tests/`** — integration-style tests (external test package `tests`). 7 files covering cipher round-trips, puzzle generation, HTTP handler logic, contract generation, trait reduction, prompt processing, and trap movement.
- **`internal/handlers/game_test.go`** — unit tests for puzzle decrypt handlers with real template rendering, OOB swap verification.
- **`internal/reasoning/transitions_test.go`** — unit tests for deterministic transition message selection (determinism, corruption tolerance, in-character validation).
- **`internal/chain/recipes_test.go`** — unit tests for recipe registry flattening (Reflex/Reiver/USV/TADES/MAUL raw material resolution, unknown items, raw material detection, facility field correctness).
- **`internal/chain/facilities_test.go`** — unit tests for facility requirement derivation per ship tier (corvette/frigate/TADES/MAUL) and CheckMissingFacilities logic.
- **`internal/reasoning/goals_test.go`** — unit tests for goal planner (acquisition contract generation from empty inventory, partial inventory subtraction, slot limits, empty-state messages at varying corruption levels, progressive goal generation, goal completion filtering, frigate selection determinism, infrastructure check contract generation, infrastructure-missing feedback messages).
- **`internal/reasoning/phase2_test.go`** — unit tests for `sendEmptyStateFeedback` (verifies log stream + `contract_status` dispatch at low and high corruption).
- **`internal/reasoning/ssu_test.go`** — unit tests for SSU validation (`HasValidSSU` with empty/zero/valid/mixed SSU lists), `ResolveIntent` `ErrNoSSU` for all SSU-dependent contract types, `build_ssu` bypass, zero-address SSU rejection, narrative helpers (`build_ssu` and `build_request` share same narrative), deterministic contract ID generation, `buildSSUActive` string map behavior, and `ContractBuildRequest` type validation.

### What's tested

- Cipher encrypt/decrypt round-trips for all three tiers (Caesar, Variable, Position)
- Noise and trap symbol encoding within cipher range
- Tier selection based on solve count
- Session lifecycle: click recording, phase transitions, decrypt tracking, word checking
- HTTP handler responses: health endpoint, puzzle decrypt with OOB swaps, trap explosions
- Puzzle generation: grid layout, target word embedding, address cell grouping
- Contract generation from trait state and inventory
- Goal-directed contract generation from recipe registry (empty inventory fallback, material priority ordering)
- Progressive goal generation (5-tier pipeline, completion filtering, deterministic frigate selection)
- Goal lifecycle functions: `IsGoalFullyAcquired`, `ReservedMaterials`, `PlanDistributionContracts`, `IsFullyDistributed`, phase transitions, announcements
- Infrastructure check contract generation (missing facilities → build-request intents)
- Recipe registry flattening (Reflex/Reiver/USV/TADES/MAUL dependency trees to raw ores)
- Facility requirement derivation per ship tier
- Deterministic trait reduction
- Transition message determinism, corruption resilience, and in-character tone
- Trap movement mechanics
- Empty-state feedback dispatch (log stream + contract_status panel update)
- SSU validation: `HasValidSSU`, `ErrNoSSU` from `ResolveIntent`, `build_ssu` intent bypass, zero-address SSU rejection, build_ssu/build_request narrative sharing, auto-completion announcement, `buildSSUActive` map string semantics, `ContractBuildRequest` type registration
