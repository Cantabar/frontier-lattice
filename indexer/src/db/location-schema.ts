/**
 * Shadow Location Network — Postgres schema for location PODs and tribe
 * location keys (TLK).
 *
 * Tables:
 *   - location_pods:         encrypted location attestations per structure × tribe
 *   - tribe_location_keys:   AES-256-GCM TLK wrapped to each tribe member's X25519 key
 *
 * Applied automatically by initLocationSchema() on indexer startup.
 */

import type pg from "pg";

export async function initLocationSchema(pool: pg.Pool): Promise<void> {
  await pool.query(LOCATION_SCHEMA_SQL);
}

const LOCATION_SCHEMA_SQL = `
  -- Encrypted location PODs (one per structure × tribe)
  CREATE TABLE IF NOT EXISTS location_pods (
    id              BIGSERIAL PRIMARY KEY,
    structure_id    TEXT NOT NULL,
    owner_address   TEXT NOT NULL,
    tribe_id        TEXT NOT NULL,
    location_hash   TEXT NOT NULL,
    encrypted_blob  BYTEA NOT NULL,
    nonce           BYTEA NOT NULL,
    signature       TEXT NOT NULL,
    pod_version     INT NOT NULL DEFAULT 1,
    tlk_version     INT NOT NULL DEFAULT 1,
    network_node_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (structure_id, tribe_id)
  );

  CREATE INDEX IF NOT EXISTS idx_location_pods_tribe    ON location_pods(tribe_id);
  CREATE INDEX IF NOT EXISTS idx_location_pods_owner    ON location_pods(owner_address);
  CREATE INDEX IF NOT EXISTS idx_location_pods_hash     ON location_pods(location_hash);
  CREATE INDEX IF NOT EXISTS idx_location_pods_network_node ON location_pods(network_node_id);

  -- Tribe Location Keys — AES-256-GCM symmetric key wrapped per member
  CREATE TABLE IF NOT EXISTS tribe_location_keys (
    id              BIGSERIAL PRIMARY KEY,
    tribe_id        TEXT NOT NULL,
    member_address  TEXT NOT NULL,
    wrapped_key     BYTEA NOT NULL,
    tlk_version     INT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tribe_id, member_address, tlk_version)
  );

  CREATE INDEX IF NOT EXISTS idx_tlk_tribe   ON tribe_location_keys(tribe_id);
  CREATE INDEX IF NOT EXISTS idx_tlk_member  ON tribe_location_keys(member_address);

  -- Member X25519 public keys for TLK distribution
  CREATE TABLE IF NOT EXISTS member_public_keys (
    id              BIGSERIAL PRIMARY KEY,
    tribe_id        TEXT NOT NULL,
    member_address  TEXT NOT NULL,
    x25519_pub      BYTEA NOT NULL,
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tribe_id, member_address)
  );

  CREATE INDEX IF NOT EXISTS idx_member_pubkeys_tribe
    ON member_public_keys(tribe_id);

  -- Verified Groth16 proofs for location filters (region / proximity)
  CREATE TABLE IF NOT EXISTS location_filter_proofs (
    id                      BIGSERIAL PRIMARY KEY,
    structure_id            TEXT NOT NULL,
    tribe_id                TEXT NOT NULL,
    location_hash           TEXT NOT NULL,
    filter_type             TEXT NOT NULL CHECK (filter_type IN ('region', 'proximity')),
    filter_key              TEXT NOT NULL,
    public_signals          JSONB NOT NULL,
    proof_json              JSONB NOT NULL,
    source_network_node_id  TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (structure_id, tribe_id, filter_type, filter_key)
  );

  CREATE INDEX IF NOT EXISTS idx_location_filter_proofs_lookup
    ON location_filter_proofs(tribe_id, filter_type, filter_key);
  CREATE INDEX IF NOT EXISTS idx_location_filter_proofs_hash
    ON location_filter_proofs(location_hash);

  -- Public location tags — unencrypted region/constellation membership per structure.
  -- Populated when a ZK region proof is verified against a canonical game region.
  -- Queryable without authentication.
  CREATE TABLE IF NOT EXISTS structure_location_tags (
    id              BIGSERIAL PRIMARY KEY,
    structure_id    TEXT NOT NULL,
    tag_type        TEXT NOT NULL CHECK (tag_type IN ('region', 'constellation')),
    tag_id          INTEGER NOT NULL,
    location_hash   TEXT NOT NULL,
    verified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (structure_id, tag_type, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_structure_tags_lookup
    ON structure_location_tags(tag_type, tag_id);
  CREATE INDEX IF NOT EXISTS idx_structure_tags_structure
    ON structure_location_tags(structure_id);
`;
    ON location_filter_proofs(source_network_node_id);
`;
