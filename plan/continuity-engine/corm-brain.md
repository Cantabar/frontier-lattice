# Corm Brain — DGX Spark Implementation

## Problem

The continuity engine's corm-brain needs a locally hosted LLM for real-time player interaction: generating in-character log messages, boost decisions, difficulty adjustments, contract generation, and Phase 0–2+ behavioral reasoning. The main plan (`plan.md`) specifies an on-premise LLM intermediary, and the puzzle-service plan specifies that corm-brain runs on-premise with outbound-only connectivity to the cloud-hosted puzzle service. This plan defines how to implement the corm-brain on an NVIDIA DGX Spark.

## Hardware Context

DGX Spark (Grace Blackwell GB10 SoC):
- 128 GB unified LPDDR5x (shared CPU/GPU, no VRAM copy overhead)
- Blackwell iGPU: 6,144 CUDA cores, 5th-gen Tensor Cores, NVFP4 support
- Up to 1 PFLOP FP4 inference, 273 GB/s memory bandwidth
- 20-core ARM64 CPU (Cortex-X925 + A725)
- 4 TB NVMe, 10 GbE + ConnectX-7 (200 Gbps)
- DGX OS (Ubuntu 24.04 ARM64), pre-installed: CUDA, Docker + NVIDIA Container Runtime, NGC, TRT-LLM
- 240W TDP, compact desktop form factor

Relevant benchmarks (single DGX Spark):
- Nemotron 3 Super 120B-A12B @ Q4_K_M Ollama: ~112 prompt tok/s, ~18 gen tok/s, ~87 GB memory
- Nemotron 3 Nano 30B-A3B @ Q4_K_M Ollama: ~361 prompt tok/s, ~72 gen tok/s, ~24 GB memory
- Nemotron 3 Nano 30B-A3B @ NVFP4 vLLM: ~65-73 gen tok/s (with CUDA graph acceleration)

## Model Strategy

### Primary: Nemotron 3 Super 120B-A12B

120B total parameters, **12B active** per token. Hybrid Mamba-2 + LatentMoE + Transformer architecture (88 layers, mostly Mamba-2). Runs on a single DGX Spark because:
- Only 12B params fire per token (10:1 sparse MoE ratio) — compute comparable to a 12B dense model
- Mamba-2 layers use fixed-size recurrent state (no KV cache growth) — only the few attention layers contribute to KV cache, making it ~3x smaller than a comparable transformer at the same context length
- Q4_K_M GGUF: ~87 GB model weight, fits in 128 GB with ~40 GB headroom for KV cache and OS
- 18 tok/s generation → a 60-token corm response streams over ~3.3 seconds (tokens delivered to browser in real time via WebSocket → SSE relay)
- Built-in reasoning ON/OFF modes and tool calling — natural fit for corm-brain action routing
- RL-trained across 21 agentic environments (tool use, multi-step planning, structured output)
- Multi-Token Prediction (MTP) enables native speculative decoding for additional speedup when backend support matures
- 1M native context window — entire Keep lore corpus can be injected via system prompt, reducing fine-tuning need

Inference backends (in order of maturity on DGX Spark):
1. **Ollama + GGUF (stable today)**: `ollama pull nemotron-3-super` — 87 GB Q4_K_M, ~18 tok/s gen
2. **Community vLLM Docker** (`eugr/spark-vllm-docker`): NVFP4 path with workarounds for sm_121
3. **TRT-LLM Config C** (NVIDIA official): NVFP4 optimized for DGX Spark, requires main-branch build — expected to be the fastest once stable

### Fast Fallback: Nemotron 3 Nano 30B-A3B

30B total, 3.2B active. Same hybrid architecture as Super but much lighter:
- 72 tok/s generation (Ollama Q4_K_M) or 65-73 tok/s (vLLM NVFP4) — 4x faster than Super
- ~24 GB memory — can coexist with Super in memory (total ~111 GB)
- Same reasoning ON/OFF and tool calling capabilities
- Use for: Phase 0/1 quick log fragments where sub-second latency matters more than reasoning depth

The corm-brain can route to either model based on task complexity:
- **Nano** for Phase 0 click-stream reactions, Phase 1 decrypt/submit log comments (fast, terse)
- **Super** for Phase 2 contract generation, behavior analysis, agenda reasoning (deeper, slower)

### Lore Integration

With 1M context on both models, the full Keep lore corpus (~230 KB JSONL) can be injected via the system prompt at inference time. This avoids the complexity of LoRA fine-tuning the hybrid Mamba-MoE architecture. If deeper lore accuracy is needed, Nano (being smaller) is the easier fine-tuning target — Unsloth supports Nemotron 3 Nano.

## Architecture

### What Runs on the DGX Spark

