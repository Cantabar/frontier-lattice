# Continuity Engine — Puzzle Mini-Game

## Problem
The current Phase 1 design places puzzle generation, cipher logic, and the archive word list in the client-side React bundle (`cipherEngine.ts`, `puzzleGenerator.ts`, `archiveWords.ts`). Any player can inspect the JS source or network traffic to extract answers. Moving puzzle state to a server-side service makes cheating require breaking the server rather than reading the client.

## Tech Stack Decision
**Go + HTMX** — server-rendered puzzle UI with no client-side puzzle state.

Rationale:
- Puzzle answers, cipher keys, and the word list never leave the server. The client receives only pre-rendered HTML fragments.
- HTMX's swap model maps directly to the puzzle mechanics: click a cell → `hx-post` → server returns decrypted character HTML. Submit a word → form POST → server validates and returns result fragment.
- Go compiles to a single binary, deploys as a lightweight Docker container alongside the existing services.
- Server-side sessions hold active puzzle state (grid layout, cipher parameters, target word, which cells are decrypted). Nothing is serialized to the client.
- The service is small and self-contained (one game mechanic), so adding Go to an otherwise TypeScript stack has minimal cognitive cost.

Alternatives considered:
- **TypeScript (Express) + HTMX**: Same architecture, keeps the stack uniform. Viable, but Go's stdlib `html/template` + `net/http` needs zero dependencies for this use case, and the compiled binary is simpler to deploy than a Node runtime.
- **React with server-validated API**: Keeps everything in the existing app but requires careful API design to avoid leaking answers in responses. Harder to get right — any puzzle metadata endpoint risks exposing the solution.

## Architecture

```
puzzle-service/           # New Go service
├── main.go               # Entry point, HTTP server setup
├── Dockerfile
├── go.mod
├── internal/
│   ├── server/
│   │   ├── routes.go     # Route registration
│   │   └── middleware.go # Session, CORS, rate limiting
│   ├── puzzle/
│   │   ├── generator.go  # Puzzle creation (grid, cipher, word placement)
│   │   ├── cipher.go     # Caesar, variable, position-based shift implementations
│   │   ├── grid.go       # Grid model (cells, dimensions, decoy placement)
│   │   └── session.go    # Per-player puzzle session state
│   ├── words/
│   │   ├── archive.go    # Archive word list (loaded at startup)
│   │   └── words.json    # Extracted word list (build artifact from static-data)
│   ├── handlers/
│   │   ├── phase0.go     # GET /phase0 (awakening UI), POST /phase0/interact (click tracking)
│   │   ├── game.go       # GET /puzzle, POST /puzzle/decrypt, POST /puzzle/submit
│   │   ├── contracts.go  # Contracts panel rendering (driven by corm-brain actions)
│   │   ├── stream.go     # GET /stream (SSE — corm log, boost, contract events)
│   │   ├── status.go     # GET /status (session state for meter sync)
│   │   └── health.go     # GET /health
│   ├── corm/
│   │   ├── relay.go      # WebSocket endpoint (/corm/ws), event fan-out, action dispatch
│   │   ├── deaddrop.go   # HTTP fallback: GET /corm/events + POST /corm/actions (used when WS is down)
│   │   └── types.go      # CormEvent, CormAction, BoostDirective, LogStreamDelta types
│   └── templates/
│       ├── layout.html       # Base layout (HTMX + SSE ext, meters sidebar, log panel, contracts panel)
│       ├── phase0.html       # Phase 0 dead terminal UI (clickable shell elements)
│       ├── grid.html         # Cipher grid partial
│       ├── cell.html         # Single cell partial (swap target for decrypt + boost)
│       ├── result.html       # Word submission result partial
│       ├── meters.html       # Stability/corruption meter partial
│       ├── log-entry.html    # Corm log message partial (SSE swap target)
│       ├── contract-card.html # Single contract entry partial (SSE swap target)
│       └── contracts.html    # Contracts list panel partial
├── static/
│   └── style.css         # Grid styling, animations
└── tests/
    ├── cipher_test.go
    ├── generator_test.go
    └── handler_test.go
```

