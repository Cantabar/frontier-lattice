/**
 * SQLite schema for the Frontier Lattice event indexer.
 *
 * Tables:
 *   - events: all archived on-chain events with checkpoint proof metadata
 *   - reputation_snapshots: materialised latest reputation per tribe×character
 *   - indexer_cursor: tracks the last processed event cursor for resumability
 *
 * Run standalone to create/migrate: `tsx src/db/schema.ts`
 */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export function initDatabase(dbPath: string): Database.Database {
  // Ensure the directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Performance pragmas for write-heavy indexer workload
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(SCHEMA_SQL);
  return db;
}

const SCHEMA_SQL = `
  -- Core event archive table.
  -- Each row is a single on-chain event with its checkpoint proof metadata.
  CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type      TEXT    NOT NULL,  -- fully qualified: package::module::EventName
    event_name      TEXT    NOT NULL,  -- short name: "JobCompletedEvent"
    module          TEXT    NOT NULL,  -- "tribe" | "contract_board" | "forge_planner"

    event_data      TEXT    NOT NULL,  -- JSON blob of the event fields

    -- Checkpoint proof chain: event → tx → checkpoint
    tx_digest           TEXT NOT NULL,
    event_seq           INTEGER NOT NULL,
    checkpoint_seq      TEXT NOT NULL,  -- u64 as string
    checkpoint_digest   TEXT NOT NULL,
    timestamp_ms        TEXT NOT NULL,  -- checkpoint timestamp (u64 as string)

    -- Denormalised fields for efficient queries
    primary_id      TEXT NOT NULL,  -- tribe_id / job_id / order_id / registry_id
    tribe_id        TEXT NOT NULL,
    character_id    TEXT,           -- NULL for events without a character actor

    archived_at     TEXT NOT NULL DEFAULT (datetime('now')),

    -- Dedup: same tx + event seq should not be archived twice
    UNIQUE(tx_digest, event_seq)
  );

  -- Indexes for the query API
  CREATE INDEX IF NOT EXISTS idx_events_event_name   ON events(event_name);
  CREATE INDEX IF NOT EXISTS idx_events_tribe_id     ON events(tribe_id);
  CREATE INDEX IF NOT EXISTS idx_events_character_id ON events(character_id);
  CREATE INDEX IF NOT EXISTS idx_events_primary_id   ON events(primary_id);
  CREATE INDEX IF NOT EXISTS idx_events_module       ON events(module);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp    ON events(timestamp_ms);
  CREATE INDEX IF NOT EXISTS idx_events_checkpoint   ON events(checkpoint_seq);

  -- Compound index for tribe-scoped event queries (most common pattern)
  CREATE INDEX IF NOT EXISTS idx_events_tribe_name ON events(tribe_id, event_name);

  -- Materialised reputation snapshot.
  -- Updated on every ReputationUpdatedEvent. Enables fast "current rep" lookups
  -- without scanning the full event history.
  CREATE TABLE IF NOT EXISTS reputation_snapshots (
    tribe_id      TEXT NOT NULL,
    character_id  TEXT NOT NULL,
    score         INTEGER NOT NULL DEFAULT 0,
    last_event_id INTEGER REFERENCES events(id),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tribe_id, character_id)
  );

  -- Indexer cursor: tracks the last processed event for resumable polling.
  -- Single row table (id = 1).
  CREATE TABLE IF NOT EXISTS indexer_cursor (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    last_tx_digest  TEXT,
    last_event_seq  INTEGER,
    last_checkpoint  TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Seed the cursor row if it doesn't exist
  INSERT OR IGNORE INTO indexer_cursor (id, last_tx_digest, last_event_seq, last_checkpoint)
  VALUES (1, NULL, NULL, NULL);
`;

// Allow running standalone for migration
const isMain = process.argv[1]?.endsWith("schema.ts") ||
               process.argv[1]?.endsWith("schema.js");
if (isMain) {
  const dbPath = process.argv[2] ?? "./data/frontier-lattice.db";
  console.log(`Migrating database at ${dbPath}...`);
  const db = initDatabase(dbPath);
  console.log("Schema applied successfully.");
  db.close();
}