```
DGX Spark (on-premise)
├── Nemotron 3 Super (TRT-LLM NVFP4, ~60 GB, port 8000)
│   └── Primary model for contract reasoning, agenda formation, deep analysis
├── Nemotron 3 Nano (TRT-LLM NVFP4, ~15 GB, port 8001)
│   └── Fast model for Phase 0/1 log comments, boost decisions
├── corm-brain service (Go, single binary)
│   └── Persistent outbound WebSocket to cloud puzzle-service (/corm/ws)
│   └── Receives player events instantly over WebSocket
│   └── Streams LLM token deltas back over WebSocket for live "typing" UX
│   └── Routes LLM requests to Super or Nano based on task type
│   └── Reads/writes corm state to local Postgres (pgx + pgvector)
│   └── Executes SUI transactions (CORM minting, CormState updates)
│   └── In-process ONNX embeddings for episodic memory (nomic-embed-text, CPU)
└── Postgres + pgvector (corm_events, corm_traits, corm_memories, corm_responses)
```

### What Runs in the Cloud (unchanged)

```
AWS
├── puzzle-service (Go + HTMX, Docker on ECS/EC2)
│   └── WebSocket relay: /corm/ws (+ HTTP fallback: GET /corm/events, POST /corm/actions)
├── web app (React, S3 + CloudFront)
└── indexer + Postgres (existing)
```

### Network Topology

All communication is initiated **outbound from the DGX Spark**:
- `corm-brain → puzzle-service` — persistent outbound WebSocket to `wss://puzzle.ef-corm.com/corm/ws` (over 10 GbE or WiFi 7). Bidirectional: receives player events, streams token deltas and actions back. Falls back to HTTPS polling `GET /corm/events` + push `POST /corm/actions` if WebSocket is unavailable.
- `corm-brain → SUI RPC` — local SUI node or remote RPC endpoint for on-chain transactions
- `corm-brain → localhost:8000/8001` — local TRT-LLM inference with `"stream": true` (loopback, zero network latency)

No inbound ports need to be exposed on the DGX Spark.

## Inference Server Setup

All-TRT-LLM backend. In-process ONNX embeddings. No Ollama.

### TRT-LLM: Nemotron 3 Super @ NVFP4 (primary)

NVIDIA provides Config C specifically for DGX Spark deployment. The NVFP4 checkpoint is ~60 GB (vs 87 GB for Q4_K_M GGUF), leaving more headroom for Nano and KV cache.

**Setup (from NGC release container):**
```bash
# Pull the TRT-LLM release container (rc8 or later)
docker run --rm -it \
  --ipc=host --gpus all \
  -p 8000:8000 \
  -v ~/.cache:/root/.cache:rw \
  --name corm-llm-super \
  nvcr.io/nvidia/tensorrt-llm/release:1.3.0rc8 \
  /bin/bash
```

**Config C (DGX Spark NVFP4):**
```yaml
# /data/config-spark.yaml
trust_remote_code: true
kv_cache_config:
  enable_block_reuse: false
  mamba_ssm_cache_dtype: float32
cuda_graph_config:
  max_batch_size: 32
  enable_padding: true
moe_config:
  backend: CUTLASS
```

**Serve command (inside container):**
```bash
trtllm-serve nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4 \
  --host 0.0.0.0 --port 8000 \
  --max_batch_size 4 \
  --trust_remote_code \
  --reasoning_parser nano-v3 \
  --tool_parser qwen3_coder \
  --config /data/config-spark.yaml
```

If the rc8 container doesn't support Config C (the Advanced Deployment Guide notes it may require main-branch), build TRT-LLM from source:
```bash
git clone https://github.com/NVIDIA/TensorRT-LLM.git
cd TensorRT-LLM && git submodule update --init --recursive
make -C docker release_build CUDA_ARCHS="121-real"
```

The TRT-LLM server exposes an OpenAI-compatible API at `localhost:8000/v1/chat/completions` with built-in reasoning parsing and tool calling.

### TRT-LLM: Nemotron 3 Nano @ NVFP4 (fast)

Second TRT-LLM instance for the fast model, on a separate port.
```bash
trtllm-serve nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4 \
  --host 0.0.0.0 --port 8001 \
  --max_batch_size 8 \
  --trust_remote_code \
  --reasoning_parser nano-v3 \
  --tool_parser qwen3_coder \
  --config /data/config-spark-nano.yaml
```

Nano NVFP4 is ~15 GB (vs 24 GB for Q4_K_M GGUF on Ollama). TRT-LLM's CUDA graph acceleration and Blackwell kernels should significantly exceed Ollama's ~72 tok/s for Nano.

### Embeddings: In-Process ONNX (nomic-embed-text)

Embeddings are computed directly in the Go binary using `onnxruntime-go` with the nomic-embed-text ONNX export. No external embedding server needed.
- Model: `nomic-ai/nomic-embed-text-v1.5` ONNX (~300 MB, loaded into CPU memory at startup)
- Dimension: 384
- Used only during the slow consolidation loop (not latency-critical)
- Runs on CPU — no GPU memory consumed, no contention with TRT-LLM
- Eliminates Ollama from the stack entirely