## Phase 0 — Awakening

The puzzle service also hosts the Phase 0 intro sequence. The player sees a non-functional terminal shell with clickable buttons, panels, and toggles — all producing error-style log entries.

### Interaction Model

- All clicks are tracked server-side in the session (relayed to corm-brain via WebSocket).
- The UI is server-rendered HTMX: clicking elements triggers `hx-post` to `/phase0/interact` with an element ID. The server returns a log entry partial appended to the log panel.
- Corm-brain observes the click stream and pushes `log` actions with escalating awareness messages (`> ...input... detected...`, `> ...not part of baseline...`).

### Frustration Trigger

The server tracks click timestamps per element. When 3+ clicks on the same element occur within 2 seconds, the server:

1. Emits a `phase_transition` event to the WebSocket relay (or ring buffer if WS is disconnected)
2. Returns an HTMX response that swaps the entire page to the Phase 1 puzzle UI (via `hx-target="body"` or a full-page redirect to `GET /puzzle`)

The transition can include a glitch animation (CSS class on the body before swap).

### Session Continuity

The same session UUID carries from Phase 0 into Phase 1. Corm-brain sees the full arc: idle clicks → frustration → puzzle engagement.

## Phase 2+ — Contracts View

After the puzzle phase, the corm begins generating contracts (Phase 2). The puzzle service includes a lightweight contracts panel so the AI can surface its directives directly.

### How It Works

- Corm-brain pushes a new action type `contract_created` via `POST /corm/actions`. Payload: `{contract_id, contract_type, description, reward, deadline, detail_url}`
- The `detail_url` points to the existing contract detail page in the main app (e.g., `app.ef-corm.com/contracts/:id`)
- The puzzle service renders a contracts list partial and delivers it via SSE (new event type `corm-contract`). HTMX appends it to a `#contracts` panel in the layout.
- Each contract entry shows: type icon, corm's flavor text description, reward amount, and a link to the full detail view.
- When a contract is completed or expires, corm-brain pushes a `contract_updated` action to update or remove it from the panel.

### Contract Announcements

When the corm creates a contract, it can also push a `log` action announcing it with flavor text:
`> directive issued. acquire [item]. deposit at [location]. compensation offered.`

This appears in the log panel alongside the contract appearing in the contracts list.

## Puzzle Flow (HTMX Interactions)

1. **Load puzzle** — `GET /puzzle` returns full page: rendered cipher grid (all cells encrypted), word input form, stability/corruption meters. Grid cells are `<button hx-post="/puzzle/decrypt" hx-vals='{"row":R,"col":C}' hx-target="#cell-R-C" hx-swap="outerHTML">`.
2. **Decrypt cell** — Player clicks a cell. HTMX posts `{row, col}` to `/puzzle/decrypt`. Server looks up the session, applies the cipher to that cell, marks it decrypted, returns the updated `cell.html` partial with the plaintext character and a reveal animation class.
3. **Submit word** — Player types a word and submits. HTMX posts `{word}` to `/puzzle/submit`. Server compares against the session's target word:
   - **Correct**: Returns `result.html` with success state + updated `meters.html` (stability increased). Triggers CORM reward via corm-brain.
   - **Incorrect**: Returns `result.html` with error state + updated `meters.html` (corruption increased).
4. **Next puzzle** — On correct answer, a "Next" button appears that triggers `GET /puzzle` to load a fresh puzzle with higher difficulty tier.

## Server-Side Session Model

### Session Identity

Sessions are keyed by a server-generated UUID, set as an HTTP cookie on first `GET /puzzle`. Every subsequent HTMX request includes the cookie automatically.

### URL Routing

The entry point determines the session context:

- **Browser**: `puzzle.ef-corm.com/?player=0x...` — context is `browser`
- **SSU (in-game)**: `puzzle.ef-corm.com/ssu/:entity_id?player=0x...` — context is `ssu:<entity_id>`, extracted from the path

