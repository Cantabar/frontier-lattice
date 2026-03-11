/**
 * Prepared SQL queries for the Frontier Lattice event indexer.
 *
 * All queries are prepared once at init time for performance.
 * Callers pass the Database instance; queries are stateless.
 */

import type Database from "better-sqlite3";
import type { ArchivedEvent, EventTypeName } from "../types.js";

// ============================================================
// Insert
// ============================================================

const INSERT_EVENT_SQL = `
  INSERT OR IGNORE INTO events (
    event_type, event_name, module, event_data,
    tx_digest, event_seq, checkpoint_seq, checkpoint_digest, timestamp_ms,
    primary_id, tribe_id, character_id
  ) VALUES (
    @event_type, @event_name, @module, @event_data,
    @tx_digest, @event_seq, @checkpoint_seq, @checkpoint_digest, @timestamp_ms,
    @primary_id, @tribe_id, @character_id
  )
`;

export function insertEvent(db: Database.Database, event: ArchivedEvent): number {
  const stmt = db.prepare(INSERT_EVENT_SQL);
  const result = stmt.run(event);
  return result.lastInsertRowid as number;
}

export function insertEventsBatch(db: Database.Database, events: ArchivedEvent[]): void {
  const stmt = db.prepare(INSERT_EVENT_SQL);
  const tx = db.transaction((items: ArchivedEvent[]) => {
    for (const event of items) {
      stmt.run(event);
    }
  });
  tx(events);
}

// ============================================================
// Reputation Snapshot
// ============================================================

const UPSERT_REPUTATION_SQL = `
  INSERT INTO reputation_snapshots (tribe_id, character_id, score, last_event_id, updated_at)
  VALUES (@tribe_id, @character_id, @score, @last_event_id, datetime('now'))
  ON CONFLICT(tribe_id, character_id) DO UPDATE SET
    score = @score,
    last_event_id = @last_event_id,
    updated_at = datetime('now')
`;

export function upsertReputation(
  db: Database.Database,
  tribeId: string,
  characterId: string,
  score: number,
  lastEventId: number,
): void {
  db.prepare(UPSERT_REPUTATION_SQL).run({
    tribe_id: tribeId,
    character_id: characterId,
    score,
    last_event_id: lastEventId,
  });
}

// ============================================================
// Cursor
// ============================================================

const UPDATE_CURSOR_SQL = `
  UPDATE indexer_cursor SET
    last_tx_digest = @last_tx_digest,
    last_event_seq = @last_event_seq,
    last_checkpoint = @last_checkpoint,
    updated_at = datetime('now')
  WHERE id = 1
`;

const GET_CURSOR_SQL = `
  SELECT last_tx_digest, last_event_seq, last_checkpoint FROM indexer_cursor WHERE id = 1
`;

export interface IndexerCursor {
  last_tx_digest: string | null;
  last_event_seq: number | null;
  last_checkpoint: string | null;
}

export function updateCursor(
  db: Database.Database,
  txDigest: string,
  eventSeq: number,
  checkpoint: string,
): void {
  db.prepare(UPDATE_CURSOR_SQL).run({
    last_tx_digest: txDigest,
    last_event_seq: eventSeq,
    last_checkpoint: checkpoint,
  });
}