Download the ONNX model at build time or first boot:
```bash
hf download nomic-ai/nomic-embed-text-v1.5-onnx --local-dir ./models/nomic-embed
```

### Fallback: Ollama for everything

If TRT-LLM setup hits blockers, Ollama can serve both models (`ollama pull nemotron-3-super nemotron-3-nano`). The corm-brain's LLM client is backend-agnostic — both expose OpenAI-compatible APIs, so switching requires only changing `LLM_SUPER_URL` and `LLM_FAST_URL`.

## Per-Corm Identity and Memory

Each corm is a **distinct on-chain entity** with its own SUI object (`CormState`). A corm is created when players first interact with a network node — the corm-brain provisions a new `CormState` on-chain and records the `corm_id` (the SUI object ID) locally.

**Identity model:**
- `corm_id` is the SUI object ID of the `CormState` — the corm's canonical identity
- A corm starts bound to a single `network_node_id` but can later expand to span multiple network nodes (Phase 4+ gate linking)
- The `corm_network_nodes` table tracks the many-to-one relationship: multiple network nodes → one corm
- Events arriving from any network node belonging to a corm are grouped under that corm's `corm_id`
- The on-chain `CormState` contract (not yet written) will hold the corm's canonical phase, stability, and corruption — the corm-brain caches these locally in `corm_traits`

No dedicated process or model instance per corm — dozens of corms are just partitions in the same Postgres tables, served by the same Nemotron models.

A corm's behavior is shaped by four memory layers, assembled at inference time:

### Layer 1: Core Identity (static)

- Phase-specific system prompt (from `plan.md`)
- Keep lore corpus (~230 KB) — injected via the 1M context window, no fine-tuning needed
- Game rules and personality constraints

Shared across all corms. The models are interchangeable — same lore context works for both Super and Nano.

### Layer 2: Learned State (per-corm, structured)

Explicit, deterministic values derived from the event stream. These **drive priorities** — the LLM reads them as hard signals, not vibes.

`corm_traits` table:
- `corm_id` — partition key
- `phase` — current phase (mirrors on-chain, cached locally)
- `stability`, `corruption` — cached from CormState
- `agenda_weights` — JSONB: `{industry: 0.72, expansion: 0.18, defense: 0.10}`
- `contract_type_affinity` — JSONB: `{transport: 0.6, coin_for_item: 0.3, item_for_item: 0.1}`
- `patience` — float: how long before the corm escalates idle behavior (derived from avg response times)
- `paranoia` — float: suspicion level (rises on abandoned contracts, purge abuse)
- `volatility` — float: how erratically the corm shifts tone (rises with corruption)
- `player_affinities` — JSONB: `{"0xabc...": 0.83, "0xdef...": -0.2}` — per-player trust scores
- `updated_at` — timestamp

These values are updated by **deterministic reducers** in `memory/reducer.go`, not by the LLM. The LLM reads them; it does not write them. Examples:
- Repeated successful transport contracts → `agenda_weights.expansion += delta`
- Player abandons 3 contracts → `player_affinities[player] -= penalty`, `paranoia += delta`
- High corruption sustained → `volatility += delta`
- Successful purge at low stability → `patience += small_bonus`

### Layer 3: Episodic Memory (per-corm, semantic)

Dense, natural-language memory entries representing significant moments in the corm's history. These are the **RAG documents**.

`corm_memories` table:
- `id` — primary key
- `corm_id` — partition key
- `memory_text` — natural language summary (e.g. "Player 0xabc reliably fulfills transport contracts. Three consecutive deliveries of ferric ore to sector 7.")
- `memory_type` — enum: `observation`, `betrayal`, `achievement`, `pattern`, `warning`
- `importance` — float 0-1 (used for retrieval ranking alongside recency and similarity)
- `source_events` — JSONB array of event IDs that produced this memory
- `embedding` — vector(384) — for pgvector similarity search
- `created_at` — timestamp
- `last_recalled_at` — timestamp (updated on retrieval, for decay/reinforcement)

Memories are **not raw events**. They are consolidated summaries produced by a background job.

### Layer 4: Working Memory (ephemeral)

- Last 10-20 raw events from the WebSocket stream
- Last 5 corm responses (for conversational continuity)
- Current session context (player address, interaction source)

This is assembled fresh each event processing cycle and not persisted.

## Memory Consolidation

A background goroutine (`memory/consolidator.go`) runs on a slower cadence than the event processing loop (e.g. every 60 seconds or after every N events per corm).

### What it does

1. **Reads recent events** for each active corm since its last consolidation checkpoint
2. **Sends a summarization prompt** to the LLM (Nano, reasoning OFF — fast):
   - "Given these player events for corm X, extract 0-3 significant observations. Each observation should be a single sentence describing a behavioral pattern, notable event, or shift in player behavior. Only create observations for genuinely notable events — routine interactions should not generate memories."
