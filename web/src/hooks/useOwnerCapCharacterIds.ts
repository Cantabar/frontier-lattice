/**
 * Resolves OwnerCap<Character> object IDs → Character object IDs.
 *
 * On-chain, player inventories inside an SSU are keyed by the player's
 * OwnerCap<Character> ID (from Character.owner_cap_id). To display the
 * character name we need to map OwnerCap → authorized_object_id (the
 * Character ID), then fetch the Character object for metadata.
 *
 * This hook performs the first step: batch-fetching OwnerCap objects and
 * extracting their `authorized_object_id` field.
 */

import { useMemo } from "react";
import { useSuiClientQueries } from "@mysten/dapp-kit";
import { config } from "../config";

export function useOwnerCapCharacterIds(
  ownerCapIds: string[],
): {
  /** Map from OwnerCap<Character> ID → Character object ID */
  capToCharacter: Map<string, string>;
  isLoading: boolean;
} {
  const unique = useMemo(
    () => [...new Set(ownerCapIds.filter(Boolean))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownerCapIds.join(",")],
  );

  const enabled = unique.length > 0 && config.packages.world !== "0x0";

  const results = useSuiClientQueries({
    queries: enabled
      ? unique.map((id) => ({
          method: "getObject" as const,
          params: { id, options: { showContent: true } },
        }))
      : [],
    combine: (results) => ({
      data: results.map((r) => r.data),
      isLoading: results.some((r) => r.isLoading),
    }),
  });

  const capToCharacter = useMemo(() => {
    const map = new Map<string, string>();
    if (!results.data) return map;
    results.data.forEach((obj, i) => {
      if (!obj?.data?.content) return;
      const fields = (obj.data.content as { fields?: Record<string, unknown> })
        ?.fields;
      const authorizedId = fields?.authorized_object_id as string | undefined;
      if (authorizedId) {
        map.set(unique[i], authorizedId);
      }
    });
    return map;
  }, [results.data, unique]);

  return { capToCharacter, isLoading: results.isLoading };
}