When configuring an SSU extension on-chain, the dapp URL is set to `https://puzzle.ef-corm.com/ssu/<entity_id>`. The `player_address` is appended as a query param by the game client at load time.

All subsequent routes are context-aware — Phase 0, puzzle, and contracts URLs are prefixed with the SSU path when applicable (e.g., `/ssu/:entity_id/phase0/interact`, `/ssu/:entity_id/puzzle/decrypt`). The Go router extracts `:entity_id` via path parameter and attaches it to the session.

These are stored on the session and included in every event relayed to corm-brain via WebSocket, so it knows *who* is acting and *where* they're acting from. This enables the AI to tailor responses (e.g., in-game SSU interactions might get more lore-appropriate corm messages, while browser sessions get a more analytical tone).

### Session Fields

Each player session holds:
- `puzzleID` — unique ID for the current puzzle
- `grid [][]Cell` — full grid with plaintext values (never sent to client as plaintext)
- `cipherParams` — shift type + values for the active cipher tier
- `targetWord` — the archive word hidden in the grid
- `decryptedCells map[string]bool` — which cells the player has revealed
- `difficulty` — current tier (1–3), advances after N solves
- `solveCount` — total puzzles solved this session
- `incorrectAttempts` — for corruption tracking

Sessions are stored in-memory (Go map + mutex) with optional Redis/Postgres persistence for durability across restarts. For hackathon scope, in-memory is sufficient.

Additional session fields for corm integration:
- `eventBuffer` — bounded ring buffer of player events with monotonic sequence numbers (WebSocket outbox, also used for HTTP fallback)
- `actionChan chan CormAction` — channel fed by WebSocket relay dispatcher (or `POST /corm/actions` fallback), consumed by the SSE goroutine
- `pendingDifficultyMod` — AI-requested difficulty adjustment, applied on next puzzle generation
- `recentDecrypts []CellCoord` — rolling window of recently decrypted cells (boost targeting)
- `activeLogStream *LogStreamState` — tracks in-progress streaming log entry (entry_id, accumulated text) for the SSE goroutine

## Anti-Cheat Properties

- **No client-side puzzle data**: The word list, cipher keys, and grid solutions exist only in server memory. The client sees only rendered HTML with encrypted characters (or decrypted ones after a server round-trip).
- **Cell decryption is server-gated**: Each decrypt request is validated against the session. Replaying or fabricating requests without a valid session yields nothing.
- **Rate limiting**: Decrypt requests are rate-limited per session (e.g., max 2/sec) to prevent automated brute-force scanning.
- **Word submission is server-validated**: The answer comparison happens server-side. The response only indicates correct/incorrect — no hints about how close the guess was.
- **No puzzle metadata in responses**: Grid dimensions and cipher type are implicit in the rendered HTML. No JSON endpoints expose puzzle parameters.

## Corm Brain Integration

The corm brain observes player actions asynchronously and occasionally interjects. It never blocks puzzle interactions.

### Network Topology

The corm-brain runs **on-premise** and is not reachable from external services. All communication is initiated by corm-brain outbound to the puzzle service via a persistent WebSocket connection.

### WebSocket Live Relay (`/corm/ws`)

Corm-brain opens a single outbound WebSocket to `wss://puzzle.ef-corm.com/corm/ws`. This connection carries all traffic in both directions:

**Puzzle-service → corm-brain (player events):**
When a player acts, the puzzle handler processes the action, responds to the client immediately, and writes the event as a JSON WebSocket message to all connected corm-brain clients. Message format: `{"type": "event", "seq": N, "session_id": "...", "player_address": "0x...", "context": "ssu:...", "event_type": "decrypt", "payload": {...}, "timestamp": "..."}`.