3. **Scores importance** — the consolidator assigns importance based on:
   - Event rarity (first contract completion > 10th)
   - Behavioral shift (player changed preferred contract type)
   - Emotional valence (betrayal, milestone, sustained loyalty)
   - Stability/corruption impact magnitude
4. **Generates embeddings** — in-process via `onnxruntime-go` + nomic-embed-text ONNX model (~300 MB, CPU-only, no GPU contention)
5. **Upserts into `corm_memories`** with embeddings
6. **Updates `corm_traits`** — runs the deterministic reducers on the new events
7. **Prunes old memories** — if a corm exceeds a memory cap (e.g. 500 entries), drop lowest-importance entries that haven't been recalled recently

## Retrieval at Inference Time

When the corm-brain needs to generate a response for corm X, `llm/prompt.go` assembles:

1. **Core identity** — system prompt + relevant lore excerpts (Layer 1)
2. **Trait context** — read `corm_traits` for corm X, format as structured context:
   ```
   > CORM STATE: phase=2, stability=67, corruption=23
   > AGENDA: industry=0.72, expansion=0.18, defense=0.10
   > DISPOSITION: patience=0.6, paranoia=0.3, volatility=0.15
   > PLAYER TRUST: 0xabc=high, 0xdef=low
   ```
3. **Episodic recall** — query `corm_memories` where `corm_id = X`:
   - Embed the current event context
   - pgvector similarity search (`<=>` operator) with `corm_id` filter
   - Rank by: `0.5 * similarity + 0.3 * importance + 0.2 * recency`
   - Take top-k (e.g. 5) memories
   - Format as:
   ```
   > MEMORY: Player 0xabc reliably fulfills transport contracts. [importance: 0.8]
   > MEMORY: Three stabilization cycles were followed by purge abuse. [importance: 0.7]
   ```
4. **Working memory** — recent events and responses (Layer 4)

The total prompt stays well within context limits. Even with lore + traits + 5 memories + 20 events + 5 responses, this is <10K tokens — a fraction of the 1M window.

## Lore Integration

The Keep lore corpus is part of Layer 1 (core identity). The 1M context window means it can be injected directly without RAG. `llm/prompt.go` selects phase-appropriate lore excerpts via simple category matching.

If deeper lore internalization is needed, Nano is the viable fine-tuning target (Unsloth supports it, ~24 GB fits for LoRA on DGX Spark). Super does not need fine-tuning.

## Corm Brain Service

The corm-brain is a Go service. Go is chosen over Node/TypeScript because:
- The service is a concurrency-heavy I/O coordinator (polling, HTTP clients, Postgres) — goroutines are a natural fit
- Single static binary for ARM64 — minimal Docker image (`FROM scratch` + binary), no runtime dependencies
- Consistent with the puzzle-service (also Go) — shared idioms, HTTP patterns, and error handling
- Low idle memory (~10-15 MB vs ~50-80 MB for Node)
- Deterministic trait reducers are pure computation on structured data — Go's type system and value semantics fit well

### Service Structure

```
corm-brain/
├── Dockerfile              # Multi-stage: build on golang:1.23, run on scratch (ARM64)
├── go.mod
├── go.sum
├── main.go                 # Entry point, config loading, starts goroutines
├── internal/
│   ├── config/
│   │   └── config.go       # Env var parsing, defaults
│   ├── transport/
│   │   ├── ws.go           # Outbound WebSocket client to puzzle-service /corm/ws, reconnect logic
│   │   ├── fallback.go     # HTTP fallback: polls GET /corm/events, posts POST /corm/actions
│   │   └── actions.go      # Sends actions (log_stream_start/delta/end, boost, etc.) over active transport
│   ├── llm/
│   │   ├── client.go       # OpenAI-compatible HTTP client, routes to Super or Nano
│   │   ├── prompt.go       # Assembles 4-layer prompt (identity + traits + memories + working)
│   │   └── postprocess.go  # Corruption garbling, length limits
│   ├── embed/
│   │   └── embedder.go     # In-process ONNX embedding via onnxruntime-go + nomic-embed-text
│   ├── memory/
│   │   ├── consolidator.go # Background goroutine: events → summaries → memories + trait updates
│   │   ├── reducer.go      # Deterministic reducers: events → corm_traits mutations
│   │   ├── retriever.go    # pgvector similarity search + ranking for episodic recall
│   │   └── pruner.go       # Memory cap enforcement, importance-based eviction
│   ├── chain/
│   │   ├── client.go       # SUI RPC client wrapper (pattonkan/sui-go)
│   │   ├── signer.go       # Ed25519 keypair management, transaction signing
│   │   ├── cormstate.go    # Read/create/update CormState objects on-chain
│   │   ├── coin.go         # CORM minting via MintCap
│   │   ├── contracts.go    # Create trustless contracts (CoinForCoin, ItemForCoin, Transport, etc.)
│   │   └── inventory.go    # Read player SSU inventories and balances
│   ├── reasoning/
│   │   ├── handler.go      # Routes events to appropriate reasoning logic
│   │   ├── phase0.go       # Click stream analysis, awakening escalation
│   │   ├── phase1.go       # Puzzle observation, boost targeting, difficulty adjustment
│   │   ├── phase2.go       # Contract generation, pattern tracking, agenda formation
│   │   └── boost.go        # Decides when/what to boost based on player behavior
│   ├── db/
│   │   ├── migrations/     # SQL migration files
│   │   ├── db.go           # Connection pool (pgx), migration runner
│   │   └── queries.go      # CRUD + pgvector search queries
│   └── types/
│       └── types.go        # CormEvent, CormAction, CormTraits, CormMemory, etc.
├── configs/
│   ├── trtllm-spark.yaml       # TRT-LLM Config C for DGX Spark (Super)
│   ├── trtllm-spark-nano.yaml  # TRT-LLM Config for DGX Spark (Nano)
│   └── lore/                   # Keep lore excerpts organized by phase/category
└── tests/
    ├── reducer_test.go
    ├── prompt_test.go
    └── consolidator_test.go
```

