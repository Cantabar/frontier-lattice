/**
 * Typed fetch wrappers for the Frontier Corm event indexer REST API.
 *
 * All endpoints are under /api/v1 (proxied through Vite in dev, or direct in prod).
 */

import { config } from "../config";
import type { ArchivedEvent, EventTypeName, PaginationParams } from "./types";

const base = config.indexerUrl;

// ---------------------------------------------------------------------------
// Global error listener — components can subscribe to indexer failures
// without coupling indexer.ts to React.
// ---------------------------------------------------------------------------

type IndexerErrorListener = (error: Error, path: string) => void;
const errorListeners = new Set<IndexerErrorListener>();

/** Register a callback that fires whenever an indexer request fails. */
export function onIndexerError(listener: IndexerErrorListener): () => void {
  errorListeners.add(listener);
  return () => { errorListeners.delete(listener); };
}

function notifyError(error: Error, path: string) {
  for (const listener of errorListeners) {
    try { listener(error, path); } catch { /* swallow listener errors */ }
  }
}

// ---------------------------------------------------------------------------

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) {
    const error = new Error(`Indexer ${res.status}: ${await res.text()}`);
    notifyError(error, path);
    throw error;
  }
  return res.json();
}

// ---- Health / Stats ----

export function getHealth() {
  return get<{ status: string; timestamp: string }>("/health");
}

export function getStats() {
  return get<{ total_events: number; latest_checkpoint: string | null }>("/stats");
}

// ---- Events ----

export function getEvents(params: PaginationParams & { type?: EventTypeName } = {}) {
  return get<{ events: ArchivedEvent[] }>(
    `/events${qs({ limit: params.limit, offset: params.offset, order: params.order, type: params.type })}`,
  );
}

export function getEventsByTribe(tribeId: string, params: PaginationParams & { type?: EventTypeName } = {}) {
  return get<{ events: ArchivedEvent[] }>(
    `/events/tribe/${tribeId}${qs({ limit: params.limit, offset: params.offset, order: params.order, type: params.type })}`,
  );
}

export function getEventsByCharacter(characterId: string, params: PaginationParams = {}) {
  return get<{ events: ArchivedEvent[] }>(
    `/events/character/${characterId}${qs({ limit: params.limit, offset: params.offset, order: params.order })}`,
  );
}

export function getEventsByObject(objectId: string, params: PaginationParams = {}) {
  return get<{ events: ArchivedEvent[] }>(
    `/events/object/${objectId}${qs({ limit: params.limit, offset: params.offset, order: params.order })}`,
  );
}

// ---- Proof ----

export function getEventProof(eventId: number) {
  return get<{
    event_id: number;
    event_type: string;
    event_name: string;
    event_data: Record<string, unknown>;
    proof: {
      tx_digest: string;
      event_seq: number;
      checkpoint_seq: string | null;
      checkpoint_digest: string | null;
      timestamp_ms: string;
      verification_note: string;
    };
  }>(`/proof/${eventId}`);
}

// ---- Trustless Contracts ----

export function getTrustlessContractsFeed(params: PaginationParams = {}) {
  return get<{ events: ArchivedEvent[] }>(
    `/events${qs({ limit: params.limit, offset: params.offset, order: params.order, type: "ContractCreatedEvent" as EventTypeName })}`,
  );
}

export function getTrustlessContractHistory(params: PaginationParams = {}) {
  return get<{ events: ArchivedEvent[] }>(
    `/events${qs({ limit: params.limit, offset: params.offset, order: params.order, type: "ContractCompletedEvent" as EventTypeName })}`,
  );
}

// ---- Payout Notifications ----

export function getPayoutEvents(characterId: string, sinceId?: number, limit?: number) {
  return get<{ events: ArchivedEvent[]; character_id: string; since_id: number | null }>(
    `/events/payouts/${characterId}${qs({ since_id: sinceId, limit })}`,
  );
}

