/**
 * Hook for discovering all known tribes via the event indexer.
 *
 * Uses TribeCreatedEvent entries to build a lightweight list of tribes
 * without needing to enumerate TribeRegistry dynamic fields.
 */

import { useQuery } from "@tanstack/react-query";
import { getEvents } from "../lib/indexer";
import type { TribeListItem } from "../lib/types";

export function useTribes(options?: { refetchInterval?: number | false }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["tribes"],
    queryFn: async (): Promise<TribeListItem[]> => {
      const res = await getEvents({ type: "TribeCreatedEvent", limit: 200, order: "desc" });
      return res.events.map((ev) => ({
        id: ev.event_data.tribe_id as string,
        name: ev.event_data.name as string,
        inGameTribeId: Number(ev.event_data.in_game_tribe_id ?? 0),
        leaderCharacterId: ev.event_data.leader_character_id as string,
      }));
    },
    refetchInterval: options?.refetchInterval,
  });

  return { tribes: data ?? [], isLoading, error };
}