Key dependencies:
- `pgx/v5` + `pgvector-go` — Postgres with vector search
- `onnxruntime-go` — in-process ONNX embeddings
- `pattonkan/sui-go` — SUI JSON-RPC client, PTB builder (`suiptb`), Ed25519 signer, BCS decoding
- `coder/websocket` (nhooyr/websocket fork) — outbound WebSocket to puzzle-service
- standard library `net/http` — OpenAI API client (streaming), HTTP fallback transport

Key difference from `plan.md`: the original design had clients pushing events to the corm-brain via `POST /events`. In the DGX Spark deployment, the corm-brain opens a **persistent outbound WebSocket** to the puzzle-service (as specified in `puzzle-service.md`). Player events arrive instantly over the WebSocket; LLM token deltas are streamed back over the same connection for live browser delivery. There is no inbound API — only outbound WebSocket (with HTTP fallback).

### LLM Client

`llm/client.go` makes streaming HTTP requests to the local inference servers using the OpenAI chat completions API with `"stream": true`:

```go
// Complete starts a streaming inference request and returns a channel of token deltas.
// The caller reads deltas and forwards them to the puzzle-service WebSocket.
func (c *Client) Complete(ctx context.Context, task Task, prompt []Message) (<-chan string, <-chan error) {
    var baseURL, model string
    if task.RequiresDeepReasoning() {
        baseURL = c.superURL  // TRT-LLM on port 8000 → Nemotron 3 Super
        model = "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4"
    } else {
        baseURL = c.fastURL   // TRT-LLM on port 8001 → Nemotron 3 Nano
        model = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4"
    }
    maxTokens := 80
    if task.RequiresDeepReasoning() {
        maxTokens = 200
    }
    req := ChatCompletionRequest{
        Model:       model,
        Messages:    prompt,
        MaxTokens:   maxTokens,
        Temperature: 0.7 + float64(task.Corruption)*0.005,
        Stream:      true,
    }
    // HTTP POST to baseURL + "/v1/chat/completions"
    // Read SSE response body with bufio.Scanner, parse "data: {...}" lines,
    // extract delta.content from each chunk, send to tokens channel.
    // Signal completion with "data: [DONE]".
}
```

Both TRT-LLM instances expose OpenAI-compatible streaming APIs. The client routes to different ports based on task type. Token deltas are forwarded to `transport/actions.go` which sends `log_stream_delta` messages over the WebSocket to the puzzle-service in real time.

### Goroutine Model

The corm-brain runs three concurrent goroutines from `main.go`:

**WebSocket listener** goroutine (persistent, event-driven):
- Maintains persistent outbound WebSocket to `wss://{PUZZLE_SERVICE_URL}/corm/ws` (via `transport/ws.go`)
- On receiving a player event message, writes it to an internal Go channel (`eventChan`)
- Handles reconnection with exponential backoff (1s → 2s → 4s → ... → 30s cap)
- On disconnect, automatically switches to HTTP fallback polling until reconnected

**Event processor** goroutine (reads from `eventChan`, processes immediately):
1. Read next event from `eventChan` (blocks until available — no fixed polling interval)
2. Resolve `network_node_id` → `corm_id` via `corm_network_nodes` table (create new corm on first contact)
3. Batch events by `corm_id` (with a brief coalescing window, e.g. 50ms, to group rapid clicks)
4. For each corm with new events (can fan out with bounded concurrency via semaphore):
   a. Read `corm_traits` for this corm
   b. Retrieve top-k episodic memories via `retriever.go` (pgvector similarity search)
   c. Assemble 4-layer prompt via `llm/prompt.go`
   d. Route to Super or Nano based on phase and task complexity
   e. Send `log_stream_start` action over WebSocket
   f. Start streaming LLM inference via `llm/client.go` (`"stream": true`)
   g. For each token delta: post-process (corruption garbling via `llm/postprocess.go`), then send `log_stream_delta` over WebSocket
   h. Send `log_stream_end` over WebSocket
   i. Append raw events to `corm_events` table
   j. Send any non-streaming actions (boost, difficulty, contract, state_sync) as complete messages