**Corm-brain → puzzle-service (actions):**
Corm-brain sends action messages back over the same WebSocket. Action types:
  - `log_stream_start` — begin a new streaming log entry. Payload: `{session_id, entry_id}`. Puzzle-service creates an empty log entry element on the browser SSE.
  - `log_stream_delta` — append token(s) to an in-progress log entry. Payload: `{session_id, entry_id, text}`. Relayed to browser SSE immediately.
  - `log_stream_end` — finalize a streaming log entry. Payload: `{session_id, entry_id}`. Removes typing indicator, marks entry complete.
  - `log` — a complete (non-streaming) corm message. Payload: `{session_id, text}`. Used for short, pre-composed messages (e.g., Phase 0 awakening fragments) that don't benefit from streaming.
  - `boost` — amplify a recent player interaction. Payload: `{session_id, cells: [{row, col}], effect: "glow"|"pulse"|"echo"}`
  - `difficulty` — adjust parameters for the next puzzle. Payload: `{session_id, tier_delta, decoy_delta, grid_size_delta}`
  - `state_sync` — push current CormState values. Payload: `{session_id, phase, stability, corruption}`.
  - `contract_created` — announce a new contract. Payload: `{session_id, contract_id, contract_type, description, reward, deadline, detail_url}`
  - `contract_updated` — update/remove a contract. Payload: `{session_id, contract_id, status}`.

**Reconnection:** Corm-brain reconnects with exponential backoff (1s → 2s → 4s → ... → 30s cap). During disconnection, events are buffered in the ring buffer (same as the HTTP fallback path).

### HTTP Fallback Endpoints

The dead-drop HTTP endpoints remain as a fallback when the WebSocket is unavailable:
- `GET /corm/events?after=N` — pull buffered events since sequence N
- `POST /corm/actions` — push complete actions (no streaming support)

Corm-brain uses these automatically if the WebSocket connection fails and reconnection hasn't succeeded yet.

### Internal Flow

1. **Player acts** — puzzle handler processes the action (decrypt/submit), responds to the client immediately, and writes the event to the WebSocket relay (or ring buffer if WS is disconnected).
2. **Corm-brain receives instantly** — the event arrives over the WebSocket with no polling delay.
3. **Corm-brain streams response** — starts LLM inference with `"stream": true` and sends `log_stream_start`, then `log_stream_delta` messages as tokens are generated, then `log_stream_end`.
4. **Puzzle-service relays to browser** — each delta is rendered as an SSE event and delivered to the player's browser immediately. The player sees the corm's response appear token-by-token.
5. **Non-streaming actions** (boost, difficulty, contract) are sent as complete WebSocket messages and delivered to the browser SSE as before.

### AI Interjections

Three types of real-time interjections:

- **Streaming log** — the corm's response appears token-by-token in the log panel. `log_stream_start` creates an empty `<span id="entry-{id}">` with a typing cursor CSS class. Each `log_stream_delta` appends text content to the span. `log_stream_end` removes the cursor class. Delivered via SSE events `corm-log-start`, `corm-log-delta`, `corm-log-end`. This produces the "alive" typing effect for all LLM-generated responses.
- **Instant log** — a pre-composed corm message (e.g., Phase 0 awakening fragments like `> ...`, `> ░░░░░░░░`). Rendered as `log-entry.html` and appended to `#corm-log` via SSE event `corm-log`. Used for short, deterministic messages that don't need streaming.
- **Boost** — a directive to amplify a recent player interaction. The AI identifies cells the player recently decrypted and the puzzle service re-renders them with enhanced visual treatment (glow, highlight, brief animation). Delivered via SSE event `corm-boost`.

### Boost Mechanic Detail

A boost does **not** decrypt new cells or reveal the answer. It visually amplifies something the player has *already* revealed:

- **Cell highlight** — a recently decrypted cell gets a glow/pulse, drawing attention to a character the player may have overlooked.
- **Row/column emphasis** — a row or column containing the hidden word gets a subtle background shift, hinting at the word's orientation.
- **Decay echo** — a previously decrypted cell briefly re-animates its reveal effect, reinforcing that the player is on the right track.

The AI decides when and what to boost based on:
- Time since last player action (boost during idle periods to re-engage)
- Number of decrypted cells near the hidden word (reward proximity)
- Current corruption level (high corruption → boosts become visually distorted, less helpful)

### Difficulty Adjustment

The corm brain can also send difficulty adjustment directives. These don't take effect immediately — they're applied on the **next puzzle generation**. The puzzle service stores pending adjustments in the session:

