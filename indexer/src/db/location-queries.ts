/**
 * Shadow Location Network — database queries for location PODs and TLKs.
 */

import type pg from "pg";

// ============================================================
// Types
// ============================================================

export interface LocationPodRow {
  id: number;
  structure_id: string;
  owner_address: string;
  tribe_id: string;
  location_hash: string;
  /** Base64-encoded AES-256-GCM ciphertext */
  encrypted_blob: Buffer;
  /** Base64-encoded GCM nonce */
  nonce: Buffer;
  signature: string;
  pod_version: number;
  tlk_version: number;
  created_at: string;
  updated_at: string;
}

export interface TribeTlkRow {
  id: number;
  tribe_id: string;
  member_address: string;
  wrapped_key: Buffer;
  tlk_version: number;
  created_at: string;
}

// ============================================================
// Location POD — upsert / query / delete
// ============================================================

const UPSERT_POD_SQL = `
  INSERT INTO location_pods (
    structure_id, owner_address, tribe_id, location_hash,
    encrypted_blob, nonce, signature, pod_version, tlk_version
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (structure_id, tribe_id) DO UPDATE SET
    owner_address  = EXCLUDED.owner_address,
    location_hash  = EXCLUDED.location_hash,
    encrypted_blob = EXCLUDED.encrypted_blob,
    nonce          = EXCLUDED.nonce,
    signature      = EXCLUDED.signature,
    pod_version    = EXCLUDED.pod_version,
    tlk_version    = EXCLUDED.tlk_version,
    updated_at     = NOW()
  RETURNING id
`;

export async function upsertLocationPod(
  pool: pg.Pool,
  pod: {
    structureId: string;
    ownerAddress: string;
    tribeId: string;
    locationHash: string;
    encryptedBlob: Buffer;
    nonce: Buffer;
    signature: string;
    podVersion: number;
    tlkVersion: number;
  },
): Promise<number> {
  const result = await pool.query(UPSERT_POD_SQL, [
    pod.structureId,
    pod.ownerAddress,
    pod.tribeId,
    pod.locationHash,
    pod.encryptedBlob,
    pod.nonce,
    pod.signature,
    pod.podVersion,
    pod.tlkVersion,
  ]);
  return result.rows[0]?.id ?? 0;
}

export async function getLocationPodsByTribe(
  pool: pg.Pool,
  tribeId: string,
): Promise<LocationPodRow[]> {
  const result = await pool.query(
    "SELECT * FROM location_pods WHERE tribe_id = $1 ORDER BY updated_at DESC",
    [tribeId],
  );
  return result.rows as LocationPodRow[];
}

export async function getLocationPod(
  pool: pg.Pool,
  structureId: string,
  tribeId: string,
): Promise<LocationPodRow | undefined> {
  const result = await pool.query(
    "SELECT * FROM location_pods WHERE structure_id = $1 AND tribe_id = $2",
    [structureId, tribeId],
  );
  return result.rows[0] as LocationPodRow | undefined;
}

