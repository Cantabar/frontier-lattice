/**
 * Shadow Location Network — React hook for managing location PODs.
 *
 * Provides:
 *   - Fetching and decrypting tribe location PODs
 *   - Submitting new encrypted location PODs
 *   - TLK initialisation and key management
 *   - Wallet signature authentication for all Location API calls
 */

import { useState, useCallback } from "react";
import { useSignTransaction } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useIdentity } from "./useIdentity";
import {
  getLocationPodsByTribe,
  getSoloLocationPods,
  submitLocationPod,
  deleteLocationPod as apiDeletePod,
  getTlk,
  initTlk,
  initSoloPlk,
  submitNetworkNodeLocationPod,
  refreshNetworkNodeLocationPod,
  isSoloTribeId,
  createLocationSession,
  type LocationPodResponse,
} from "../lib/api";
import {
  buildAuthChallenge,
  buildTxAuthHeader,
  computeLocationHash,
  generateSalt,
  encryptLocation,
  decryptLocation,
  base64ToBytes,
  bytesToBase64,
  type LocationData,
} from "../lib/locationCrypto";

// ============================================================
// Types
// ============================================================

export interface DecryptedPod {
  structureId: string;
  ownerAddress: string;
  locationHash: string;
  location: LocationData & { salt: string };
  podVersion: number;
  tlkVersion: number;
  /** Set when this POD was derived from a Network Node registration. */
  networkNodeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UseLocationPodsReturn {
  /** Decrypted location PODs for the active tribe */
  pods: DecryptedPod[];
  /** Whether a fetch/decrypt operation is in progress */
  isLoading: boolean;
  /** Last error encountered */
  error: string | null;
  /** Fetch and decrypt all PODs for the user's tribe */
  fetchPods: (tribeId: string, tlkBytes: Uint8Array) => Promise<void>;
  /** Submit a new location POD */
  submitPod: (params: {
    structureId: string;
    tribeId: string;
    location: LocationData;
    tlkBytes: Uint8Array;
    tlkVersion: number;
  }) => Promise<void>;
  /** Submit a Network Node location POD (derives PODs for connected structures) */
  submitNetworkNodePod: (params: {
    networkNodeId: string;
    tribeId: string;
    location: LocationData;
    tlkBytes: Uint8Array;
    tlkVersion: number;
  }) => Promise<{ structureCount: number }>;
  /** Refresh derived PODs for a previously registered Network Node */
  refreshNetworkNodePod: (networkNodeId: string, tribeId: string) => Promise<{ structureCount: number; staleRemoved: number }>;
  /** Delete (revoke) a location POD */
  deletePod: (structureId: string) => Promise<void>;
  /** Initialise TLK for a tribe (first-time setup) */
  initializeTlk: (params: {
    tribeId: string;
    memberPublicKeys: { address: string; x25519Pub: string }[];
  }) => Promise<{ tlkVersion: number }>;
  /** Initialise a Personal Location Key for solo mode */
  initializeSoloPlk: (x25519Pub: string) => Promise<{ tlkVersion: number; soloTribeId: string }>;
  /** Fetch the caller's wrapped TLK from the server */
  fetchWrappedTlk: (tribeId: string) => Promise<{ wrappedKey: string; tlkVersion: number } | null>;
  /** Get a fresh auth header (signs a challenge with the wallet) */
  getAuthHeader: () => Promise<string>;
  /** Clear all cached pods (used after TLK reset). */
  clearPods: () => void;
}

// ============================================================
// Module-level session cache
//
// Survives component remounts (navigations). Also persisted in
// sessionStorage so it survives React HMR in dev mode.
// Cleared when the tab closes (sessionStorage is per-tab).
// ============================================================

const SESSION_STORAGE_KEY = "frontier-corm:locationSession";

interface CachedSession {
  header: string;   // "Bearer <token>"
  expiresAt: number; // ms since epoch
  address: string;   // wallet address this session belongs to
}

let sessionCache: CachedSession | null = null;

// Deduplication guard: when a signing flow is in progress, concurrent
// callers of getAuthHeader() piggyback on this promise instead of
// triggering a second wallet signature prompt.
let pendingAuthPromise: Promise<string> | null = null;

// Hydrate from sessionStorage on module load
try {
  const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored) as CachedSession;
    if (parsed.expiresAt > Date.now()) {
      sessionCache = parsed;
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }
} catch {
  // sessionStorage may be unavailable
}