- `pendingDifficultyMod` — shift tier up/down, adjust decoy count, resize grid
- Applied when `GET /puzzle` generates the next puzzle

This keeps the current puzzle stable while letting the AI influence the trajectory.

### SSE Delivery

The puzzle service maintains an SSE connection per player session (`GET /stream`, HTMX `hx-ext="sse"`).

- The SSE goroutine reads from the session's action channel (fed by the WebSocket relay dispatcher, or by `POST /corm/actions` fallback).
- When an action arrives:
  - **Log stream start** → SSE event `corm-log-start` with an empty `<span id="entry-{id}" class="corm-typing">` partial. HTMX appends it to `#corm-log`.
  - **Log stream delta** → SSE event `corm-log-delta` with a text fragment. HTMX appends content inside `#entry-{id}`. Arrives at token generation rate (~72 tok/s Nano, ~18 tok/s Super).
  - **Log stream end** → SSE event `corm-log-end` targeting `#entry-{id}`. Removes the `corm-typing` class (hides typing cursor). Wraps the entry in the final `> ` prefix formatting.
  - **Log (instant)** → SSE event `corm-log` with rendered `log-entry.html` partial. HTMX appends it to `#corm-log` via `sse-swap="corm-log"`.
  - **Boost** → SSE event `corm-boost` with re-rendered cell partials including an amplification CSS class. HTMX swaps the targeted cells.
  - **Contract** → SSE event `corm-contract` with rendered `contract-card.html` partial. HTMX appends/updates `#contracts`.
  - **Difficulty** → stored in session as `pendingDifficultyMod`, no immediate UI effect.
- The SSE goroutine is lightweight — one per active session, torn down on disconnect.

## Integration with Existing Stack

**Docker Compose**: New service entry:

```yaml
puzzle-service:
  build:
    context: ./puzzle-service
    dockerfile: Dockerfile
  ports:
    - "3300:3300"
  environment:
    - PUZZLE_PORT=3300
  restart: unless-stopped
```

**Web app embedding**: The React app at `/continuity` embeds the puzzle UI via iframe pointing to `http://localhost:3300/puzzle`.

**CORM rewards**: Handled entirely by corm-brain. It observes `word_submit` success events in the WebSocket event stream (which include `player_address`) and executes CORM minting and CormState updates on-chain from on-premise where it has SUI RPC access. The puzzle service has no SUI dependency.

**Corm integration**: The corm log panel, boost effects, and contracts panel live inside the puzzle service's own UI (delivered via SSE as described above), not in the React parent.

## Cipher Tiers (Unchanged from Main Plan)

- **Tier 1 — Caesar Shift (puzzles 1–3)**: Fixed shift for entire grid.
- **Tier 2 — Variable Shift (puzzles 4–6)**: Per-row shift values.
- **Tier 3 — Position-Based Shift (puzzles 7+)**: Shift = f(row, col).
- Decoy words increase with tier. Grid size may grow.

## Archive Word Extraction

A build-time script (can remain in TypeScript or be rewritten in Go) extracts words from `static-data/data/phobos/` and `training-data/keep/`, deduplicates, and writes `puzzle-service/internal/words/words.json`. The puzzle service loads this file at startup.

## Resolved Decisions

- **Session persistence**: Sessions are ephemeral and in-memory only. A browser reload creates a fresh session. Corm-brain tracks long-lived player state (solve history, difficulty progression, CORM balance) keyed by `player_address` across sessions. The puzzle service is stateless across restarts.
- **Embedding approach**: All services share a root domain (`ef-corm.com`) with subdomains (e.g., `puzzle.ef-corm.com`, `app.ef-corm.com`). Same root domain avoids cross-origin issues with cookies and `postMessage`. No iframe sandboxing needed.
- **On-chain state for difficulty calibration**: Corm-brain pushes CormState values (phase, stability, corruption) via `POST /corm/actions` with a `state_sync` action type. The puzzle service stores these on the session and uses them to influence puzzle generation.