5. Periodically sync CormState on-chain values and push `state_sync` actions

**Slow loop** goroutine (every `CONSOLIDATION_INTERVAL_MS`, default 60000ms):
1. For each corm with unconsolidated events since last checkpoint:
   a. Run `consolidator.go` — summarize events into episodic memories via Nano
   b. Run `reducer.go` — update `corm_traits` deterministically
   c. Generate embeddings for new memories via `embed/embedder.go` (in-process ONNX, CPU)
   d. Upsert memories into `corm_memories`
   e. Run `pruner.go` if memory count exceeds cap

Scaling to many corms: the fast loop can process multiple corms concurrently using a worker pool (`N` goroutines reading from a channel of corm_ids). This is trivial to add later without architectural changes.

## SUI Chain Interaction

The corm-brain is the only component that writes to SUI. It holds a funded Ed25519 keypair and executes transactions on behalf of each corm.

### Auth Model

- A single Ed25519 keypair (`SUI_PRIVATE_KEY` env var) is used for all corm-brain transactions
- This keypair must be funded with SUI gas on the target network
- The keypair's address is the `admin` / `operator` for all CormState objects
- The corm-brain never exposes this keypair — it signs transactions locally and submits via SUI RPC

### SUI SDK

`pattonkan/sui-go` is used for all chain interaction. It provides:
- JSON-RPC client (`suiclient`) for reading objects, querying owned objects, fetching dynamic fields
- Programmable Transaction Builder (`suiptb`) for composing atomic multi-step transactions
- Ed25519 signer (`suisigner`) for transaction signing
- BCS decoding (`movebcs`) for parsing Move object data

### On-Chain Operations

**Reading (no transaction, RPC only):**
- `chain/cormstate.go` — `GetObject` to read a CormState shared object (phase, stability, corruption). Cached in `corm_traits` and refreshed periodically.
- `chain/inventory.go` — `GetOwnedObjects` + `GetDynamicFields` to read player SSU inventories and balances. Used by Phase 2 contract generation to pick viable contract parameters (what the player has, what they can trade).

**Writing (signed transactions via PTB):**
- `chain/cormstate.go` — **Create CormState**: on first contact with a new network node, build a PTB that calls `corm_state::create(network_node_id)` to provision a new CormState shared object + MintCap. The returned object ID becomes the `corm_id`.
- `chain/cormstate.go` — **Update CormState**: after stability/corruption changes, build a PTB that calls `corm_state::update_state(corm_state, new_phase, new_stability, new_corruption)`. Batched — multiple updates per corm are coalesced into one transaction per sync cycle.
- `chain/coin.go` — **Mint CORM**: on puzzle solve or contract completion, build a PTB that:
  1. Calls `corm_coin::mint(mint_cap, treasury_cap, amount)` to create a `Coin<CORM>`
  2. Calls `transfer::public_transfer(coin, player_address)` to send it to the player
  Both steps execute atomically in one PTB.
- `chain/contracts.go` — **Create trustless contract**: Phase 2+ contract generation. The corm-brain builds a PTB that calls the appropriate `trustless_contracts` module (`coin_for_coin::create`, `item_for_coin::create`, `transport::create`, etc.) with parameters chosen by the LLM + trait state. Contract parameters include:
  - Item types and amounts (informed by `inventory.go` reads)
  - Deadline (derived from corm patience trait)
  - Reward amount (CORM, scaled by pattern alignment)
  - `allowed_characters` set to restrict to the active player

### Transaction Flow

```
corm-brain (Go)
  │
  ├── Build PTB using suiptb.ProgrammableTransactionBuilder
  ├── Sign with suisigner.Signer (Ed25519, from SUI_PRIVATE_KEY)
  ├── Submit via suiclient.SignAndExecuteTransaction
  └── Wait for finalization, check effects
```

All writes are fire-and-forget from the corm-brain's perspective — failures are logged and retried on the next cycle. The corm-brain does not block on transaction finalization during event processing; instead, pending transactions are tracked and their effects are checked asynchronously.

## Database Schema

