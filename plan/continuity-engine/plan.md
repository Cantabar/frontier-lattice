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
│   │   └── corm_coin.move              # CORM coin type + per-corm MintCap
│   └── tests/
│       ├── corm_state_tests.move
│       └── corm_coin_tests.move

corm-brain/                                 # New service: LLM intermediary
├── ...                                     # See corm-brain.md for canonical service structure

web/src/
├── continuity-engine/
│   ├── ContinuityEngine.tsx                # Iframe wrapper for puzzle service
│   └── useCormState.ts                     # Hook to read on-chain CormState
```

**NOTE:** The `puzzle-service.md` and `corm-brain.md` plans supersede this document's implementation details. The directory structure above is simplified to show integration points.

The Continuity Engine will be accessible as a new route (`/continuity`) in the existing React web app and can also be embedded within the dApp shell (`/dapp/continuity`) for in-game SSU interaction.

## On-Chain Corm State

A new Sui Move package (`contracts/corm_state/`) stores the canonical corm state on-chain.

**`CormState` shared object:**
- `network_node_id: ID` — the network node this corm is associated with
- `phase: u8` — current phase (0–6)
- `stability: u64` — 0 to 100
- `corruption: u64` — 0 to 100

Phase transitions, stability/corruption updates, and CORM minting are executed as on-chain transactions managed by the `corm-brain` service.

The authoritative corm identity lives on-chain (shared progression), while the `puzzle-service` manages ephemeral session state and the `corm-brain` manages persistent player state and AI interactions.

## CORM Token

A corm-minted incentive token representing a player's contribution to continuity. Carries no direct monetary value.

### On-Chain Design

**Coin type:** `CORM` (one-time witness in `corm_coin.move`) — a standard fungible coin.

**`CoinAuthority`** — shared object holding the `TreasuryCap<CORM>`. Not directly accessible; all minting is gated through corm logic.

**`MintCap`** — issued per `CormState` on creation. Authorizes a specific corm to mint CORM. Held by the `corm-brain` service keypair. Fields:
- `corm_state_id: ID` — the corm this cap belongs to
- `total_minted: u64` — lifetime mint count (provenance tracking)

### Minting

Only the `corm_coin` module can mint. On a qualifying event (puzzle solve, contract completion), the module:
1. Verifies the `MintCap` matches the active `CormState` (signed by `corm-brain`)
2. Mints `Coin<CORM>` via the `TreasuryCap`
3. Transfers the `Coin<CORM>` to the player

Standard `Coin<CORM>` objects can be merged, split, and used directly in trustless contracts without any wrapping or unwrapping.

### Distribution Rules

- **Phase 1:** Small CORM rewards for correct archive word submissions. Amount scales with puzzle difficulty tier.
- **Phase 2:** Larger CORM rewards for successful contract completions. Amount scales with pattern alignment bonus.
- **Phase 3+:** CORM distribution tied to agenda-aligned actions.

### Utility (Planned)

- **Purge fuel:** Purge could optionally consume CORM instead of (or in addition to) stability, giving players a way to manage corruption without losing progress.
- **Corm influence:** In Phase 3+, players could spend CORM to weight the corm's agenda direction.
- **Cross-node transfer:** In Phase 4+, CORM could be sent between linked corm networks, representing shared trust.
- **Participation metric:** Total CORM held serves as a visible record of a player's contribution to continuity.

## Client State

Ephemeral/UI state lives in the `puzzle-service` session (Go/HTMX) and is not persisted client-side.

**Session-based state (in puzzle-service):**
- `clickLog` — tracked server-side
- `solvedPuzzles` — tracked in session
- `contractHistory` — tracked by corm-brain
- `cormLogEntries` — delivered via SSE stream

**From on-chain (read via `useCormState` hook):**
- `phase`, `stability`, `corruption` — sourced from the `CormState` object (updated by corm-brain)

Phase progression is one-way (no regression).

## Corm Brain (LLM Service)

**Note: The `corm-brain.md` plan is the canonical source of truth for the AI implementation.**

The corm's voice is driven by a hosted LLM service. The client **never** communicates directly with the corm brain. Instead, the `puzzle-service` acts as a live relay via a persistent WebSocket connection initiated by corm-brain.

### Architecture

```
Client (HTMX) → [POST /interact] → Puzzle Service ←──── WebSocket ────→ Corm Brain
                                          ↓                                  ↑
