# Event Indexer — Phase 4: Verifiable History

Off-chain TypeScript service that subscribes to Sui on-chain events from all Frontier Corm modules and archives them with checkpoint inclusion proofs for long-term verifiability.

## Architecture

```
Sui Checkpoints → Checkpoint Subscriber → Event Archiver → Postgres
                                                               ↓
                                               Express API ← Query Layer
```

**Subscriber** polls Sui RPC for events from the tribe and trustless_contracts packages. Each event is enriched with checkpoint metadata (sequence, digest, timestamp).

**Archiver** stores events with denormalised fields (tribe_id, character_id, primary_id) and updates materialised views (reputation snapshots).

**API** serves historical queries, reputation audit trails, and checkpoint inclusion proofs.

## Tracked Events (20 total)

**Tribe (8):** TribeCreatedEvent, MemberJoinedEvent, MemberRemovedEvent, ReputationUpdatedEvent, TreasuryDepositEvent, TreasuryProposalCreatedEvent, TreasuryProposalVotedEvent, TreasurySpendEvent

**Trustless Contracts (7):** CoinForCoinCreatedEvent, CoinForItemCreatedEvent, ItemForCoinCreatedEvent, ItemForItemCreatedEvent, TransportCreatedEvent, ContractFilledEvent, ContractCompletedEvent, ContractCancelledEvent, ContractExpiredEvent, TransportAcceptedEvent, TransportDeliveredEvent

**Multi-Input (5):** MultiInputContractCreatedEvent, SlotFilledEvent, MultiInputContractCompletedEvent, MultiInputContractCancelledEvent, MultiInputContractExpiredEvent

## Quick Start

```bash
npm install
npm run dev
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUI_RPC_URL` | `http://127.0.0.1:9000` | Sui RPC endpoint |
| `PACKAGE_TRIBE` | — | Deployed tribe package ID |
| `PACKAGE_TRUSTLESS_CONTRACTS` | — | Deployed trustless_contracts package ID |
| `DATABASE_URL` | `postgresql://corm:corm@localhost:5432/frontier_corm` | Postgres connection string |
| `API_PORT` | `3100` | API server port |
| `POLL_INTERVAL_MS` | `2000` | Event poll interval (ms) |

## API Endpoints

All routes under `/api/v1`. Pagination via `?limit=50&offset=0&order=desc`.

- `GET /health` — Health check
- `GET /stats` — Indexer statistics
- `GET /events` — All events (optional `?type=JobCompletedEvent`)
- `GET /events/tribe/:tribeId` — Events for a tribe
- `GET /events/character/:characterId` — Events involving a character
- `GET /events/object/:objectId` — Events for a specific object (job, order, etc.)
- `GET /reputation/:tribeId/:characterId` — Current rep + audit trail with proofs
- `GET /reputation/:tribeId/leaderboard` — Top members by reputation
- `GET /proof/:eventId` — Checkpoint inclusion proof for a single event
- `GET /event-types` — List of all tracked event types

## Checkpoint Proof Verification

Each archived event includes:
- `tx_digest` — the transaction that emitted the event
- `event_seq` — event sequence within the transaction
- `checkpoint_seq` — checkpoint sequence number
- `checkpoint_digest` — validator-signed checkpoint summary

To verify independently:
1. Confirm `checkpoint_digest` is signed by ≥2/3 validators for the epoch
2. Confirm `tx_digest` is included in the checkpoint's transaction list
3. Confirm event data matches the event emitted by `tx_digest` at `event_seq`

## Database

Postgres. Tables:
- `events` — All archived events with checkpoint proof metadata
- `event_type_cursors` — Per-event-type resumable polling cursors
- `cleanup_jobs` — Contract cleanup job queue and storage rebate tracking
- `metadata_snapshots` — Materialised latest assembly metadata state
- `indexer_cursor` — Legacy single-cursor table (kept for backward compat)

Run standalone migration: `npm run migrate`
