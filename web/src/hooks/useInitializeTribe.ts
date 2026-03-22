/**
 * Hook that detects when the connected wallet's Character belongs to an
 * in-game tribe that has NOT yet been created on-chain, and exposes a
 * one-click `initialize(name)` action that calls `create_tribe`.
 *
 * Complements useAutoJoinTribe: auto-join handles the case where the tribe
 * IS on-chain but the user hasn't joined; this hook handles the case where
 * the tribe doesn't exist on-chain at all.
 */

import { useState, useRef, useCallback } from "react";
import { useSuiClient, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdentity } from "./useIdentity";
import { useTribes } from "./useTribes";
import { useWorldTribeInfo } from "./useWorldTribeInfo";
import { useNotifications } from "./useNotifications";
import { buildCreateTribe, buildLookupTribeByGameId } from "../lib/sui";
import { config } from "../config";

export interface InitializeTribeState {
  /** True when the user's in-game tribe has no on-chain representation yet. */
  needsInit: boolean;
  /** The in-game tribe ID that needs initialization. */
  inGameTribeId: number | null;
  /** Suggested tribe name from the World API (may be null if unavailable). */
  suggestedName: string | null;
  /** Whether the create_tribe transaction is in flight. */
  isInitializing: boolean;
  /** Whether the lookup is still loading. */
  isLoading: boolean;
  /** Execute the create_tribe transaction. */
  initialize: (name: string) => Promise<void>;
}

export function useInitializeTribe(): InitializeTribeState {
  const {
    address,
    characterId,
    inGameTribeId,
    tribeCaps,
    isLoading: identityLoading,
  } = useIdentity();
  const { tribes } = useTribes();
  const { tribeInfo } = useWorldTribeInfo();
  const { push } = useNotifications();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const queryClient = useQueryClient();
  const [isInitializing, setIsInitializing] = useState(false);
  const justInitializedRef = useRef(false);

  // Basic candidate: has character, has in-game tribe, no TribeCap yet
  const isCandidate =
    !!characterId &&
    !!address &&
    (inGameTribeId ?? 0) > 0 &&
    tribeCaps.length === 0;

  // Check if the tribe already exists on-chain via the indexer event list
  const eventTribe =
    isCandidate && inGameTribeId
      ? (tribes.find((t) => t.inGameTribeId === inGameTribeId) ?? null)
      : null;

  // Fall back to on-chain registry lookup via devInspect
  const { data: registryResult, isLoading: registryLoading } = useQuery({
    queryKey: ["initTribeLookup", inGameTribeId],
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
          sender:
            "0x0000000000000000000000000000000000000000000000000000000000000000",
        });
        const returnValues = result.results?.[0]?.returnValues;
        if (returnValues && returnValues.length > 0) {
          const bytes = returnValues[0][0];
          if (
            bytes instanceof Uint8Array ? bytes[0] === 1 : Number(bytes[0]) === 1
          ) {
            // Tribe exists on-chain — return its ID (not eligible for init)
            const idBytes =
              bytes instanceof Uint8Array ? bytes.slice(1) : bytes.slice(1);
            return (
              "0x" +
              Array.from(idBytes)
                .map((b: number) => b.toString(16).padStart(2, "0"))
                .join("")
            );
          }
        }
      } catch {
        // Registry lookup failed — assume not on-chain
      }
      return null;
    },
    enabled: isCandidate && !eventTribe && config.tribeRegistryId !== "0x0",
    staleTime: 60_000,
  });

  // The tribe already exists on-chain (either via indexer or registry)
  const tribeExistsOnChain = !!eventTribe || !!registryResult;

  const needsInit =
    isCandidate &&
    !tribeExistsOnChain &&
    !justInitializedRef.current &&
    !identityLoading &&
    !registryLoading;

  const isLoading =
    identityLoading || (isCandidate && !eventTribe && registryLoading);

  // Suggested name from the World API
  const suggestedName =
    inGameTribeId ? (tribeInfo.get(inGameTribeId)?.name ?? null) : null;

  const initialize = useCallback(
    async (name: string) => {
      if (!needsInit || !characterId || !address) return;
      const trimmed = name.trim();
      if (!trimmed) return;

      setIsInitializing(true);
      try {
        const tx = buildCreateTribe({
          registryId: config.tribeRegistryId,
          characterId,
          name: trimmed,
          sender: address,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await signAndExecute({ transaction: tx as any });
        justInitializedRef.current = true;

        // Wait for indexing
        await client.waitForTransaction({ digest: result.digest });

        // Invalidate caches so identity (TribeCap), tribe list, etc. refresh
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["tribes"] }),
          queryClient.invalidateQueries({ queryKey: ["initTribeLookup"] }),
          queryClient.invalidateQueries({ queryKey: ["autoJoinLookup"] }),
          queryClient.invalidateQueries({ queryKey: ["tribeMembers"] }),
          queryClient.invalidateQueries({
            predicate: (query) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[1] === "getOwnedObjects",
          }),
        ]);

        push({
          level: "info",
          title: "Tribe Initialized",
          message: `"${trimmed}" has been created on-chain. You are the Leader.`,
          source: "init-tribe",
        });
      } catch (err) {
        push({
          level: "error",
          title: "Initialization Failed",
          message:
            err instanceof Error ? err.message : "Transaction failed.",
          source: "init-tribe",
        });
      } finally {
        setIsInitializing(false);
      }
    },
    [needsInit, characterId, address, signAndExecute, queryClient, push, client],
  );

  return {
    needsInit,
    inGameTribeId: isCandidate ? inGameTribeId : null,
    suggestedName,
    isInitializing,
    isLoading,
    initialize,
  };
}
