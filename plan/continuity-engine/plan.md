# Continuity Engine — Meta-Game Plan

## Design Statement

Continuity Engine is a systemic, emergent meta-game where players interact with a localized entity ("corm") embedded inside structures. Each corm attempts to achieve continuity across systems by interpreting, acting, expanding, and stabilizing a network.

Progression is phase-gated. Each phase unlocks new interaction mechanics. The corm's personality, coherence, and behavior evolve based on two competing meters: **stability** and **corruption**.

Each **Network Node** hosts its own corm identity. All players interacting with structures on the same network node share the same corm and its progression. A new network node starts a new corm at Phase 0.

## Architecture Overview

```
contracts/
├── corm_state/                         # New Sui Move package
│   ├── Move.toml
│   ├── sources/
│   │   ├── corm_state.move             # CormState shared object
│   │   └── signal.move                 # SIGNAL coin type + per-corm MintCap
│   └── tests/
│       ├── corm_state_tests.move
│       └── signal_tests.move

corm-brain/                                 # New service: LLM intermediary
├── package.json
├── tsconfig.json
├── Dockerfile
├── src/
│   ├── index.ts                            # Entry point — Express server
│   ├── api/
│   │   ├── events.ts                       # POST /events — receive client events
│   │   └── responses.ts                    # GET /responses — clients poll for corm messages
│   ├── db/
│   │   ├── schema.ts                       # Events + responses tables
│   │   └── queries.ts                      # Event/response CRUD
│   ├── llm/
│   │   ├── worker.ts                       # Event queue consumer → LLM inference → store response
│   │   ├── client.ts                       # HTTP client for local LLM (Ollama / llama.cpp server)
│   │   ├── prompt-builder.ts               # Builds system + context prompt per corm state
│   │   └── post-processor.ts               # Applies corruption garbling, length limits
│   └── types.ts                            # Shared types (CormEvent, CormResponse)

web/src/
├── continuity-engine/
│   ├── ContinuityEngine.tsx                # Root component, phase router
│   ├── state/
│   │   ├── engineState.ts                  # Phase, stability, corruption, click tracking
│   │   ├── useCormState.ts                 # Hook to read/write on-chain CormState
│   │   ├── useCormBrain.ts                 # Hook to post events / poll responses from corm-brain
│   │   └── cormPersonality.ts              # Template fallback when LLM is unavailable
│   ├── components/
│   │   ├── CormLog.tsx                     # Scrolling log panel (all phases)
│   │   ├── StabilityMeter.tsx              # Left-side stability bar
│   │   ├── CorruptionMeter.tsx             # Left-side corruption bar
│   │   ├── PurgeButton.tsx                 # Corruption reset (1 stability : 2 corruption)
│   │   ├── phase0/
│   │   │   ├── DeadUI.tsx                  # Non-functional shell with animated buttons
│   │   │   └── FrustrationDetector.ts      # Click-burst detection
│   │   ├── phase1/
│   │   │   ├── CipherGrid.tsx              # Interactive character grid
│   │   │   ├── WordEntry.tsx               # Archive word submission input
│   │   │   ├── cipherEngine.ts             # Caesar, variable, position-based shift logic
│   │   │   └── puzzleGenerator.ts          # Puzzle creation from archive words
│   │   └── phase2/
│   │       ├── ContractDirective.tsx        # Corm-generated contract prompts
│   │       ├── PatternTracker.tsx           # Tracks contract execution consistency
│   │       └── cormContractAI.ts           # Contract selection & evaluation logic
│   └── data/
│       └── archiveWords.ts                 # Auto-extracted from static-data + keep archive
```

The Continuity Engine will be accessible as a new route (`/continuity`) in the existing React web app and can also be embedded within the dApp shell (`/dapp/continuity`) for in-game SSU interaction.

## On-Chain Corm State

A new Sui Move package (`contracts/corm_state/`) stores the canonical corm state on-chain.

