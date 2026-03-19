/**
 * Shadow Location Network — TLK key distribution hook.
 *
 * Handles the lifecycle of distributing the Tribe Location Key to members:
 *   - Fetches the list of tribe members who have registered but don't
 *     yet have a wrapped TLK (pending members)
 *   - Provides a wrapForMember() action that wraps the TLK client-side
 *     and submits the wrapped blob via the indexer
 *
 * Public key registration is handled by the unlock/init flows in
 * LocationsPage.tsx using a signature-derived X25519 keypair.
 */

import { useState, useCallback, useEffect } from "react";
import { useLocationPods } from "./useLocationPods";
import {
  getPendingMembers as fetchPendingMembers,
  wrapTlkForMember,
  type PendingMember,
} from "../lib/indexer";
import {
  base64ToBytes,
  wrapTlk,
} from "../lib/locationCrypto";

// ============================================================
// Types
// ============================================================

export interface UseTlkDistributionReturn {
  /** Members who have registered a pubkey but don't have a wrapped TLK. */
  pendingMembers: PendingMember[];
  /** Whether a fetch/wrap operation is in progress. */
  isLoading: boolean;
  /** Last error message. */
  error: string | null;
  /** Refresh the pending members list. */
  refreshPending: (tribeId: string) => Promise<void>;
  /** Wrap the TLK for a specific pending member and submit to the server. */
  grantAccess: (tribeId: string, member: PendingMember, tlkBytes: Uint8Array) => Promise<void>;
  /** Grant access to all pending members at once. */
  grantAll: (tribeId: string, tlkBytes: Uint8Array) => Promise<void>;
}

// ============================================================
// Hook
// ============================================================

export function useTlkDistribution(
  tribeId: string | null,
  tlkBytes: Uint8Array | null,
): UseTlkDistributionReturn {
  const { getAuthHeader } = useLocationPods();

  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // NOTE: Public key registration now happens inside the unlock/init flows
  // in LocationsPage.tsx using the signature-derived X25519 keypair.
  // The old auto-registration derived keys from ed25519PubToX25519(account.publicKey)
  // which produced keys the user could never unwrap with (no access to Ed25519 secret).

  const refreshPending = useCallback(
    async (tid: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const authHeader = await getAuthHeader();
        const result = await fetchPendingMembers(tid, authHeader);
        setPendingMembers(result.members);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fetch pending members";
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [getAuthHeader],
  );

  // Auto-fetch pending members when the caller has the TLK unlocked
  useEffect(() => {
    if (tribeId && tlkBytes) {
      refreshPending(tribeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tribeId, tlkBytes]);

  const grantAccess = useCallback(
    async (tid: string, member: PendingMember, tlk: Uint8Array) => {
      setError(null);
      try {
        const authHeader = await getAuthHeader();
        // Wrap the TLK client-side for the target member's X25519 public key
        const memberPub = base64ToBytes(member.x25519Pub);
        const wrappedKey = await wrapTlk(tlk, memberPub);
        // Submit the wrapped blob to the server
        await wrapTlkForMember(authHeader, {
          tribeId: tid,
          newMemberAddress: member.address,
          wrappedKey,
        });
        // Remove from local pending list
        setPendingMembers((prev) =>
          prev.filter((m) => m.address !== member.address),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to grant TLK access";
        setError(msg);
        throw err;
      }
    },
    [getAuthHeader],
  );

  const grantAll = useCallback(
    async (tid: string, tlk: Uint8Array) => {
      setIsLoading(true);
      setError(null);
      try {
        for (const member of pendingMembers) {
          await grantAccess(tid, member, tlk);
        }
      } catch (err) {
        // grantAccess already sets error
      } finally {
        setIsLoading(false);
      }
    },
    [pendingMembers, grantAccess],
  );

  return {
    pendingMembers,
    isLoading,
    error,
    refreshPending,
    grantAccess,
    grantAll,
  };
}
