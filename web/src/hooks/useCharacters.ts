/**
 * Hook that discovers all characters on the network by scanning
 * CharacterCreatedEvent emissions, then batch-resolves their on-chain
 * profiles (name, portrait, tribe).
 *
 * Follows the same queryEvents pattern as useWorldTribes but exposes
 * individual CharacterProfile entries for use in picker components.
 */

import { useMemo } from "react";
import { useSuiClientQuery, useSuiClientQueries } from "@mysten/dapp-kit";
import { config } from "../config";
import type { CharacterProfile } from "../lib/types";

export function useCharacters() {
  const worldPkg = config.packages.world;
  const enabled = worldPkg !== "0x0";

  // Step 1: Scan CharacterCreatedEvent to discover all character IDs
  const { data: eventData, isLoading: eventsLoading } = useSuiClientQuery(
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

  const characterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ev of eventData?.data ?? []) {
      const parsed = ev.parsedJson as Record<string, unknown> | undefined;
      const charId = parsed?.character_id as string | undefined;
      if (charId) ids.add(charId);
    }
    return [...ids];
  }, [eventData]);

  // Step 2: Batch-resolve profiles from on-chain Character objects
  const profileResults = useSuiClientQueries({
    queries:
      characterIds.length > 0
        ? characterIds.map((id) => ({
            method: "getObject" as const,
            params: { id, options: { showContent: true } },
          }))
        : [],
    combine: (results) => ({
      data: results.map((r) => r.data),
      isLoading: results.some((r) => r.isLoading),
    }),
  });

  const characters = useMemo(() => {
    const list: CharacterProfile[] = [];
    if (!profileResults.data) return list;

    profileResults.data.forEach((obj, i) => {
      if (!obj?.data) return;
      const fields = (obj.data.content as { fields?: Record<string, unknown> })?.fields;
      if (!fields) return;

      const meta = (fields.metadata as { fields?: { name?: string; url?: string } })?.fields;
      list.push({
        characterId: characterIds[i],
        name: meta?.name || "",
        portraitUrl: meta?.url || "",
        tribeId: Number(fields.tribe_id ?? 0),
      });
    });

    list.sort((a, b) => {
      // Named characters first, then by name alpha
      if (a.name && !b.name) return -1;
      if (!a.name && b.name) return 1;
      return a.name.localeCompare(b.name);
    });

    return list;
  }, [profileResults.data, characterIds]);

  return {
    characters,
    isLoading: (enabled && eventsLoading) || profileResults.isLoading,
  };
}