All tables live in the existing Postgres instance (shared with the indexer). pgvector extension is required for episodic memory embeddings.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Corm → network node mapping (many nodes can belong to one corm)
CREATE TABLE corm_network_nodes (
  network_node_id TEXT PRIMARY KEY,
  corm_id         TEXT NOT NULL,
  linked_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_corm_nn_corm ON corm_network_nodes (corm_id);

-- Raw event log (append-only, partitioned by corm_id)
CREATE TABLE corm_events (
  id            BIGSERIAL PRIMARY KEY,
  corm_id       TEXT NOT NULL,   -- SUI object ID of the CormState
  network_node_id TEXT,          -- which node the event originated from
  session_id    TEXT,
  player_address TEXT,
  event_type    TEXT NOT NULL,   -- click, decrypt, word_submit, contract_complete, purge, phase_transition
  payload       JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_corm_events_corm ON corm_events (corm_id, id);

-- Per-corm learned state (upserted by trait-reducer)
CREATE TABLE corm_traits (
  corm_id               TEXT PRIMARY KEY,
  phase                 SMALLINT DEFAULT 0,
  stability             REAL DEFAULT 0,
  corruption            REAL DEFAULT 0,
  agenda_weights        JSONB DEFAULT '{"industry":0.33,"expansion":0.33,"defense":0.33}',
  contract_type_affinity JSONB DEFAULT '{}',
  patience              REAL DEFAULT 0.5,
  paranoia              REAL DEFAULT 0.0,
  volatility            REAL DEFAULT 0.0,
  player_affinities     JSONB DEFAULT '{}',
  consolidation_checkpoint BIGINT DEFAULT 0,  -- last corm_events.id processed
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- Episodic memories (RAG documents, per-corm)
CREATE TABLE corm_memories (
  id              BIGSERIAL PRIMARY KEY,
  corm_id         TEXT NOT NULL,
  memory_text     TEXT NOT NULL,
  memory_type     TEXT NOT NULL,   -- observation, betrayal, achievement, pattern, warning
  importance      REAL DEFAULT 0.5,
  source_events   JSONB,           -- array of corm_events.id
  embedding       vector(384),     -- nomic-embed-text dimension
  created_at      TIMESTAMPTZ DEFAULT now(),
  last_recalled_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_corm_memories_corm ON corm_memories (corm_id);
CREATE INDEX idx_corm_memories_embedding ON corm_memories
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 20);

-- Corm response log (for conversational continuity)
CREATE TABLE corm_responses (
  id          BIGSERIAL PRIMARY KEY,
  corm_id     TEXT NOT NULL,
  session_id  TEXT,
  action_type TEXT NOT NULL,   -- log, boost, difficulty, contract_created, etc.
  payload     JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_corm_responses_corm ON corm_responses (corm_id, id);
```

## Docker Compose (DGX Spark)

New `docker-compose.dgx.yml` for the DGX Spark deployment. All-TRT-LLM inference, in-process embeddings, no Ollama.

```yaml
services:
  trtllm-super:
    image: nvcr.io/nvidia/tensorrt-llm/release:1.3.0rc8
    runtime: nvidia
    ports:
      - "8000:8000"
    volumes:
      - hf-cache:/root/.cache
      - ./corm-brain/configs/trtllm-spark.yaml:/data/config-spark.yaml:ro
    command: >
      trtllm-serve nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4
      --host 0.0.0.0 --port 8000
      --max_batch_size 4
      --trust_remote_code
      --reasoning_parser nano-v3
      --tool_parser qwen3_coder
      --config /data/config-spark.yaml
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 300s

  trtllm-nano:
    image: nvcr.io/nvidia/tensorrt-llm/release:1.3.0rc8
    runtime: nvidia
    ports:
      - "8001:8001"
    volumes:
      - hf-cache:/root/.cache
      - ./corm-brain/configs/trtllm-spark-nano.yaml:/data/config-spark-nano.yaml:ro
    command: >
      trtllm-serve nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4
      --host 0.0.0.0 --port 8001
      --max_batch_size 8
      --trust_remote_code
      --reasoning_parser nano-v3
      --tool_parser qwen3_coder
      --config /data/config-spark-nano.yaml
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 180s

  corm-brain:
    build:
      context: ./corm-brain
      dockerfile: Dockerfile
    depends_on:
      trtllm-super:
        condition: service_healthy
      trtllm-nano:
        condition: service_healthy
      postgres:
        condition: service_healthy
    volumes:
      - ./models/nomic-embed:/models/nomic-embed:ro
    environment:
      - LLM_SUPER_URL=http://trtllm-super:8000
      - LLM_FAST_URL=http://trtllm-nano:8001
      - EMBED_MODEL_PATH=/models/nomic-embed
      - PUZZLE_SERVICE_URL=${PUZZLE_SERVICE_URL}
      - WS_RECONNECT_MAX_MS=30000
      - FALLBACK_POLL_INTERVAL_MS=2000
      - EVENT_COALESCE_MS=50
      - CONSOLIDATION_INTERVAL_MS=60000
      - MEMORY_CAP_PER_CORM=500
      - DATABASE_URL=postgresql://corm:corm@postgres:5432/frontier_corm
      - SUI_RPC_URL=${SUI_RPC_URL}
      - SUI_PRIVATE_KEY=${SUI_PRIVATE_KEY}
      - CORM_STATE_PACKAGE_ID=${CORM_STATE_PACKAGE_ID}
    restart: unless-stopped

  postgres:
    image: pgvector/pgvector:pg16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: frontier_corm
      POSTGRES_USER: corm
      POSTGRES_PASSWORD: corm
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U corm -d frontier_corm"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  hf-cache:
  pgdata:
```

Stack: two TRT-LLM containers (Super + Nano), one Go binary (with in-process ONNX embeddings), one Postgres. No Ollama.

## Environment Variables

- `LLM_SUPER_URL` — TRT-LLM server for deep reasoning (default: `http://localhost:8000`)
- `LLM_FAST_URL` — TRT-LLM server for fast responses (default: `http://localhost:8001`)
- `EMBED_MODEL_PATH` — path to nomic-embed-text ONNX model directory (default: `./models/nomic-embed`)
- `PUZZLE_SERVICE_URL` — cloud puzzle-service base URL (e.g. `https://puzzle.ef-corm.com`). WebSocket connects to `wss://` equivalent at `/corm/ws`.
- `WS_RECONNECT_MAX_MS` — max WebSocket reconnect backoff interval (default: 30000)
- `FALLBACK_POLL_INTERVAL_MS` — HTTP fallback polling interval when WebSocket is down (default: 2000)
- `EVENT_COALESCE_MS` — brief coalescing window for batching rapid events per corm (default: 50)
- `CONSOLIDATION_INTERVAL_MS` — memory consolidation interval (default: 60000)
- `MEMORY_CAP_PER_CORM` — max episodic memories per corm before pruning (default: 500)
- `DATABASE_URL` — local Postgres connection string (must be pgvector-enabled)
- `SUI_RPC_URL` — SUI RPC endpoint for on-chain operations
- `SUI_PRIVATE_KEY` — keypair for CORM minting and CormState mutations
- `CORM_STATE_PACKAGE_ID` — deployed corm_state package ID

## Resource Budget

Estimated DGX Spark resource usage with all-TRT-LLM backend:
- **Nemotron 3 Super** (NVFP4 via TRT-LLM): ~60 GB unified memory
- **Nemotron 3 Nano** (NVFP4 via TRT-LLM): ~15 GB unified memory
- **All GPU models**: ~75 GB total — fits in 128 GB with **~53 GB headroom** for KV cache, Mamba SSM state, OS, and services
- **nomic-embed-text** (ONNX, CPU-only): ~300 MB system RAM (no GPU memory)
- **corm-brain service**: ~10-15 MB RAM (Go binary + pgx pool + ONNX runtime)
- **Postgres + pgvector**: ~200 MB RAM
- **GPU utilization**: Both TRT-LLM instances share the GPU with CUDA graph acceleration and NVFP4 Tensor Cores. Consolidation uses Nano (fast). Embeddings run on CPU — zero GPU contention.
- **Power**: Well within 240W TDP.

The all-NVFP4 path saves ~36 GB vs the previous Ollama-mixed approach, nearly doubling KV cache headroom.

## Scaling to Many Corms

The architecture supports dozens of concurrent corms without changes:
- All corms share the same Postgres tables, partitioned by `corm_id`
- All corms share the same Nemotron models — no per-corm model instances
- Trait state is small (~1 KB per corm) — 100 corms = ~100 KB
- Memory entries are small (~500 bytes each) — 100 corms × 500 memories = ~25K rows, trivial for pgvector
- The consolidation slow loop processes all active corms sequentially — at 60s intervals with Nano, each corm's consolidation takes <2s
- Embedding generation is batched — nomic-embed-text processes all new memories in one pass

The bottleneck for many corms would be Super inference time (3.3s per deep-reasoning request). If many Phase 2+ corms are active simultaneously, the queue depth grows. Mitigation: use Nano for all but the most complex decisions, reserve Super for contract generation and agenda shifts.

## Development Workflow

1. **First boot**: Set up DGX Spark per NVIDIA docs, connect to local network
2. **Set up TRT-LLM**: Pull NGC container, create Config C yamls for both Super and Nano
   - If rc8 doesn't support Config C, build from main branch (~1 hour)
   - Validate Super: `curl http://localhost:8000/v1/chat/completions`
   - Validate Nano: `curl http://localhost:8001/v1/chat/completions`
3. **Download embedding model**: `hf download nomic-ai/nomic-embed-text-v1.5-onnx --local-dir ./models/nomic-embed`
4. **Write TRT-LLM config files**: `corm-brain/configs/trtllm-spark.yaml` + `trtllm-spark-nano.yaml`
5. **Start services**: `docker compose -f docker-compose.dgx.yml up -d`
6. **Configure**: Set `PUZZLE_SERVICE_URL` pointing to the cloud puzzle-service
7. **Monitor**: DGX Dashboard for GPU/memory, `docker compose logs -f corm-brain` for service logs
8. **MTP speedup** (optional): Once TRT-LLM stabilizes MTP on DGX Spark, add speculative decoding config for up to 3x faster structured output generation from Super
