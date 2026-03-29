/**
 * Hook that merges three data sources into a unified tribe list:
 *
 * 1. Character scan (useWorldTribes) — discovers all in-game tribe IDs on the local SUI network
 * 2. Indexer events (useTribes) — provides on-chain tribe contract details
 * 3. Stillness API (useWorldTribeInfo) — backfills tribe names/tickers from the game server
 *
 * The result is an InGameTribe[] sorted with on-chain tribes first (alphabetical),
 * then unclaimed tribes (by tribe ID).
 */

import { useMemo } from "react";
import { useTribes } from "./useTribes";
import { useWorldTribes } from "./useWorldTribes";
import { useWorldTribeInfo } from "./useWorldTribeInfo";
import type { InGameTribe, TribeListItem } from "../lib/types";

export function useAllTribes(options?: { refetchInterval?: number | false }) {
  const { tribes, isLoading: tribesLoading } = useTribes(options);
  const { worldTribes, isLoading: worldLoading } = useWorldTribes();

  // Collect all known in-game tribe IDs so useWorldTribeInfo only fetches what we need
  const allGameIds = useMemo(() => {
    const ids = new Set<number>();
    for (const id of worldTribes.keys()) ids.add(id);
    for (const t of tribes) {
      if (t.inGameTribeId > 0) ids.add(t.inGameTribeId);
    }
    return [...ids];
  }, [worldTribes, tribes]);

  const { tribeInfo } = useWorldTribeInfo(allGameIds);

  const allTribes = useMemo(() => {
    // Index on-chain tribes by in-game tribe ID for fast lookup
    const onChainByGameId = new Map<number, TribeListItem>();
    for (const t of tribes) {
      if (t.inGameTribeId > 0) {
        onChainByGameId.set(t.inGameTribeId, t);
      }
    }

    // Collect all known in-game tribe IDs from both sources
    const allGameIds = new Set<number>();
    for (const id of worldTribes.keys()) allGameIds.add(id);
    for (const id of onChainByGameId.keys()) allGameIds.add(id);
    // Also include on-chain tribes with inGameTribeId=0 (shouldn't happen, but defensive)
    const orphanOnChain = tribes.filter((t) => t.inGameTribeId === 0);

    const result: InGameTribe[] = [];

    for (const gameId of allGameIds) {
      result.push({
        inGameTribeId: gameId,
        characterCount: worldTribes.get(gameId)?.characterCount ?? 0,
        onChainTribe: onChainByGameId.get(gameId) ?? null,
        worldInfo: tribeInfo.get(gameId) ?? null,
      });
    }

    // Append orphan on-chain tribes (inGameTribeId=0) if any exist
    for (const t of orphanOnChain) {
      result.push({
        inGameTribeId: 0,
        characterCount: 0,
        onChainTribe: t,
        worldInfo: null,
      });
    }

    // Sort: on-chain first (alphabetical by display name), then unclaimed (by tribe ID)
    result.sort((a, b) => {
      const aOnChain = a.onChainTribe !== null;
      const bOnChain = b.onChainTribe !== null;
      if (aOnChain !== bOnChain) return aOnChain ? -1 : 1;

      // Within same group, sort by display name
      const aName = displayName(a);
      const bName = displayName(b);
      return aName.localeCompare(bName);
    });

    return result;
  }, [tribes, worldTribes, tribeInfo]);

  return {
    allTribes,
    isLoading: tribesLoading || worldLoading,
  };
}

function displayName(t: InGameTribe): string {
  if (t.onChainTribe) return t.onChainTribe.name;
  if (t.worldInfo) return t.worldInfo.name;
  return `Tribe #${t.inGameTribeId}`;
}