export function getCursor(db: Database.Database): IndexerCursor {
  return db.prepare(GET_CURSOR_SQL).get() as IndexerCursor;
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

export function getEvents(
  db: Database.Database,
  params?: EventQueryParams,
): ArchivedEvent[] {
  const { limit, offset, order } = defaultParams(params);
  const dir = order === "asc" ? "ASC" : "DESC";
  return db
    .prepare(`SELECT * FROM events ORDER BY id ${dir} LIMIT ? OFFSET ?`)
    .all(limit, offset) as ArchivedEvent[];
}

export function getEventsByType(
  db: Database.Database,
  eventName: EventTypeName,
  params?: EventQueryParams,
): ArchivedEvent[] {
  const { limit, offset, order } = defaultParams(params);
  const dir = order === "asc" ? "ASC" : "DESC";
  return db
    .prepare(`SELECT * FROM events WHERE event_name = ? ORDER BY id ${dir} LIMIT ? OFFSET ?`)
    .all(eventName, limit, offset) as ArchivedEvent[];
}

export function getEventsByTribe(
  db: Database.Database,
  tribeId: string,
  params?: EventQueryParams & { eventName?: EventTypeName },
): ArchivedEvent[] {
  const { limit, offset, order } = defaultParams(params);
  const dir = order === "asc" ? "ASC" : "DESC";
  if (params?.eventName) {
    return db
      .prepare(
        `SELECT * FROM events WHERE tribe_id = ? AND event_name = ?
         ORDER BY id ${dir} LIMIT ? OFFSET ?`,
      )
      .all(tribeId, params.eventName, limit, offset) as ArchivedEvent[];
  }
  return db
    .prepare(`SELECT * FROM events WHERE tribe_id = ? ORDER BY id ${dir} LIMIT ? OFFSET ?`)
    .all(tribeId, limit, offset) as ArchivedEvent[];
}

export function getEventsByCharacter(
  db: Database.Database,
  characterId: string,
  params?: EventQueryParams,
): ArchivedEvent[] {
  const { limit, offset, order } = defaultParams(params);
  const dir = order === "asc" ? "ASC" : "DESC";
  return db
    .prepare(
      `SELECT * FROM events WHERE character_id = ?
       ORDER BY id ${dir} LIMIT ? OFFSET ?`,
    )
    .all(characterId, limit, offset) as ArchivedEvent[];
}

export function getEventsByPrimaryId(
  db: Database.Database,
  primaryId: string,
  params?: EventQueryParams,
): ArchivedEvent[] {
  const { limit, offset, order } = defaultParams(params);
  const dir = order === "asc" ? "ASC" : "DESC";
  return db
    .prepare(
      `SELECT * FROM events WHERE primary_id = ?
       ORDER BY id ${dir} LIMIT ? OFFSET ?`,
    )
    .all(primaryId, limit, offset) as ArchivedEvent[];
}

export function getEventById(
  db: Database.Database,
  id: number,
): ArchivedEvent | undefined {
  return db.prepare("SELECT * FROM events WHERE id = ?").get(id) as
    | ArchivedEvent
    | undefined;
}

// ============================================================
// Query: Reputation
// ============================================================

export interface ReputationSnapshot {
  tribe_id: string;
  character_id: string;
  score: number;
  last_event_id: number;
  updated_at: string;
}

export function getReputation(
  db: Database.Database,
  tribeId: string,
  characterId: string,
): ReputationSnapshot | undefined {
  return db
    .prepare(
      "SELECT * FROM reputation_snapshots WHERE tribe_id = ? AND character_id = ?",
    )
    .get(tribeId, characterId) as ReputationSnapshot | undefined;
}

export function getTribeLeaderboard(
  db: Database.Database,
  tribeId: string,
  limit = 50,
): ReputationSnapshot[] {
  return db
    .prepare(
      `SELECT * FROM reputation_snapshots
       WHERE tribe_id = ?
       ORDER BY score DESC
       LIMIT ?`,
    )
    .all(tribeId, limit) as ReputationSnapshot[];
}

/**
 * Reputation audit trail: all ReputationUpdatedEvent entries for a
 * tribe×character pair, ordered chronologically. Each event includes
 * checkpoint proof metadata for independent verification.
 */
export function getReputationAuditTrail(
  db: Database.Database,
  tribeId: string,
  characterId: string,
): ArchivedEvent[] {
  return db
    .prepare(
      `SELECT * FROM events
       WHERE tribe_id = ? AND character_id = ? AND event_name = 'ReputationUpdatedEvent'
       ORDER BY id ASC`,
    )
    .all(tribeId, characterId) as ArchivedEvent[];
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

export function getStats(db: Database.Database): IndexerStats {
  const total = (
    db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number }
  ).count;

  const byModule = db
    .prepare("SELECT module, COUNT(*) as count FROM events GROUP BY module")
    .all() as { module: string; count: number }[];

  const latest = db
    .prepare("SELECT checkpoint_seq, timestamp_ms FROM events ORDER BY id DESC LIMIT 1")
    .get() as { checkpoint_seq: string; timestamp_ms: string } | undefined;

  return {
    total_events: total,
    events_by_module: Object.fromEntries(byModule.map((r) => [r.module, r.count])),
    latest_checkpoint: latest?.checkpoint_seq ?? null,
    latest_timestamp: latest?.timestamp_ms ?? null,
  };
}
