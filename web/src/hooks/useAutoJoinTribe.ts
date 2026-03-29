/**
 * Hook that detects when the connected wallet's Character belongs to an
 * in-game tribe that already has an on-chain Tribe, but the user has not
 * yet joined. Exposes a one-click `join()` action that calls `self_join`.
 */

import { useState, useRef, useMemo, useCallback } from "react";
import { useSuiClient, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { useIdentity } from "./useIdentity";
import { useTribes } from "./useTribes";
import { useWorldTribeInfo } from "./useWorldTribeInfo";
import { useNotifications } from "./useNotifications";
import { buildSelfJoinTribe, buildLookupTribeByGameId } from "../lib/sui";
import { config } from "../config";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface AutoJoinState {
  /** True when the user can self-join an existing on-chain tribe. */
  eligible: boolean;
  /** On-chain Tribe object ID to join. */
  tribeObjectId: string | null;
  /** Display name for the tribe (from indexer or world API). */
  tribeName: string | null;
  /** Whether the join transaction is in flight. */
  isJoining: boolean;
  /** Whether the lookup is still loading. */
  isLoading: boolean;
  /** Execute the self_join transaction. */
  join: () => Promise<void>;
}

export function useAutoJoinTribe(): AutoJoinState {
  const { address, characterId, inGameTribeId, tribeCaps, isLoading: identityLoading } = useIdentity();
  const { tribes } = useTribes();
  const tribeIdsToResolve = useMemo(() => (inGameTribeId ? [inGameTribeId] : []), [inGameTribeId]);
  const { tribeInfo } = useWorldTribeInfo(tribeIdsToResolve);
  const { push } = useNotifications();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const queryClient = useQueryClient();
  const [isJoining, setIsJoining] = useState(false);
  const justJoinedRef = useRef(false);

  // Basic eligibility: has character, has an in-game tribe, no existing TribeCap
  const isCandidate = !!characterId && !!address && (inGameTribeId ?? 0) > 0 && tribeCaps.length === 0;

  // Try to resolve the on-chain Tribe object ID from the indexer's event list first
  const eventTribe = useMemo(() => {
    if (!isCandidate || !inGameTribeId) return null;
    return tribes.find((t) => t.inGameTribeId === inGameTribeId) ?? null;
  }, [isCandidate, inGameTribeId, tribes]);

  // Fall back to on-chain registry lookup via devInspect if the indexer doesn't have it
  const { data: registryTribeId, isLoading: registryLoading } = useQuery({
    queryKey: ["autoJoinLookup", inGameTribeId],
    queryFn: async (): Promise<string | null> => {
      if (!inGameTribeId) return null;
      try {
        const tx = buildLookupTribeByGameId({
          registryId: config.tribeRegistryId,
          gameId: inGameTribeId,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await client.devInspectTransactionBlock({
          transactionBlock: tx as any,
          sender: "0x0000000000000000000000000000000000000000000000000000000000000000",
        });
        const returnValues = result.results?.[0]?.returnValues;
        if (returnValues && returnValues.length > 0) {
          const bytes = returnValues[0][0];
          if (bytes instanceof Uint8Array ? bytes[0] === 1 : Number(bytes[0]) === 1) {
            const idBytes = bytes instanceof Uint8Array ? bytes.slice(1) : bytes.slice(1);
            return "0x" + Array.from(idBytes).map((b: number) => b.toString(16).padStart(2, "0")).join("");
          }
        }
      } catch {
        // Registry lookup failed — not eligible
      }
      return null;
    },
    enabled: isCandidate && !eventTribe && config.tribeRegistryId !== "0x0",
    staleTime: 60_000,
  });

  const tribeObjectId = eventTribe?.id ?? registryTribeId ?? null;
  const tribeName = eventTribe?.name ?? (inGameTribeId ? tribeInfo.get(inGameTribeId)?.name ?? null : null);
  // Suppress the banner if the user is the leader (i.e. tribe creator) — their
  // TribeCap may still be in-flight but they should never be prompted to "join".
  const isLeaderOfTribe = !!eventTribe && eventTribe.leaderCharacterId === characterId;
  const eligible = isCandidate && !!tribeObjectId && !justJoinedRef.current && !isLeaderOfTribe;
  const isLoading = identityLoading || (isCandidate && !eventTribe && registryLoading);

  const join = useCallback(async () => {
    if (!eligible || !tribeObjectId || !characterId || !address) return;
    setIsJoining(true);
    try {
      const tx = buildSelfJoinTribe({
        tribeId: tribeObjectId,
        characterId,
        sender: address,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await signAndExecute({ transaction: tx as any });
      // Hide the banner optimistically before waiting for the chain to index
      justJoinedRef.current = true;
      // Wait for the transaction to be indexed so refetches return the new TribeCap
      await client.waitForTransaction({ digest: result.digest });
      // Invalidate caches so identity (TribeCap), tribe list, and member list refresh
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tribes"] }),
        queryClient.invalidateQueries({ queryKey: ["autoJoinLookup"] }),
        queryClient.invalidateQueries({ queryKey: ["tribeMembers"] }),
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[1] === "getOwnedObjects",
        }),
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[1] === "getObject" &&
            (query.queryKey[2] as { id?: string })?.id === tribeObjectId,
        }),
      ]);
      push({
        level: "info",
        title: "Joined Tribe",
        message: `You have joined ${tribeName ?? "your tribe"} as a Member.`,
        source: "auto-join",
      });
    } catch (err) {
      push({
        level: "error",
        title: "Join Failed",
        message: err instanceof Error ? err.message : "Transaction failed.",
        source: "auto-join",
      });
    } finally {
      setIsJoining(false);
    }
  }, [eligible, tribeObjectId, characterId, address, signAndExecute, queryClient, push, tribeName]);

  return { eligible, tribeObjectId, tribeName, isJoining, isLoading, join };
}