export async function deleteLocationPod(
  pool: pg.Pool,
  structureId: string,
  ownerAddress: string,
): Promise<boolean> {
  const result = await pool.query(
    "DELETE FROM location_pods WHERE structure_id = $1 AND owner_address = $2",
    [structureId, ownerAddress],
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================
// Tribe Location Keys
// ============================================================

const UPSERT_TLK_SQL = `
  INSERT INTO tribe_location_keys (tribe_id, member_address, wrapped_key, tlk_version)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (tribe_id, member_address, tlk_version) DO UPDATE SET
    wrapped_key = EXCLUDED.wrapped_key
  RETURNING id
`;

export async function upsertTlk(
  pool: pg.Pool,
  tribeId: string,
  memberAddress: string,
  wrappedKey: Buffer,
  tlkVersion: number,
): Promise<number> {
  const result = await pool.query(UPSERT_TLK_SQL, [
    tribeId,
    memberAddress,
    wrappedKey,
    tlkVersion,
  ]);
  return result.rows[0]?.id ?? 0;
}

export async function getTlkForMember(
  pool: pg.Pool,
  tribeId: string,
  memberAddress: string,
): Promise<TribeTlkRow | undefined> {
  const result = await pool.query(
    `SELECT * FROM tribe_location_keys
     WHERE tribe_id = $1 AND member_address = $2
     ORDER BY tlk_version DESC LIMIT 1`,
    [tribeId, memberAddress],
  );
  return result.rows[0] as TribeTlkRow | undefined;
}

export async function getLatestTlkVersion(
  pool: pg.Pool,
  tribeId: string,
): Promise<number> {
  const result = await pool.query(
    "SELECT MAX(tlk_version) as v FROM tribe_location_keys WHERE tribe_id = $1",
    [tribeId],
  );
  return Number(result.rows[0]?.v ?? 0);
}

export async function getAllTlksForTribe(
  pool: pg.Pool,
  tribeId: string,
  tlkVersion: number,
): Promise<TribeTlkRow[]> {
  const result = await pool.query(
    "SELECT * FROM tribe_location_keys WHERE tribe_id = $1 AND tlk_version = $2",
    [tribeId, tlkVersion],
  );
  return result.rows as TribeTlkRow[];
}

// ============================================================
// Member Public Keys (for TLK distribution)
// ============================================================

export interface MemberPublicKeyRow {
  id: number;
  tribe_id: string;
  member_address: string;
  x25519_pub: Buffer;
  registered_at: string;
}

const UPSERT_MEMBER_PUBKEY_SQL = `
  INSERT INTO member_public_keys (tribe_id, member_address, x25519_pub)
  VALUES ($1, $2, $3)
  ON CONFLICT (tribe_id, member_address) DO UPDATE SET
    x25519_pub    = EXCLUDED.x25519_pub,
    registered_at = NOW()
  RETURNING id
`;

export async function upsertMemberPublicKey(
  pool: pg.Pool,
  tribeId: string,
  memberAddress: string,
  x25519Pub: Buffer,
): Promise<number> {
  const result = await pool.query(UPSERT_MEMBER_PUBKEY_SQL, [
    tribeId,
    memberAddress,
    x25519Pub,
  ]);
  return result.rows[0]?.id ?? 0;
}

export async function getMemberPublicKeys(
  pool: pg.Pool,
  tribeId: string,
): Promise<MemberPublicKeyRow[]> {
  const result = await pool.query(
    "SELECT * FROM member_public_keys WHERE tribe_id = $1 ORDER BY registered_at ASC",
    [tribeId],
  );
  return result.rows as MemberPublicKeyRow[];
}

/**
 * Members who have registered an X25519 public key but do NOT yet have
 * a wrapped TLK at the current (latest) version for this tribe.
 */
export async function getMembersWithoutTlk(
  pool: pg.Pool,
  tribeId: string,
): Promise<MemberPublicKeyRow[]> {
  const result = await pool.query(
    `SELECT mpk.*
     FROM member_public_keys mpk
     WHERE mpk.tribe_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM tribe_location_keys tlk
         WHERE tlk.tribe_id = mpk.tribe_id
           AND tlk.member_address = mpk.member_address
           AND tlk.tlk_version = (
             SELECT COALESCE(MAX(tlk_version), 0)
             FROM tribe_location_keys
             WHERE tribe_id = $1
           )
       )
     ORDER BY mpk.registered_at ASC`,
    [tribeId],
  );
  return result.rows as MemberPublicKeyRow[];
}

// ============================================================
// Structure Location Tags (public, unencrypted)
// ============================================================

export interface StructureLocationTagRow {
  id: number;
  structure_id: string;
  tag_type: "region" | "constellation";
  tag_id: number;
  location_hash: string;
  verified_at: string;
}

const UPSERT_LOCATION_TAG_SQL = `
  INSERT INTO structure_location_tags (
    structure_id, tag_type, tag_id, location_hash
  ) VALUES ($1, $2, $3, $4)
  ON CONFLICT (structure_id, tag_type, tag_id) DO UPDATE SET
    location_hash = EXCLUDED.location_hash,
    verified_at   = NOW()
  RETURNING id
`;

export async function upsertLocationTag(
  pool: pg.Pool,
  structureId: string,
  tagType: "region" | "constellation",
  tagId: number,
  locationHash: string,
): Promise<number> {
  const result = await pool.query(UPSERT_LOCATION_TAG_SQL, [
    structureId,
    tagType,
    tagId,
    locationHash,
  ]);
  return result.rows[0]?.id ?? 0;
}

export async function getLocationTagsByStructure(
  pool: pg.Pool,
  structureId: string,
): Promise<StructureLocationTagRow[]> {
  const result = await pool.query(
    "SELECT * FROM structure_location_tags WHERE structure_id = $1 ORDER BY verified_at DESC",
    [structureId],
  );
  return result.rows as StructureLocationTagRow[];
}

export async function getStructuresByTag(
  pool: pg.Pool,
  tagType: "region" | "constellation",
  tagId: number,
): Promise<StructureLocationTagRow[]> {
  const result = await pool.query(
    "SELECT * FROM structure_location_tags WHERE tag_type = $1 AND tag_id = $2 ORDER BY verified_at DESC",
    [tagType, tagId],
  );
  return result.rows as StructureLocationTagRow[];
}

// ============================================================
// ZK Location Filter Proofs
// ============================================================

export interface FilterProofRow {
  id: number;
  structure_id: string;
  tribe_id: string;
  location_hash: string;
  filter_type: "region" | "proximity" | "mutual_proximity";
  filter_key: string;
  public_signals: string[];
  proof_json: Record<string, unknown>;
  reference_structure_id: string | null;
  reference_location_hash: string | null;
  created_at: string;
  verified_at: string;
}

const UPSERT_FILTER_PROOF_SQL = `
  INSERT INTO location_filter_proofs (
    structure_id, tribe_id, location_hash, filter_type, filter_key,
    public_signals, proof_json, reference_structure_id, reference_location_hash
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (structure_id, tribe_id, filter_type, filter_key) DO UPDATE SET
    public_signals          = EXCLUDED.public_signals,
    proof_json              = EXCLUDED.proof_json,
    reference_structure_id  = EXCLUDED.reference_structure_id,
    reference_location_hash = EXCLUDED.reference_location_hash,
    verified_at             = NOW()
  RETURNING id
`;

export async function upsertFilterProof(
  pool: pg.Pool,
  proof: {
    structureId: string;
    tribeId: string;
    locationHash: string;
    filterType: "region" | "proximity" | "mutual_proximity";
    filterKey: string;
    publicSignals: string[];
    proofJson: Record<string, unknown>;
    referenceStructureId?: string;
    referenceLocationHash?: string;
  },
): Promise<number> {
  const result = await pool.query(UPSERT_FILTER_PROOF_SQL, [
    proof.structureId,
    proof.tribeId,
    proof.locationHash,
    proof.filterType,
    proof.filterKey,
    JSON.stringify(proof.publicSignals),
    JSON.stringify(proof.proofJson),
    proof.referenceStructureId ?? null,
    proof.referenceLocationHash ?? null,
  ]);
  return result.rows[0]?.id ?? 0;
}

export async function getFilterProofsByKey(
  pool: pg.Pool,
  tribeId: string,
  filterType: "region" | "proximity",
  filterKey: string,
): Promise<FilterProofRow[]> {
  const result = await pool.query(
    `SELECT fp.*, lp.owner_address, lp.encrypted_blob, lp.nonce, lp.signature,
            lp.pod_version, lp.tlk_version
     FROM location_filter_proofs fp
     JOIN location_pods lp ON lp.structure_id = fp.structure_id AND lp.tribe_id = fp.tribe_id
     WHERE fp.tribe_id = $1 AND fp.filter_type = $2 AND fp.filter_key = $3
     ORDER BY fp.verified_at DESC`,
    [tribeId, filterType, filterKey],
  );
  return result.rows as FilterProofRow[];
}

export async function getFilterProofsForStructure(
  pool: pg.Pool,
  structureId: string,
  tribeId: string,
): Promise<FilterProofRow[]> {
  const result = await pool.query(
    `SELECT * FROM location_filter_proofs
     WHERE structure_id = $1 AND tribe_id = $2
     ORDER BY verified_at DESC`,
    [structureId, tribeId],
  );
  return result.rows as FilterProofRow[];
}

/**
 * Look up a verified mutual proximity proof linking two structures.
 * Checks both orderings (A↔B) since the proof is symmetric in intent.
 */
export async function getMutualProximityProof(
  pool: pg.Pool,
  structureIdA: string,
  structureIdB: string,
  tribeId: string,
): Promise<FilterProofRow | undefined> {
  const result = await pool.query(
    `SELECT * FROM location_filter_proofs
     WHERE filter_type = 'mutual_proximity'
       AND tribe_id = $1
       AND (
         (structure_id = $2 AND reference_structure_id = $3)
         OR
         (structure_id = $3 AND reference_structure_id = $2)
       )
     ORDER BY verified_at DESC
     LIMIT 1`,
    [tribeId, structureIdA, structureIdB],
  );
  return result.rows[0] as FilterProofRow | undefined;
}

// ============================================================
// Network Node — derived PODs and proof propagation
// ============================================================

/**
 * Upsert a location POD with an explicit `network_node_id` for derived PODs.
 * Primary (Network Node) PODs pass `null` for networkNodeId.
 */
const UPSERT_POD_WITH_NODE_SQL = `
  INSERT INTO location_pods (
    structure_id, owner_address, tribe_id, location_hash,
    encrypted_blob, nonce, signature, pod_version, tlk_version, network_node_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (structure_id, tribe_id) DO UPDATE SET
    owner_address   = EXCLUDED.owner_address,
    location_hash   = EXCLUDED.location_hash,
    encrypted_blob  = EXCLUDED.encrypted_blob,
    nonce           = EXCLUDED.nonce,
    signature       = EXCLUDED.signature,
    pod_version     = EXCLUDED.pod_version,
    tlk_version     = EXCLUDED.tlk_version,
    network_node_id = EXCLUDED.network_node_id,
    updated_at      = NOW()
  RETURNING id
`;

export async function upsertLocationPodWithNode(
  pool: pg.Pool,
  pod: {
    structureId: string;
    ownerAddress: string;
    tribeId: string;
    locationHash: string;
    encryptedBlob: Buffer;
    nonce: Buffer;
    signature: string;
    podVersion: number;
    tlkVersion: number;
    networkNodeId: string | null;
  },
): Promise<number> {
  const result = await pool.query(UPSERT_POD_WITH_NODE_SQL, [
    pod.structureId,
    pod.ownerAddress,
    pod.tribeId,
    pod.locationHash,
    pod.encryptedBlob,
    pod.nonce,
    pod.signature,
    pod.podVersion,
    pod.tlkVersion,
    pod.networkNodeId,
  ]);
  return result.rows[0]?.id ?? 0;
}

/** Get all derived PODs that were created from a specific Network Node. */
export async function getDerivedPodsByNetworkNode(
  pool: pg.Pool,
  networkNodeId: string,
  tribeId: string,
): Promise<LocationPodRow[]> {
  const result = await pool.query(
    `SELECT * FROM location_pods
     WHERE network_node_id = $1 AND tribe_id = $2
     ORDER BY structure_id`,
    [networkNodeId, tribeId],
  );
  return result.rows as LocationPodRow[];
}

/**
 * Delete derived PODs for structures no longer connected to a Network Node.
 * Returns the count of deleted rows.
 */
export async function deleteStaleDerivedPods(
  pool: pg.Pool,
  networkNodeId: string,
  tribeId: string,
  currentStructureIds: string[],
): Promise<number> {
  if (currentStructureIds.length === 0) {
    // All derived PODs are stale — delete them all
    const result = await pool.query(
      `DELETE FROM location_pods
       WHERE network_node_id = $1 AND tribe_id = $2`,
      [networkNodeId, tribeId],
    );
    return result.rowCount ?? 0;
  }

  // Build a parameterised IN clause: $3, $4, $5, ...
  const placeholders = currentStructureIds.map((_, i) => `$${i + 3}`).join(", ");
  const result = await pool.query(
    `DELETE FROM location_pods
     WHERE network_node_id = $1 AND tribe_id = $2
       AND structure_id NOT IN (${placeholders})`,
    [networkNodeId, tribeId, ...currentStructureIds],
  );
  return result.rowCount ?? 0;
}

/**
 * Upsert a derived filter proof record (propagated from a Network Node proof).
 */
const UPSERT_DERIVED_FILTER_PROOF_SQL = `
  INSERT INTO location_filter_proofs (
    structure_id, tribe_id, location_hash, filter_type, filter_key,
    public_signals, proof_json, source_network_node_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (structure_id, tribe_id, filter_type, filter_key) DO UPDATE SET
    public_signals         = EXCLUDED.public_signals,
    proof_json             = EXCLUDED.proof_json,
    source_network_node_id = EXCLUDED.source_network_node_id,
    verified_at            = NOW()
  RETURNING id
`;

export async function upsertDerivedFilterProof(
  pool: pg.Pool,
  proof: {
    structureId: string;
    tribeId: string;
    locationHash: string;
    filterType: "region" | "proximity" | "mutual_proximity";
    filterKey: string;
    publicSignals: string[];
    proofJson: Record<string, unknown>;
    sourceNetworkNodeId: string;
  },
): Promise<number> {
  const result = await pool.query(UPSERT_DERIVED_FILTER_PROOF_SQL, [
    proof.structureId,
    proof.tribeId,
    proof.locationHash,
    proof.filterType,
    proof.filterKey,
    JSON.stringify(proof.publicSignals),
    JSON.stringify(proof.proofJson),
    proof.sourceNetworkNodeId,
  ]);
  return result.rows[0]?.id ?? 0;
}