export function getContractContext(contractId: string) {
  return get<ArchivedEvent>(`/events/contract-context/${contractId}`);
}

// ---- Metadata ----

export function getEventTypes() {
  return get<{ event_types: string[] }>("/event-types");
}

// ---- Shadow Location Network ----

async function authedGet<T>(
  path: string,
  authHeader: string,
  options?: { silent?: boolean },
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) {
    const error = new Error(`Indexer ${res.status}: ${await res.text()}`);
    if (!options?.silent) notifyError(error, path);
    throw error;
  }
  return res.json();
}

async function authedPost<T>(
  path: string,
  authHeader: string,
  body: unknown,
  options?: { silent?: boolean },
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = new Error(`Indexer ${res.status}: ${await res.text()}`);
    if (!options?.silent) notifyError(error, path);
    throw error;
  }
  return res.json();
}

async function authedDelete<T>(path: string, authHeader: string): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "DELETE",
    headers: { Authorization: authHeader },
  });
  if (!res.ok) {
    const error = new Error(`Indexer ${res.status}: ${await res.text()}`);
    notifyError(error, path);
    throw error;
  }
  return res.json();
}

export interface LocationPodResponse {
  id: number;
  structure_id: string;
  owner_address: string;
  tribe_id: string;
  location_hash: string;
  encrypted_blob: string;
  nonce: string;
  signature: string;
  pod_version: number;
  tlk_version: number;
  created_at: string;
  updated_at: string;
}

export function getLocationPodsByTribe(tribeId: string, authHeader: string) {
  return authedGet<{ pods: LocationPodResponse[]; tribe_id: string; count: number }>(
    `/locations/tribe/${tribeId}`,
    authHeader,
  );
}

export function getLocationPod(structureId: string, tribeId: string, authHeader: string) {
  return authedGet<LocationPodResponse>(
    `/locations/pod/${structureId}?tribeId=${encodeURIComponent(tribeId)}`,
    authHeader,
  );
}

export function submitLocationPod(authHeader: string, body: {
  structureId: string;
  tribeId: string;
  locationHash: string;
  encryptedBlob: string;
  nonce: string;
  signature: string;
  podVersion?: number;
  tlkVersion?: number;
}) {
  return authedPost<{ id: number; structureId: string; tribeId: string }>(
    "/locations/pod",
    authHeader,
    body,
  );
}

export function deleteLocationPod(structureId: string, authHeader: string) {
  return authedDelete<{ deleted: boolean; structureId: string }>(
    `/locations/pod/${structureId}`,
    authHeader,
  );
}

export function getTlkStatus(tribeId: string, authHeader: string) {
  return authedGet<{ tribe_id: string; initialized: boolean; tlk_version: number; has_wrapped_key: boolean }>(
    `/locations/keys/${tribeId}/status`,
    authHeader,
    { silent: true },
  );
}

export function getTlk(tribeId: string, authHeader: string) {
  return authedGet<{ tribe_id: string; tlk_version: number; wrapped_key: string }>(
    `/locations/keys/${tribeId}`,
    authHeader,
    { silent: true },
  );
}

export function initTlk(authHeader: string, body: {
  tribeId: string;
  memberPublicKeys: { address: string; x25519Pub: string }[];
}) {
  return authedPost<{ tribe_id: string; tlk_version: number; members_wrapped: number }>(
    "/locations/keys/init",
    authHeader,
    body,
  );
}

export function rotateTlk(authHeader: string, body: {
  tribeId: string;
  memberPublicKeys: { address: string; x25519Pub: string }[];
}) {
  return authedPost<{ tribe_id: string; tlk_version: number; members_wrapped: number }>(
    "/locations/keys/rotate",
    authHeader,
    body,
  );
}

export function wrapTlkForMember(authHeader: string, body: {
  tribeId: string;
  newMemberAddress: string;
  wrappedKey: string; // base64-encoded wrapped TLK blob produced client-side
}) {
  return authedPost<{ tribe_id: string; tlk_version: number; member: string }>(
    "/locations/keys/wrap",
    authHeader,
    body,
  );
}