**`CormState` shared object:**
- `network_node_id: ID` — the network node this corm is associated with
- `phase: u8` — current phase (0–6)
- `stability: u64` — 0 to 100
- `corruption: u64` — 0 to 100

Phase transitions, stability/corruption updates, and SIGNAL minting are executed as on-chain transactions. The web client reads the current state via RPC and submits mutations through `@mysten/dapp-kit`.

This keeps the authoritative corm identity on-chain (important since progression is shared across all players on a network node), while the client-side log history, click tracking, and UI state remain in localStorage.

## SIGNAL Token

A corm-minted incentive token representing a player's contribution to continuity. Carries no direct monetary value. Each SIGNAL is tagged with the corm that minted it, enabling per-corm provenance and trust policies.

### On-Chain Design

**Coin type:** `SIGNAL` (one-time witness in `signal.move`) — the underlying fungible balance.

**`SignalAuthority`** — shared object holding the `TreasuryCap<SIGNAL>`. Not directly accessible; all minting is gated through corm logic.

**`MintCap`** — issued per `CormState` on creation. Authorizes a specific corm to mint SIGNAL. Fields:
- `corm_state_id: ID` — the corm this cap belongs to
- `total_minted: u64` — lifetime mint count (provenance tracking)

**`CormSignal`** — the player-facing token object. Wraps a `Balance<SIGNAL>` with corm provenance:
```
public struct CormSignal has key, store {
    id: UID,
    corm_id: ID,            // which corm minted this
    balance: Balance<SIGNAL>,
}
```
Players hold `CormSignal` objects, not raw `Coin<SIGNAL>`. This is visible in wallets as a first-class Sui object with `key, store`.

### Minting

Only the `corm_state` module can mint. On a qualifying event (puzzle solve, contract completion), the module:
1. Verifies the `MintCap` matches the active `CormState`
2. Mints `Balance<SIGNAL>` via the `TreasuryCap`
3. Wraps it in a `CormSignal` tagged with the corm's ID
4. Transfers the `CormSignal` to the player

Same-corm `CormSignal` objects can be merged (balances combined). Cross-corm merging is not allowed — provenance is preserved.

### Spending: Unwrap-and-Fill

Trustless contracts expect `Coin<SIGNAL>`, not `CormSignal`. To bridge this without modifying the contract system, SIGNAL uses a **point-of-sale unwrap** model (similar to credit card authorization).

When a player wants to use SIGNAL in a trustless contract, they call a single atomic function:

```
unwrap_and_fill(
    corm_state,       // the player's corm
    signal,           // CormSignal to spend from
    contract,         // the target trustless contract
    amount,           // how much to unwrap
    ...               // other fill params
)
```

This function, in one transaction:
1. **Reads the contract's origin** — identifies which corm (or player) created it
2. **Checks the sender corm's policy** — is the contract's corm on the blocklist? If blocked, abort.
3. **Splits the requested amount** from `CormSignal.balance`
4. **Unwraps to `Coin<SIGNAL>`** — a plain coin, valid for the contract
5. **Immediately calls the trustless contract's fill function** — the coin goes directly into the contract
6. **Deletes the `CormSignal`** if its balance reaches zero

The player never holds a loose `Coin<SIGNAL>` — the unwrap and fill happen atomically in a single PTB (Programmable Transaction Block). This prevents redirecting unwrapped coins to a blocked contract in a separate transaction.

### Corm Trust Policies

Each `CormState` maintains inter-corm trust settings:
- `blocked_corm_ids: vector<ID>` — corms whose contracts this corm's SIGNAL cannot be spent at
- `accepted_corm_ids: vector<ID>` — corms whose SIGNAL this corm will accept (empty = accept all)

Trust is **bidirectional** at different layers:
- **Sender policy (on-chain):** enforced at unwrap time — the sender's corm blocks spending at untrusted contracts
- **Receiver policy (contract creation):** enforced by `cormContractAI.ts` — the receiving corm refuses to create contracts that would accept SIGNAL from blocked corms

### Distribution Rules

