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
import { useSignPersonalMessage } from "@mysten/dapp-kit";
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
  buildAuthHeader,
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

// ============================================================
// Hook
// ============================================================

export function useLocationPods(): UseLocationPodsReturn {
  const { address } = useIdentity();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

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

    // Need a fresh session — sign a challenge and exchange for a token
    const challenge = buildAuthChallenge(address);
    const { signature } = await signPersonalMessage({ message: challenge });
    const suiSigHeader = buildAuthHeader(challenge, signature);

    try {
      const { token, expires_at } = await createLocationSession(suiSigHeader);
      const bearerHeader = `Bearer ${token}`;
      cacheSession({
        header: bearerHeader,
        expiresAt: new Date(expires_at).getTime(),
        address,
      });
      return bearerHeader;
    } catch {
      // Fallback: if session creation fails, use the SuiSig header directly
      // (still valid for the server's 5-minute window)
      clearSessionCache();
      return suiSigHeader;
    }
  }, [address, signPersonalMessage]);

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

        // 3. Sign the full POD payload with wallet
        const podBytes = new TextEncoder().encode(
          JSON.stringify({
            structureId: params.structureId,
            ownerAddress: address,
            tribeId: params.tribeId,
            locationHash,
            timestamp: Date.now(),
          }),
        );
        const { signature } = await signPersonalMessage({ message: podBytes });

        // 4. Submit to server
        await submitLocationPod(authHeader, {
          structureId: params.structureId,
          tribeId: params.tribeId,
          locationHash,
          encryptedBlob: bytesToBase64(ciphertext),
          nonce: bytesToBase64(nonce),
          signature,
          podVersion: 1,
          tlkVersion: params.tlkVersion,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to submit POD";
        setError(msg);
        throw err;
      }
    },
    [address, getAuthHeader, signPersonalMessage],
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

        // 3. Sign the POD payload with wallet
        const podBytes = new TextEncoder().encode(
          JSON.stringify({
            networkNodeId: params.networkNodeId,
            ownerAddress: address,
            tribeId: params.tribeId,
            locationHash,
            timestamp: Date.now(),
          }),
        );
        const { signature } = await signPersonalMessage({ message: podBytes });

        // 4. Submit to server
        const result = await submitNetworkNodeLocationPod(authHeader, {
          networkNodeId: params.networkNodeId,
          tribeId: params.tribeId,
          locationHash,
          encryptedBlob: bytesToBase64(ciphertext),
          nonce: bytesToBase64(nonce),
          signature,
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
    [address, getAuthHeader, signPersonalMessage],
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
  };
}
