/**
 * SQL queries for the Frontier Corm event indexer (Postgres).
 *
 * All queries are async and use the pg Pool for connection management.
 */

import type pg from "pg";
import type { ArchivedEvent, EventTypeName } from "../types.js";

// ============================================================
// Insert
// ============================================================

const INSERT_EVENT_SQL = `
  INSERT INTO events (
    event_type, event_name, module, event_data,
    tx_digest, event_seq, checkpoint_seq, checkpoint_digest, timestamp_ms,
    primary_id, tribe_id, character_id
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
  )
  ON CONFLICT (tx_digest, event_seq) DO NOTHING
  RETURNING id
`;

function eventParams(event: ArchivedEvent) {
  return [
    event.event_type, event.event_name, event.module, event.event_data,
    event.tx_digest, event.event_seq, event.checkpoint_seq,
    event.checkpoint_digest, event.timestamp_ms,
    event.primary_id, event.tribe_id, event.character_id,
  ];
}

export async function insertEvent(pool: pg.Pool, event: ArchivedEvent): Promise<number> {
  const result = await pool.query(INSERT_EVENT_SQL, eventParams(event));
  return result.rows[0]?.id ?? 0;
}

export async function insertEventsBatch(pool: pg.Pool, events: ArchivedEvent[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const event of events) {
      await client.query(INSERT_EVENT_SQL, eventParams(event));
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// Cursor
// ============================================================

// ---- Per-event-type cursors ----

const UPSERT_EVENT_TYPE_CURSOR_SQL = `
  INSERT INTO event_type_cursors (event_type, last_tx_digest, last_event_seq, last_timestamp, updated_at)
  VALUES ($1, $2, $3, $4, NOW())
  ON CONFLICT (event_type) DO UPDATE SET
    last_tx_digest = $2,
    last_event_seq = $3,
    last_timestamp = $4,
    updated_at = NOW()
`;

const GET_EVENT_TYPE_CURSOR_SQL = `
  SELECT event_type, last_tx_digest, last_event_seq, last_timestamp
  FROM event_type_cursors WHERE event_type = $1
`;

const GET_ALL_EVENT_TYPE_CURSORS_SQL = `
  SELECT event_type, last_tx_digest, last_event_seq, last_timestamp
  FROM event_type_cursors
`;

export interface EventTypeCursor {
  event_type: string;
  last_tx_digest: string | null;
  last_event_seq: number | null;
  last_timestamp: string | null;
}

export async function updateEventTypeCursor(
  pool: pg.Pool,
  eventType: string,
  txDigest: string,
  eventSeq: number,
  timestampMs: string,
): Promise<void> {
  await pool.query(UPSERT_EVENT_TYPE_CURSOR_SQL, [eventType, txDigest, eventSeq, timestampMs]);
}

export async function getEventTypeCursor(
  pool: pg.Pool,
  eventType: string,
): Promise<EventTypeCursor | null> {
  const result = await pool.query(GET_EVENT_TYPE_CURSOR_SQL, [eventType]);
  return (result.rows[0] as EventTypeCursor) ?? null;
}

export async function getAllEventTypeCursors(
  pool: pg.Pool,
): Promise<Map<string, EventTypeCursor>> {
  const result = await pool.query(GET_ALL_EVENT_TYPE_CURSORS_SQL);
  const map = new Map<string, EventTypeCursor>();
  for (const row of result.rows as EventTypeCursor[]) {
    map.set(row.event_type, row);
  }
  return map;
}

/** Delete all per-event-type cursors (forces full re-index on next start). */
export async function resetAllEventTypeCursors(pool: pg.Pool): Promise<void> {
  await pool.query("DELETE FROM event_type_cursors");
}

// ---- Legacy single cursor (kept for migration reference) ----

const UPDATE_CURSOR_SQL = `
  UPDATE indexer_cursor SET
    last_tx_digest = $1,
    last_event_seq = $2,
    last_checkpoint = $3,
    updated_at = NOW()
  WHERE id = 1
`;

const GET_CURSOR_SQL = `
  SELECT last_tx_digest, last_event_seq, last_checkpoint
  FROM indexer_cursor WHERE id = 1
`;

export interface IndexerCursor {
  last_tx_digest: string | null;
  last_event_seq: number | null;
  last_checkpoint: string | null;
}

export async function updateCursor(
  pool: pg.Pool,
  txDigest: string,
  eventSeq: number,
  checkpoint: string,
): Promise<void> {
  await pool.query(UPDATE_CURSOR_SQL, [txDigest, eventSeq, checkpoint]);
}

export async function getCursor(pool: pg.Pool): Promise<IndexerCursor> {
  const result = await pool.query(GET_CURSOR_SQL);
  return result.rows[0] as IndexerCursor;
}

// ============================================================
// Query: Events
// ============================================================

interface EventQueryParams {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}

function defaultParams(params?: EventQueryParams) {
  return {
    limit: params?.limit ?? 50,
    offset: params?.offset ?? 0,
    order: params?.order ?? "desc",
  };
}

export async function getEvents(
  pool: pg.Pool,
  params?: EventQueryParams,
): Promise<ArchivedEvent[]> {
  const { limit, offset, order } = defaultParams(params);
  const dir = order === "asc" ? "ASC" : "DESC";
  const result = await pool.query(
    `SELECT * FROM events ORDER BY id ${dir} LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows as ArchivedEvent[];
}

export async function getEventsByType(
  pool: pg.Pool,
  eventName: EventTypeName,
  params?: EventQueryParams,
): Promise<ArchivedEvent[]> {
  const { limit, offset, order } = defaultParams(params);
  const dir = order === "asc" ? "ASC" : "DESC";
  const result = await pool.query(
    `SELECT * FROM events WHERE event_name = $1 ORDER BY id ${dir} LIMIT $2 OFFSET $3`,
    [eventName, limit, offset],
  );
  return result.rows as ArchivedEvent[];
}

export async function getEventsByTribe(
  pool: pg.Pool,
  tribeId: string,
  params?: EventQueryParams & { eventName?: EventTypeName },
): Promise<ArchivedEvent[]> {
  const { limit, offset, order } = defaultParams(params);
  const dir = order === "asc" ? "ASC" : "DESC";
  if (params?.eventName) {
    const result = await pool.query(
      `SELECT * FROM events WHERE tribe_id = $1 AND event_name = $2
       ORDER BY id ${dir} LIMIT $3 OFFSET $4`,
      [tribeId, params.eventName, limit, offset],
    );
    return result.rows as ArchivedEvent[];
  }
  const result = await pool.query(
    `SELECT * FROM events WHERE tribe_id = $1 ORDER BY id ${dir} LIMIT $2 OFFSET $3`,
    [tribeId, limit, offset],
  );
  return result.rows as ArchivedEvent[];
}

export async function getEventsByCharacter(
  pool: pg.Pool,
  characterId: string,
  params?: EventQueryParams,
): Promise<ArchivedEvent[]> {
  const { limit, offset, order } = defaultParams(params);
  const dir = order === "asc" ? "ASC" : "DESC";
  const result = await pool.query(
    `SELECT * FROM events WHERE character_id = $1
     ORDER BY id ${dir} LIMIT $2 OFFSET $3`,
    [characterId, limit, offset],
  );
  return result.rows as ArchivedEvent[];
}

export async function getEventsByPrimaryId(
  pool: pg.Pool,
  primaryId: string,
  params?: EventQueryParams,
): Promise<ArchivedEvent[]> {
  const { limit, offset, order } = defaultParams(params);
  const dir = order === "asc" ? "ASC" : "DESC";
  const result = await pool.query(
    `SELECT * FROM events WHERE primary_id = $1
     ORDER BY id ${dir} LIMIT $2 OFFSET $3`,
    [primaryId, limit, offset],
  );
  return result.rows as ArchivedEvent[];
}

export async function getEventById(
  pool: pg.Pool,
  id: number,
): Promise<ArchivedEvent | undefined> {
  const result = await pool.query("SELECT * FROM events WHERE id = $1", [id]);
  return result.rows[0] as ArchivedEvent | undefined;
}

// ============================================================
// Cleanup Jobs
// ============================================================

export interface CleanupJob {
  id: number;
  contract_id: string;
  contract_module: string;
  contract_type: string | null;
  poster_id: string | null;
  source_ssu_id: string | null;
  completed_at: string | null;
  status: string;
  cleanup_tx_digest: string | null;
  storage_rebate_mist: string | null;
  computation_cost_mist: string | null;
  storage_cost_mist: string | null;
  net_rebate_mist: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

const INSERT_CLEANUP_JOB_SQL = `
  INSERT INTO cleanup_jobs (
    contract_id, contract_module, contract_type, poster_id, source_ssu_id, completed_at
  ) VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (contract_id) DO NOTHING
  RETURNING id
`;

export async function insertCleanupJob(
  pool: pg.Pool,
  contractId: string,
  contractModule: string,
  contractType: string | null,
  posterId: string | null,
  sourceSsuId: string | null,
  completedAt: string | null,
): Promise<number> {
  const result = await pool.query(INSERT_CLEANUP_JOB_SQL, [
    contractId, contractModule, contractType, posterId, sourceSsuId, completedAt,
  ]);
  return result.rows[0]?.id ?? 0;
}

const GET_PENDING_CLEANUP_JOBS_SQL = `
  SELECT * FROM cleanup_jobs
  WHERE status = 'pending'
    AND completed_at < NOW() - ($1 || ' milliseconds')::interval
  ORDER BY completed_at ASC
  LIMIT $2
`;

export async function getPendingCleanupJobs(
  pool: pg.Pool,
  delayMs: number,
  limit: number = 10,
): Promise<CleanupJob[]> {
  const result = await pool.query(GET_PENDING_CLEANUP_JOBS_SQL, [String(delayMs), limit]);
  return result.rows as CleanupJob[];
}

const UPDATE_CLEANUP_JOB_CONFIRMED_SQL = `
  UPDATE cleanup_jobs SET
    status = 'confirmed',
    cleanup_tx_digest = $2,
    storage_rebate_mist = $3,
    computation_cost_mist = $4,
    storage_cost_mist = $5,
    net_rebate_mist = $6,
    updated_at = NOW()
  WHERE id = $1
`;

export async function markCleanupConfirmed(
  pool: pg.Pool,
  jobId: number,
  txDigest: string,
  storageRebate: bigint,
  computationCost: bigint,
  storageCost: bigint,
): Promise<void> {
  const net = storageRebate - computationCost - storageCost;
  await pool.query(UPDATE_CLEANUP_JOB_CONFIRMED_SQL, [
    jobId, txDigest,
    storageRebate.toString(), computationCost.toString(),
    storageCost.toString(), net.toString(),
  ]);
}

const UPDATE_CLEANUP_JOB_FAILED_SQL = `
  UPDATE cleanup_jobs SET
    status = CASE WHEN retry_count + 1 >= $3 THEN 'failed' ELSE 'pending' END,
    retry_count = retry_count + 1,
    error_message = $2,
    updated_at = NOW()
  WHERE id = $1
`;

export async function markCleanupFailed(
  pool: pg.Pool,
  jobId: number,
  errorMessage: string,
  maxRetries: number,
): Promise<void> {
  await pool.query(UPDATE_CLEANUP_JOB_FAILED_SQL, [jobId, errorMessage, maxRetries]);
}

const UPDATE_CLEANUP_JOB_NOT_FOUND_SQL = `
  UPDATE cleanup_jobs SET
    status = 'not_found',
    updated_at = NOW()
  WHERE id = $1
`;

export async function markCleanupNotFound(
  pool: pg.Pool,
  jobId: number,
): Promise<void> {
  await pool.query(UPDATE_CLEANUP_JOB_NOT_FOUND_SQL, [jobId]);
}

/** Contract IDs that already have a cleanup_jobs row. */
const GET_EXISTING_CLEANUP_CONTRACT_IDS_SQL = `
  SELECT contract_id FROM cleanup_jobs
`;

export async function getExistingCleanupContractIds(
  pool: pg.Pool,
): Promise<Set<string>> {
  const result = await pool.query(GET_EXISTING_CLEANUP_CONTRACT_IDS_SQL);
  return new Set(result.rows.map((r: { contract_id: string }) => r.contract_id));
}

export interface CleanupStats {
  total_jobs: number;
  by_status: Record<string, number>;
  total_sui_reclaimed_mist: string;
  total_gas_spent_mist: string;
}

export async function getCleanupStats(pool: pg.Pool): Promise<CleanupStats> {
  const totalResult = await pool.query("SELECT COUNT(*) as count FROM cleanup_jobs");
  const total = Number(totalResult.rows[0].count);

  const byStatusResult = await pool.query(
    "SELECT status, COUNT(*) as count FROM cleanup_jobs GROUP BY status",
  );
  const byStatus = Object.fromEntries(
    byStatusResult.rows.map((r: { status: string; count: string }) => [r.status, Number(r.count)]),
  );

  const reclaimedResult = await pool.query(
    "SELECT COALESCE(SUM(net_rebate_mist), 0) as total FROM cleanup_jobs WHERE status = 'confirmed'",
  );
  const gasResult = await pool.query(
    "SELECT COALESCE(SUM(computation_cost_mist + storage_cost_mist), 0) as total FROM cleanup_jobs WHERE status = 'confirmed'",
  );

  return {
    total_jobs: total,
    by_status: byStatus,
    total_sui_reclaimed_mist: String(reclaimedResult.rows[0].total),
    total_gas_spent_mist: String(gasResult.rows[0].total),
  };
}

export async function getCleanupJobs(
  pool: pg.Pool,
  params?: EventQueryParams,
): Promise<CleanupJob[]> {
  const { limit, offset, order } = defaultParams(params);
  const dir = order === "asc" ? "ASC" : "DESC";
  const result = await pool.query(
    `SELECT * FROM cleanup_jobs ORDER BY id ${dir} LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows as CleanupJob[];
}

// ============================================================
// Query: Payout Events
// ============================================================

/**
 * Payout events for a character — fill events where the character is either
 * the filler (direct character_id match) or the poster (fill on a contract
 * they created). Supports watermark-based polling via `sinceId`.
 */
const GET_PAYOUT_EVENTS_SQL = `
  SELECT * FROM (
    -- A: Filler payouts (I filled, I got escrow/items/bounty)
    SELECT * FROM events
    WHERE character_id = $1
      AND event_name IN ('ContractFilledEvent','SlotFilledEvent','TransportDeliveredEvent')
      AND ($2::int IS NULL OR id > $2)
    UNION ALL
    -- B: Poster receipts (someone filled my contract, I got payment/items)
    SELECT e.* FROM events e
    WHERE e.event_name IN ('ContractFilledEvent','SlotFilledEvent','TransportDeliveredEvent')
      AND e.primary_id IN (
        SELECT primary_id FROM events
        WHERE character_id = $1
          AND event_name IN (
            'CoinForCoinCreatedEvent','CoinForItemCreatedEvent',
            'ItemForCoinCreatedEvent','ItemForItemCreatedEvent',
            'TransportCreatedEvent','MultiInputContractCreatedEvent')
      )
      AND e.character_id != $1
      AND ($2::int IS NULL OR e.id > $2)
  ) combined
  ORDER BY id ASC LIMIT $3
`;

export async function getPayoutEvents(
  pool: pg.Pool,
  characterId: string,
  sinceId: number | null = null,
  limit: number = 50,
): Promise<ArchivedEvent[]> {
  const result = await pool.query(GET_PAYOUT_EVENTS_SQL, [characterId, sinceId, limit]);
  return result.rows as ArchivedEvent[];
}

/**
 * Returns the creation event for a contract by its object ID (primary_id).
 * Used to resolve contract type, SSU IDs, and poster info for notifications.
 */
const GET_CONTRACT_CONTEXT_SQL = `
  SELECT * FROM events
  WHERE primary_id = $1
    AND event_name IN (
      'CoinForCoinCreatedEvent','CoinForItemCreatedEvent',
      'ItemForCoinCreatedEvent','ItemForItemCreatedEvent',
      'TransportCreatedEvent','MultiInputContractCreatedEvent')
  LIMIT 1
`;

export async function getContractContext(
  pool: pg.Pool,
  contractId: string,
): Promise<ArchivedEvent | undefined> {
  const result = await pool.query(GET_CONTRACT_CONTEXT_SQL, [contractId]);
  return result.rows[0] as ArchivedEvent | undefined;
}

// ============================================================
// Query: Stats
// ============================================================

export interface IndexerStats {
  total_events: number;
  events_by_module: Record<string, number>;
  latest_checkpoint: string | null;
  latest_timestamp: string | null;
}

export async function getStats(pool: pg.Pool): Promise<IndexerStats> {
  const totalResult = await pool.query("SELECT COUNT(*) as count FROM events");
  const total = Number(totalResult.rows[0].count);

  const byModuleResult = await pool.query(
    "SELECT module, COUNT(*) as count FROM events GROUP BY module",
  );

  const latestResult = await pool.query(
    "SELECT checkpoint_seq, timestamp_ms FROM events ORDER BY id DESC LIMIT 1",
  );
  const latest = latestResult.rows[0] as
    | { checkpoint_seq: string; timestamp_ms: string }
    | undefined;

  return {
    total_events: total,
    events_by_module: Object.fromEntries(
      byModuleResult.rows.map((r: { module: string; count: string }) => [
        r.module,
        Number(r.count),
      ]),
    ),
    latest_checkpoint: latest?.checkpoint_seq ?? null,
    latest_timestamp: latest?.timestamp_ms ?? null,
  };
}