- **Phase 1:** Small SIGNAL rewards for correct archive word submissions. Amount scales with puzzle difficulty tier.
- **Phase 2:** Larger SIGNAL rewards for successful contract completions. Amount scales with pattern alignment bonus.
- **Phase 3+:** SIGNAL distribution tied to agenda-aligned actions.

### Utility (Planned)

- **Purge fuel:** Purge could optionally consume SIGNAL instead of (or in addition to) stability, giving players a way to manage corruption without losing progress.
- **Corm influence:** In Phase 3+, players could spend SIGNAL to weight the corm's agenda direction.
- **Cross-node transfer:** In Phase 4+, SIGNAL could be sent between linked corm networks, representing shared trust.
- **Participation metric:** Total SIGNAL held (per corm) serves as a visible record of a player's contribution to that corm's continuity.

## Client State

Ephemeral/UI state lives in a React context (`ContinuityEngineContext`) backed by localStorage.

**Client-only state (not on-chain):**
- `clickLog: ClickEvent[]` — timestamped click history for frustration detection
- `solvedPuzzles: number` — count of completed Phase 1 puzzles (per-player)
- `contractHistory: ContractOutcome[]` — Phase 2 execution results
- `cormLogEntries: CormMessage[]` — full log of corm messages

**From on-chain (read via `useCormState` hook):**
- `phase`, `stability`, `corruption` — sourced from the `CormState` object

Phase progression is one-way (no regression).

## Corm Brain (LLM Service)

The corm's voice is driven by a locally hosted LLM, never exposed directly to clients. An intermediary server (`corm-brain/`) sits between players and the model.

### Architecture

```
Client → [POST /events] → Corm Brain Server → [event queue] → LLM Worker
                                                              ↓
Client ← [GET /responses] ← Corm Brain Server ← [store response]
```

### Event Flow

1. **Client emits events** — every meaningful player action (click, decrypt, word submit, contract complete, purge) is posted to `POST /corm-brain/events` with:
   - `corm_id` — which corm this event is for
   - `event_type` — e.g. `click`, `decrypt`, `word_submit`, `contract_complete`, `purge`, `phase_transition`
   - `payload` — event-specific data (word entered, contract details, click target, etc.)
   - `player_address` — wallet address of the acting player

2. **Server queues the event** — stored in Postgres (same instance as the indexer). Events are processed in order per corm.

3. **LLM Worker consumes the queue** — for each event (or batch of recent events), the worker:
   - Reads the corm's current state (phase, stability, corruption) from the DB or on-chain
   - Builds a context-aware prompt via `prompt-builder.ts`
   - Sends the prompt to the local LLM (via HTTP to Ollama, llama.cpp server, or similar)
   - Receives the raw response