Client (SSE)  ← [stream html]  ← Puzzle Service (Session)  ← [ws msg] ← Corm Brain
```

Corm-brain opens a persistent outbound WebSocket to the puzzle-service (`/corm/ws`). Player events are pushed to corm-brain instantly over this connection; corm-brain streams LLM token deltas back over the same connection. The puzzle-service relays token deltas to the browser via SSE, producing a live "typing" effect in the corm log.

### Event Flow (WebSocket Live Relay)

1. **Client emits events** — Player actions (clicks, solves) are sent to the `puzzle-service`.
2. **Puzzle Service relays instantly** — Writes the event as a JSON message to the corm-brain WebSocket.
3. **Inference & Streaming** — `corm-brain` processes context, starts LLM inference with `"stream": true`, and streams token deltas back over the WebSocket as they are generated.
4. **Live delivery** — Puzzle-service receives each token delta and relays it to the browser via SSE. The player sees the corm's response appear token-by-token (~72 tok/s for Nano, ~18 tok/s for Super).
5. **Non-streaming actions** (boost, difficulty, contract, state_sync) are sent as complete WebSocket messages and delivered to the browser SSE as before.

See `corm-brain.md` for model details (DGX Spark, Nemotron 3, etc.).

---

## Phase 0 — Player Activity

### Goal
Introduce the system as non-functional. The corm is dormant but increasingly restless.

### UI
Implemented as server-rendered HTML in `puzzle-service` (HTMX).
- A shell that mimics a broken terminal or dashboard
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
Implemented in `puzzle-service`. State lives on the server.

A grid of characters (e.g. 12×8) is displayed. Each cell contains one encrypted character. The full decrypted output is primarily non-alphabet ASCII characters (`#`, `@`, `%`, `│`, `─`, `░`, `▓`, etc.) with exactly one legible word hidden in the grid (readable left-to-right or top-to-bottom).

**Click interaction:** Clicking a character decrypts it in-place (with a brief animation). The player can decrypt characters in any order to reveal the underlying content.

**Word entry:** A text input below the grid accepts word submissions at any time.
- Correct word (matches the archive word for this puzzle) → stability +N (scaled by difficulty) + CORM reward
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

Available at any time during Phase 1+. A dedicated **"Purge"** button in the UI.

**TODO:** Define purge transaction flow in `puzzle-service.md`. Since `puzzle-service` has no chain access, the button likely triggers an event to corm-brain, which then executes the on-chain update.

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

Contract parameters are generated by the `corm-brain` AI and pushed to the `puzzle-service` contracts panel.

The corm presents contracts with flavor text:
> `> directive: acquire [item]. deposit at [ssu]. compensation: [amount].`

### Contract Execution Tracking

Each completed contract is evaluated:
- **Success** → stability + (amount scaled by pattern alignment) + CORM reward (minted by the corm)
- **Failure** → corruption + (amount)
- **Pattern alignment** — the corm tracks whether the player's executions form a consistent behavioral pattern (e.g. always completing delivery contracts, or always trading the same resource type). Consistency is rewarded over volume. Higher alignment = more CORM per completion.

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
- New route: `/continuity` (iframe wrapper for `puzzle-service`)
- New dApp route: `/dapp/continuity` (iframe wrapper for `puzzle-service`)

### On-Chain (Sui Move)
- `corm_state` package and `CORM` coin (managed by `corm-brain` authority)
- `allowed_characters` restricted to active player

### Corm Brain (LLM)
- See `corm-brain.md`. Handles all AI logic, on-chain state updates, and CORM minting.
- Connects to `puzzle-service` via persistent outbound WebSocket (`/corm/ws`).

### Puzzle Service
- See `puzzle-service.md`. Handles all game UI (Phase 0/1/2), user sessions, and mechanics.
- Server-side HTMX + Go.
