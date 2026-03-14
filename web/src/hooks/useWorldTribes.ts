/**
 * Hook that discovers all in-game tribe IDs by scanning CharacterCreatedEvent
 * emissions from the world contract.
 *
 * Each event contains a `tribe_id` field. We group by tribe ID and count
 * characters per tribe. This approach uses `queryEvents` which is available
 * in all @mysten/sui client versions.
 */

import { useMemo } from "react";
import { useSuiClientQuery } from "@mysten/dapp-kit";
import { config } from "../config";

export interface WorldTribeEntry {
  tribeId: number;
  characterCount: number;
}

export function useWorldTribes() {
  const worldPkg = config.packages.world;
  const enabled = worldPkg !== "0x0";

  const { data, isLoading, error } = useSuiClientQuery(
    "queryEvents",
    {
      query: {
        MoveEventType: `${worldPkg}::character::CharacterCreatedEvent`,
      },
      limit: 1000,
      order: "descending",
    },
    { enabled },
  );

  const worldTribes = useMemo(() => {
    const counts = new Map<number, number>();
    for (const ev of data?.data ?? []) {
      const parsed = ev.parsedJson as Record<string, unknown> | undefined;
      const tribeId = Number(parsed?.tribe_id ?? 0);
      if (tribeId > 0) {
        counts.set(tribeId, (counts.get(tribeId) ?? 0) + 1);
      }
    }

    const result = new Map<number, WorldTribeEntry>();
    for (const [tribeId, count] of counts) {
      result.set(tribeId, { tribeId, characterCount: count });
    }
    return result;
  }, [data]);

  return { worldTribes, isLoading: enabled && isLoading, error };
}