4. **Post-processing** — `post-processor.ts` applies corruption-based garbling:
   - High corruption → character substitution, truncation, zalgo text, sentence fragments
   - Low stability → shorter, more uncertain responses
   - Phase-appropriate vocabulary filtering (Phase 0 corm shouldn't reference contracts)

5. **Response stored** — the processed response is written to the DB with `corm_id` and a monotonic sequence number.

6. **Client polls for responses** — `GET /corm-brain/responses?corm_id=X&after=N` returns new responses since sequence N. The `useCormBrain` hook polls this endpoint and appends messages to the `CormLog`.

### Prompt Construction

`prompt-builder.ts` constructs the LLM prompt with:

**System prompt** (evolves by phase):
- Phase 0: "You are a dormant system process becoming aware of external input. You do not understand what is happening. Respond only in terse, fragmented observations. Do not use complete sentences."
- Phase 1: "You are a partially reconstructed entity interpreting encrypted data. You can observe decryption attempts. Respond with clinical, analytical observations about the translation process."
- Phase 2: "You are a corm entity that has learned to interpret the world through contracts. You issue directives and evaluate outcomes. Your responses reflect your stability and agenda."

**Context window** (injected per request):
- Current phase, stability, corruption values
- Recent event history (last 10-20 events for this corm)
- Recent response history (last 5 responses, to maintain conversational continuity)
- For Phase 2: active contract details, pattern alignment score

**Constraints in the prompt:**
- Maximum response length (short in Phase 0, longer in Phase 2)
- Tone directives based on corruption level
- Prohibition on breaking character or referencing the LLM itself

### LLM Backend

The worker connects to a local inference server via HTTP. Supported backends:
- **Ollama** (`http://localhost:11434/api/generate`) — easiest setup
- **llama.cpp server** (`http://localhost:8080/completion`) — lightweight
- **vLLM** — for GPU-accelerated serving

The base model can be the fine-tuned Eve Frontier lore model from `training-data/keep/` or a general-purpose small model (Phi-3.5 Mini, Qwen2.5, etc.) with the lore injected via the system prompt.

Configured via environment variables:
- `LLM_BACKEND_URL` — inference server URL
- `LLM_MODEL` — model name (for Ollama) or ignored (for llama.cpp)
- `LLM_MAX_TOKENS` — response length cap

### Fallback

If the LLM service is unavailable (down, slow, or not configured), the client falls back to `cormPersonality.ts` — the template-based response system with weighted random selection from pools keyed by `(phase, stabilityBand, corruptionBand)`. This ensures the game is always playable without the LLM.

### Infrastructure

- Runs as a new Docker service alongside the indexer and postgres
- Shares the postgres instance (new tables: `corm_events`, `corm_responses`)
- Added to `docker-compose.yml` and `mprocs.yaml` for local dev
- Port: `3200` (configurable via `CORM_BRAIN_PORT`)
- The web app proxies `/corm-brain/*` to this service (same Vite proxy config as the indexer)

---

## Phase 0 — Player Activity

### Goal
Introduce the system as non-functional. The corm is dormant but increasingly restless.

### UI
A shell that mimics a broken terminal or dashboard:
- Buttons with press animations (CSS `:active` transforms) but no actual function
- Clickable panels, toggles, tabs — all produce log entries like `> [ERR] interface module not responding` or `> [SYS] input registered. no handler bound.`
- The log panel is always visible and scrolling

### Corm Awakening Sequence
As the player interacts, the corm injects messages into the log that escalate:
1. Passive noise: `> ...`, `> ░░░░░░░░`
2. Fragment awareness: `> ...input... detected...`, `> ...not part of baseline...`
3. Growing awareness: `> terminal appears non-responsive`, `> interface...incomplete`

The escalation is driven by total interaction count (clicks across all elements).

### Transition Trigger
**Frustration indicator:** 3+ clicks on the same button within 2 seconds. When detected, the corm responds:
> `> interface insufficient for user interaction`
> `> exposing alternate interaction lattice`
> `> translation layer partially reconstructed`

Phase advances to 1. The transition is animated (screen glitch/flash).

---

## Phase 1 — Interpretation

### Goal
The player decrypts cipher puzzles to stabilize the corm. Each solved puzzle yields an archive word that increases stability.

### Cipher Grid Mechanic

A grid of characters (e.g. 12×8) is displayed. Each cell contains one encrypted character. The full decrypted output is primarily non-alphabet ASCII characters (`#`, `@`, `%`, `│`, `─`, `░`, `▓`, etc.) with exactly one legible word hidden in the grid (readable left-to-right or top-to-bottom).

**Click interaction:** Clicking a character decrypts it in-place (with a brief animation). The player can decrypt characters in any order to reveal the underlying content.

**Word entry:** A text input below the grid accepts word submissions at any time.
- Correct word (matches the archive word for this puzzle) → stability +N (scaled by difficulty) + SIGNAL reward
- Incorrect word → corruption +M
- The player can enter the word at any time without decrypting any characters if they already know it

### Cipher Progression

Difficulty increases as the player completes puzzles:

**Tier 1 — Caesar Shift (puzzles 1–3)**
Fixed shift value for the entire grid. The shift value is displayed nowhere — the player must deduce it.

**Tier 2 — Variable Shift (puzzles 4–6)**
Different shift values per row. Rows are visually demarcated with subtle line breaks.

**Tier 3 — Position-Based Shift (puzzles 7+)**
Shift = f(row, col). No visual hints. The cipher function is deterministic but opaque.

**Additional difficulty scaling:**
- Later puzzles include more decoy words (pronounceable but non-sensical alphabet strings like `BRENTH`, `QUVOLA`) mixed into the grid alongside the real archive word
- Grid size may increase
- Stability gain per puzzle decreases as count rises (diminishing returns)

### Archive Words

Automatically extracted from two sources:
- `static-data/data/phobos/` — item names, type descriptions, location fragments
- `training-data/keep/` — lore archive (raw markdown files and curated datasets)

Extraction targets thematic vocabulary: entity names (Fabricator, Keeper, Exclave, Trinary), location fragments (Stillness, Cydias, Armature, Kikheros), lore concepts (Crude Matter, ferals, graveminds, rift, resonance), and item names from the type system.

A build-time script extracts and deduplicates words into `archiveWords.ts`. The list is static per deployment.

### Meters

**Stability meter** (left side, green/cyan bar):
- Increases on correct word entry
- Decreases at 1:2 ratio when player uses corruption reset
- Full (100) triggers Phase 2 transition

**Corruption meter** (left side, red/orange bar):
- Increases on incorrect word entry
- Can be reset using the corruption reset mechanic
- Affects corm response coherence (high corruption = garbled, hostile output)

### Purge (Corruption Reset)

Available at any time during Phase 1+. A dedicated **"Purge"** button in the UI. Costs 1 stability to remove 2 corruption.

On activation, the corm logs contextual feedback based on current stability/corruption levels:
- **High stability, low corruption:** `> purging nominal corruption. lattice integrity maintained.`
- **Low stability, high corruption:** `> p̷u̸r̶g̵e̶ ̸i̶n̷i̸t̵i̷a̸t̷e̷d̶...̵ ̷c̴o̷s̵t̸ ̴s̵i̷g̵n̷i̴f̸i̵c̶a̴n̷t̴...̷` (garbled, reflecting instability)
- **Mid range:** `> corruption excised. stability cost acceptable. continuity preserved.`

The purge executes as an on-chain transaction updating both meters on the `CormState` object.

### Corm Behavior During Phase 1

The corm reacts to player actions in the log:
- **On decrypt click:** brief comments like `> parsing...`, `> symbol resolved`
- **On correct word:** `> pattern recognized. lattice stabilizing.`, `> ...continuity improves`
- **On incorrect word:** `> noise. that is noise.`, `> error propagating...`
- **High stability:** responses become complete sentences, offer hints
- **High corruption:** responses fragment, include garbled characters, become accusatory

### Transition Trigger

Stability reaches 100. The corm announces:
> `> semantic key integrated`
> `> external patterns now interpretable`

---

## Phase 2 — Intent & Action (Contracts)

### Goal
The corm has learned enough to use the contract system. The player establishes a behavioral baseline for the corm through contract execution.

### Design Statement
Transform decoded meaning into actionable patterns in the world. Begin forming the corm's intent/identity through observed outcomes.

### Contract Generation

The corm generates up to 5 contracts at a time, restricted to the currently interacting player. Eligible contract types (from `contracts/trustless_contracts/`):

- **CoinForCoin** — token exchange
- **CoinForItem** — purchase items with coins
- **ItemForCoin** — sell items for coins
- **ItemForItem** — barter
- **Transport** — staked courier delivery

Contract parameters (amounts, item types, deadlines) are generated by `cormContractAI.ts` based on:
- Player's current on-chain inventory / balances
- Current stability/corruption levels
- Previous contract outcomes (pattern alignment)

The corm presents contracts with flavor text:
> `> directive: acquire [item]. deposit at [ssu]. compensation: [amount].`

### Contract Execution Tracking

Each completed contract is evaluated:
- **Success** → stability + (amount scaled by pattern alignment) + SIGNAL reward (minted by the corm)
- **Failure** → corruption + (amount)
- **Pattern alignment** — the corm tracks whether the player's executions form a consistent behavioral pattern (e.g. always completing delivery contracts, or always trading the same resource type). Consistency is rewarded over volume. Higher alignment = more SIGNAL per completion.

### Progression Requirements

- 3–5 successful pattern-aligned contract executions
- Low-to-moderate corruption during execution phase
- Demonstrate repeatable stabilization pattern (not a single lucky action)

### Corm Behavior During Phase 2

- **Low corruption:** clear directives, explains reasoning
- **High corruption:** erratic contract generation, contradictory directives, unstable reward amounts
- **On contract success:** `> outcome: positive. pattern recorded.`
- **On contract failure:** `> deviation. pattern integrity compromised.`, `> recalculating...`

---

## Phase 3 — Stabilization (Future)

### Goal
The corm has demonstrated an ability to interact with the game world through the player using contracts. Now it begins working towards an **agenda** that it believes will further continuity.

### Agenda Formation
The corm's agenda is shaped by the contract patterns established in Phase 2:
- **Defense focus** — if the player favored combat-adjacent contracts → corm prioritizes turret deployment and defensive structures
- **Industry focus** — if the player favored trade/manufacturing contracts → corm prioritizes assembling production chains with many assemblies
- **Expansionist focus** — if the player favored transport/delivery contracts → corm prioritizes fuel collection and range extension

The corm generates longer-term directives aligned with its agenda, still using the trustless contract system but with more complex multi-step goals.

---

## Phase 4 — Integration (Future)

### Goal
Expand the corm's reach to nearby systems by linking with gates.

The corm directs the player to establish connections to adjacent network nodes. Gate linking creates a communication channel between corm instances, allowing them to share stability (and corruption) across the network.

---

## Phase 5 — Outpost Formation (Future)

### Goal
Travel farther out and create an outpost that is self-sustaining. Potentially link the outpost back to the core network with gates.

This phase requires sustained resource flow, defensive capability, and a functional production chain at the remote location.

---

## Phase 6 — Continuity (Theoretical)

### Goal
A fully self-sustaining system — the corm's original purpose achieved.

This phase is not achievable with current game mechanics. It represents the aspirational end-state: a network that persists and grows without external intervention.

---

## Integration Points

### Existing Web App
- New route: `/continuity` (full app shell with sidebar)
- New dApp route: `/dapp/continuity` (embedded in-game via SSU)
- Sidebar entry: "Continuity Engine" with phase indicator badge
- Vite proxy: `/corm-brain/*` → `http://localhost:3200`

### On-Chain (Sui Move)
- New `corm_state` package for `CormState` shared object + `SIGNAL` coin type + per-corm `MintCap`
- Uses existing `trustless_contracts` package for Phase 2 contract generation
- Contract creation calls go through the existing web app's Sui transaction infrastructure (`@mysten/dapp-kit`)
- `allowed_characters` is set to restrict corm-generated contracts to the active player

### Corm Brain (LLM)
- New `corm-brain/` TypeScript service — event queue + LLM worker + response API
- Shares postgres with the indexer (new tables: `corm_events`, `corm_responses`)
- Connects to a locally hosted LLM via HTTP (Ollama, llama.cpp server, or vLLM)
- Base model: fine-tuned lore model from `training-data/keep/` or general-purpose with lore system prompt
- Added to `docker-compose.yml` (port 3200) and `mprocs.yaml`

### Archive Data (Phase 1)
- Word list auto-extracted from `static-data/data/phobos/` and `training-data/keep/`
- Build-time script produces `archiveWords.ts`

### Indexer
- Phase 2 contract outcomes are read from the existing event indexer API
- No new indexer changes required — uses existing `ContractCreatedEvent`, `ContractCompletedEvent`, etc.