function cacheSession(session: CachedSession) {
  sessionCache = session;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Non-critical
  }
}

function clearSessionCache() {
  sessionCache = null;
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Non-critical
  }
}

/** Clear the cached location session. Exported for use in Settings. */
export function clearLocationSession() {
  clearSessionCache();
}

// ============================================================
// Hook
// ============================================================

export function useLocationPods(): UseLocationPodsReturn {
  const { address } = useIdentity();
  const { mutateAsync: signTransaction } = useSignTransaction();

  const [pods, setPods] = useState<DecryptedPod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAuthHeader = useCallback(async (): Promise<string> => {
    if (!address) throw new Error("Wallet not connected");

    // If we have a valid cached session for this address, reuse it
    const now = Date.now();
    if (
      sessionCache &&
      sessionCache.address === address &&
      sessionCache.expiresAt > now + 60_000 // 1-min safety margin
    ) {
      return sessionCache.header;
    }

    // If another call is already signing, piggyback on that promise
    // instead of prompting the wallet a second time.
    if (pendingAuthPromise) {
      return pendingAuthPromise;
    }

    // Build a TxSig auth header via signTransaction.
    // Every Sui wallet (including Eve Vault) supports signTransaction.
    const doAuth = async (): Promise<string> => {
      const challenge = buildAuthChallenge(address);
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [0]);
      tx.transferObjects([coin], address);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { bytes: txBytes, signature: txSig } = await signTransaction({ transaction: tx as any });
      const rawAuthHeader = buildTxAuthHeader(challenge, txBytes, txSig);

      try {
        const { token, expires_at } = await createLocationSession(rawAuthHeader);
        const bearerHeader = `Bearer ${token}`;
        cacheSession({
          header: bearerHeader,
          expiresAt: new Date(expires_at).getTime(),
          address,
        });
        return bearerHeader;
      } catch {
        // Fallback: if session creation fails, use the raw auth header directly
        // (still valid for the server's 5-minute window)
        clearSessionCache();
        return rawAuthHeader;
      }
    };

    pendingAuthPromise = doAuth();
    try {
      return await pendingAuthPromise;
    } finally {
      pendingAuthPromise = null;
    }
  }, [address, signTransaction]);

  const fetchPods = useCallback(
    async (tribeId: string, tlkBytes: Uint8Array) => {
      setIsLoading(true);
      setError(null);
      try {
        const authHeader = await getAuthHeader();
        const { pods: rawPods } = isSoloTribeId(tribeId)
          ? await getSoloLocationPods(authHeader)
          : await getLocationPodsByTribe(tribeId, authHeader);

        const decrypted: DecryptedPod[] = [];
        for (const pod of rawPods) {
          try {
            const location = await decryptLocation(
              base64ToBytes(pod.encrypted_blob),
              base64ToBytes(pod.nonce),
              tlkBytes,
            );
            decrypted.push({
              structureId: pod.structure_id,
              ownerAddress: pod.owner_address,
              locationHash: pod.location_hash,
              location,
              podVersion: pod.pod_version,
              tlkVersion: pod.tlk_version,
              networkNodeId: (pod as LocationPodResponse & { network_node_id?: string }).network_node_id ?? null,
              createdAt: pod.created_at,
              updatedAt: pod.updated_at,
            });
          } catch {
            // POD may be encrypted with a different TLK version — skip
            console.warn(`[locations] Failed to decrypt POD for ${pod.structure_id}`);
          }
        }

        setPods(decrypted);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fetch PODs";
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [getAuthHeader],
  );

  const submitPod = useCallback(
    async (params: {
      structureId: string;
      tribeId: string;
      location: LocationData;
      tlkBytes: Uint8Array;
      tlkVersion: number;
    }) => {
      setError(null);
      try {
        const authHeader = await getAuthHeader();

        // 1. Generate salt and compute Poseidon commitment
        const salt = generateSalt();
        const locationHash = computeLocationHash(
          params.location.x,
          params.location.y,
          params.location.z,
          salt,
        );

        // 2. Encrypt location data with TLK
        const { ciphertext, nonce } = await encryptLocation(
          params.location,
          salt,
          params.tlkBytes,
        );

        // 3. Submit to server (auth header proves identity; no separate POD signature needed)
        await submitLocationPod(authHeader, {
          structureId: params.structureId,
          tribeId: params.tribeId,
          locationHash,
          encryptedBlob: bytesToBase64(ciphertext),
          nonce: bytesToBase64(nonce),
          signature: "",
          podVersion: 1,
          tlkVersion: params.tlkVersion,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to submit POD";
        setError(msg);
        throw err;
      }
    },
    [address, getAuthHeader],
  );

  const submitNetworkNodePod = useCallback(
    async (params: {
      networkNodeId: string;
      tribeId: string;
      location: LocationData;
      tlkBytes: Uint8Array;
      tlkVersion: number;
    }): Promise<{ structureCount: number }> => {
      setError(null);
      try {
        const authHeader = await getAuthHeader();

        // 1. Generate salt and compute Poseidon commitment
        const salt = generateSalt();
        const locationHash = computeLocationHash(
          params.location.x,
          params.location.y,
          params.location.z,
          salt,
        );

        // 2. Encrypt location data with TLK
        const { ciphertext, nonce } = await encryptLocation(
          params.location,
          salt,
          params.tlkBytes,
        );

        // 3. Submit to server (auth header proves identity; no separate POD signature needed)
        const result = await submitNetworkNodeLocationPod(authHeader, {
          networkNodeId: params.networkNodeId,
          tribeId: params.tribeId,
          locationHash,
          encryptedBlob: bytesToBase64(ciphertext),
          nonce: bytesToBase64(nonce),
          signature: "",
          podVersion: 1,
          tlkVersion: params.tlkVersion,
        });

        return { structureCount: result.structureCount };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to submit Network Node POD";
        setError(msg);
        throw err;
      }
    },
    [address, getAuthHeader],
  );

  const refreshNetworkNodePod = useCallback(
    async (
      networkNodeId: string,
      tribeId: string,
    ): Promise<{ structureCount: number; staleRemoved: number }> => {
      setError(null);
      try {
        const authHeader = await getAuthHeader();
        const result = await refreshNetworkNodeLocationPod(authHeader, {
          networkNodeId,
          tribeId,
        });
        return { structureCount: result.structureCount, staleRemoved: result.staleRemoved };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to refresh Network Node PODs";
        setError(msg);
        throw err;
      }
    },
    [getAuthHeader],
  );

  const deletePod = useCallback(
    async (structureId: string) => {
      setError(null);
      try {
        const authHeader = await getAuthHeader();
        await apiDeletePod(structureId, authHeader);
        setPods((prev) => prev.filter((p) => p.structureId !== structureId));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to delete POD";
        setError(msg);
        throw err;
      }
    },
    [getAuthHeader],
  );

  const initializeTlk = useCallback(
    async (params: {
      tribeId: string;
      memberPublicKeys: { address: string; x25519Pub: string }[];
    }): Promise<{ tlkVersion: number }> => {
      const authHeader = await getAuthHeader();
      const result = await initTlk(authHeader, params);
      return { tlkVersion: result.tlk_version };
    },
    [getAuthHeader],
  );

  const initializeSoloPlk = useCallback(
    async (x25519Pub: string): Promise<{ tlkVersion: number; soloTribeId: string }> => {
      const authHeader = await getAuthHeader();
      const result = await initSoloPlk(authHeader, { x25519Pub });
      return { tlkVersion: result.tlk_version, soloTribeId: result.tribe_id };
    },
    [getAuthHeader],
  );

  const clearPods = useCallback(() => {
    setPods([]);
    setError(null);
  }, []);

  const fetchWrappedTlk = useCallback(
    async (tribeId: string): Promise<{ wrappedKey: string; tlkVersion: number } | null> => {
      try {
        const authHeader = await getAuthHeader();
        const result = await getTlk(tribeId, authHeader);
        return { wrappedKey: result.wrapped_key, tlkVersion: result.tlk_version };
      } catch {
        return null;
      }
    },
    [getAuthHeader],
  );

  return {
    pods,
    isLoading,
    error,
    fetchPods,
    submitPod,
    submitNetworkNodePod,
    refreshNetworkNodePod,
    deletePod,
    initializeTlk,
    initializeSoloPlk,
    fetchWrappedTlk,
    getAuthHeader,
    clearPods,
  };
}
