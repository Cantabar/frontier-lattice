/**
 * Typed fetch wrappers for the Frontier Lattice event indexer REST API.
 *
 * All endpoints are under /api/v1 (proxied through Vite in dev, or direct in prod).
 */

import { config } from "../config";
import type { ArchivedEvent, EventTypeName, PaginationParams, ReputationSnapshot } from "./types";

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

// ---- Reputation ----

export function getReputation(tribeId: string, characterId: string) {
  return get<{
    snapshot: ReputationSnapshot | null;
    audit_trail: ArchivedEvent[];
  }>(`/reputation/${tribeId}/${characterId}`);
}

export function getLeaderboard(tribeId: string, limit = 50) {
  return get<{ leaderboard: ReputationSnapshot[] }>(
    `/reputation/${tribeId}/leaderboard${qs({ limit })}`,
  );
}

// ---- Domain feeds ----

export function getJobsFeed(tribeId: string, params: PaginationParams = {}) {
  return get<{ events: ArchivedEvent[] }>(
    `/jobs/${tribeId}${qs({ limit: params.limit, offset: params.offset, order: params.order })}`,
  );
}

export function getManufacturingFeed(tribeId: string, params: PaginationParams = {}) {
  return get<{ events: ArchivedEvent[] }>(
    `/manufacturing/${tribeId}${qs({ limit: params.limit, offset: params.offset, order: params.order })}`,
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

// ---- Metadata ----

export function getEventTypes() {
  return get<{ event_types: string[] }>("/event-types");
}
