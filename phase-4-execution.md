# Phase 4 Execution Notes — Event Indexer + Verifiable History

**Dates**: March 11, 2026 (Days 17–18 of hackathon)
**Status**: Complete — TypeScript compiles clean, all modules implemented

---

## What was built

`indexer/` — an off-chain TypeScript service that subscribes to Sui on-chain events from all three Frontier Lattice contracts and archives them with checkpoint inclusion proofs.

### Components

| Component | Path | Purpose |
|-----------|------|---------|
| Types | `src/types.ts` | 19 event interfaces mirroring Move structs + ArchivedEvent wrapper |
| Schema | `src/db/schema.ts` | SQLite schema: events, reputation_snapshots, indexer_cursor |
| Queries | `src/db/queries.ts` | Prepared queries: insert, upsert reputation, cursor, all query patterns |
| Subscriber | `src/subscriber/checkpoint-subscriber.ts` | Polls Sui RPC for events, enriches with checkpoint metadata |
| Archiver | `src/archiver/event-archiver.ts` | Stores events with denormalised fields, updates materialised views |
| Routes | `src/api/routes.ts` | 12 REST endpoints for event history, reputation, proofs |
| Server | `src/api/server.ts` | Express server with CORS |
| Entry | `src/index.ts` | Wires DB + subscriber + API, graceful shutdown |

### Event Coverage (19 events across 3 modules)

**Tribe (8):** TribeCreatedEvent, MemberJoinedEvent, MemberRemovedEvent, ReputationUpdatedEvent, TreasuryDepositEvent, TreasuryProposalCreatedEvent, TreasuryProposalVotedEvent, TreasurySpendEvent

**Contract Board (5):** JobCreatedEvent, JobAcceptedEvent, JobCompletedEvent, JobExpiredEvent, JobCancelledEvent

**Forge Planner (6):** RecipeRegistryCreatedEvent, RecipeAddedEvent, RecipeRemovedEvent, OrderCreatedEvent, OrderFulfilledEvent, OrderCancelledEvent

### API Endpoints (12 routes under /api/v1)

- Health + stats
- Event queries: all, by type, by tribe, by character, by object
- Reputation: snapshot + audit trail, leaderboard
- Domain-specific: jobs feed, manufacturing feed
- Proof verification: checkpoint inclusion proof per event
- Metadata: event type listing

---

## Key technical decisions

### 1. Polling via `queryEvents` instead of WebSocket subscription

**Problem**: Sui WebSocket subscriptions (`subscribeEvent`) are stateless and
don't persist across reconnections. If the indexer restarts or the connection
drops, events emitted during the gap are lost.

**Decision**: Use `queryEvents` with cursor-based pagination. The indexer
stores a cursor (last tx_digest + event_seq) in SQLite and resumes from
that point on restart.

**Benefit**: Zero event loss across restarts. Simpler error handling.
The trade-off is polling latency (configurable, default 2s) vs. real-time
WebSocket push, which is acceptable for a historical archive.

### 2. SQLite instead of Postgres (hackathon scope)

**Problem**: The plan mentions Postgres. For hackathon scope, Postgres adds
deployment complexity (requires a running Postgres instance).

**Decision**: Use SQLite via `better-sqlite3` with WAL mode. The database
file is self-contained and requires zero setup. Schema supports the full
query API including compound indexes for tribe-scoped queries.

**Benefit**: `npm install && npm run dev` — no database server required.
The schema is identical to what a Postgres migration would look like;
upgrading to Postgres later is straightforward.

### 3. Denormalised query fields on every event row

**Problem**: Events from different modules have different field names for
the same concepts (e.g. `tribe_id` vs `poster_tribe_id`, `character_id` vs
`assignee_id` vs `creator_id`). Querying across event types requires
parsing the JSON blob.

**Decision**: Extract three denormalised fields at archive time:
- `primary_id` — the main object (tribe_id, job_id, order_id, registry_id)
- `tribe_id` — always present, enables tribe-scoped queries
- `character_id` — the actor in the event (nullable)

These are stored as indexed columns alongside the full JSON blob.

**Benefit**: All query patterns (by tribe, by character, by object) use
simple indexed lookups. The JSON blob is preserved for full-fidelity
event data without needing to parse it for common queries.

### 4. Materialised reputation snapshots

**Problem**: Getting "current reputation" requires scanning all
ReputationUpdatedEvent entries for a tribe×character pair and taking
the latest one.

**Decision**: Maintain a `reputation_snapshots` table that is updated
(upserted) every time a ReputationUpdatedEvent is archived. The snapshot
stores the current score and a foreign key to the last event that changed it.

**Benefit**: O(1) "current reputation" lookups. The full audit trail
(all ReputationUpdatedEvents with checkpoint proofs) is still available
via the events table for dispute resolution.

### 5. Checkpoint inclusion proof chain stored per event

**Problem**: The plan describes archiving "checkpoint summary + hash path
from event → transaction effects → checkpoint content digest". Full Merkle
path extraction requires low-level checkpoint binary parsing that isn't
exposed by the Sui TypeScript SDK.

**Decision**: Store the proof chain as three fields per event:
- `tx_digest` — the transaction that emitted the event
- `checkpoint_seq` + `checkpoint_digest` — the validator-signed checkpoint

The `/proof/:eventId` endpoint returns these along with a verification
note explaining how a third party can independently verify.

**Benefit**: Sufficient for hackathon scope. A verifier can:
1. Confirm the checkpoint digest against the validator set
2. Query the checkpoint's transaction list to find the tx_digest
3. Query the transaction's events to find the event data

Full Merkle path inclusion proofs can be added later if the Sui SDK
exposes checkpoint content parsing.

### 6. Per-event-type polling with cursor sharing

**Problem**: Sui `queryEvents` requires a `MoveEventType` filter (fully
qualified `package::module::EventName`). We have 19 event types across
3 packages.

**Decision**: Build the filter list from configured package IDs at startup.
Each event type is polled independently. The cursor is shared across all
event types (last processed tx_digest + event_seq).

**Benefit**: Simple and reliable. Missing package IDs (not yet deployed)
are gracefully skipped. The cursor ensures no events are missed across
restarts.

---

## Files created

```
indexer/
  package.json                        (project config, dependencies)
  tsconfig.json                       (TypeScript config)
  README.md                           (full documentation, updated)
  src/
    types.ts                          (19 event interfaces + config)
    index.ts                          (entry point)
    db/
      schema.ts                       (SQLite schema + migration)
      queries.ts                      (prepared queries)
    subscriber/
      checkpoint-subscriber.ts        (Sui event polling + checkpoint enrichment)
    archiver/
      event-archiver.ts               (event storage + materialised views)
    api/
      server.ts                       (Express server)
      routes.ts                       (12 REST endpoints)
```

---

## Phase 5 integration notes

The indexer provides the historical query layer for the web app:

1. **Event history feeds** — the web app queries `/api/v1/events/tribe/:tribeId`
   to populate dashboards with tribe activity, job feeds, and manufacturing history
2. **Reputation audit** — `/api/v1/reputation/:tribeId/:characterId` returns
   the current score + full event trail with checkpoint proofs for dispute resolution
3. **Leaderboards** — `/api/v1/reputation/:tribeId/leaderboard` powers tribe
   member rankings
4. **Proof verification** — `/api/v1/proof/:eventId` enables independent
   verification of any archived event against the Sui validator set

The off-chain optimizer (Phase 5) can also use the indexer to read
manufacturing order history and job completion rates for smarter planning.