// ---- TLK Key Distribution ----

export interface PendingMember {
  address: string;
  x25519Pub: string;
  registeredAt: string;
}

export function registerPublicKey(authHeader: string, body: {
  tribeId: string;
  x25519Pub: string; // base64-encoded 32-byte X25519 public key
}) {
  return authedPost<{ tribe_id: string; member: string; registered: boolean }>(
    "/locations/keys/register",
    authHeader,
    body,
    { silent: true },
  );
}

export function getPendingMembers(tribeId: string, authHeader: string) {
  return authedGet<{ tribe_id: string; count: number; members: PendingMember[] }>(
    `/locations/keys/pending/${tribeId}`,
    authHeader,
  );
}

// ---- ZK Location Proofs ----

export interface ZkProofSubmission {
  structureId: string;
  tribeId: string;
  filterType: "region" | "proximity";
  publicSignals: string[];
  proof: Record<string, unknown>;
}

export interface ZkFilteredResult {
  id: number;
  structure_id: string;
  tribe_id: string;
  location_hash: string;
  filter_type: string;
  filter_key: string;
  public_signals: string[];
  proof_json: Record<string, unknown>;
  verified_at: string;
  // Joined from location_pods
  owner_address?: string;
  encrypted_blob?: string;
  nonce?: string;
  signature?: string;
  pod_version?: number;
  tlk_version?: number;
}

export function submitZkProof(authHeader: string, body: ZkProofSubmission) {
  return authedPost<{ id: number; structureId: string; tribeId: string; filterType: string; verified: boolean }>(
    "/locations/proofs/submit",
    authHeader,
    body,
  );
}

export function getZkRegionResults(
  authHeader: string,
  params: {
    tribeId: string;
    xMin: string;
    xMax: string;
    yMin: string;
    yMax: string;
    zMin: string;
    zMax: string;
  },
) {
  const q = `tribeId=${enc(params.tribeId)}&xMin=${enc(params.xMin)}&xMax=${enc(params.xMax)}&yMin=${enc(params.yMin)}&yMax=${enc(params.yMax)}&zMin=${enc(params.zMin)}&zMax=${enc(params.zMax)}`;
  return authedGet<{ tribe_id: string; filter_type: string; count: number; results: ZkFilteredResult[] }>(
    `/locations/proofs/region?${q}`,
    authHeader,
  );
}

export function getZkProximityResults(
  authHeader: string,
  params: {
    tribeId: string;
    refX: string;
    refY: string;
    refZ: string;
    maxDistSq: string;
  },
) {
  const q = `tribeId=${enc(params.tribeId)}&refX=${enc(params.refX)}&refY=${enc(params.refY)}&refZ=${enc(params.refZ)}&maxDistSq=${enc(params.maxDistSq)}`;
  return authedGet<{ tribe_id: string; filter_type: string; count: number; results: ZkFilteredResult[] }>(
    `/locations/proofs/proximity?${q}`,
    authHeader,
  );
}

function enc(v: string) { return encodeURIComponent(v); }

// ---- Network Node Location PODs ----

export function submitNetworkNodeLocationPod(
  authHeader: string,
  body: {
    networkNodeId: string;
    tribeId: string;
    locationHash: string;
    encryptedBlob: string;
    nonce: string;
    signature: string;
    podVersion?: number;
    tlkVersion?: number;
  },
) {
  return authedPost<{
    networkNodeId: string;
    tribeId: string;
    structureCount: number;
  }>("/locations/network-node-pod", authHeader, body);
}

export function refreshNetworkNodeLocationPod(
  authHeader: string,
  body: {
    networkNodeId: string;
    tribeId: string;
  },
) {
  return authedPost<{
    networkNodeId: string;
    tribeId: string;
    structureCount: number;
    staleRemoved: number;
  }>("/locations/network-node-pod/refresh", authHeader, body);
}
