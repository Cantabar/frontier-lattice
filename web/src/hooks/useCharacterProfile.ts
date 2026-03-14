/**
 * Hooks to resolve on-chain Character objects into display-friendly profiles.
 *
 * Character objects (from world-contracts) are shared SUI objects containing
 * a `metadata` field with `name`, `description`, and `url` (portrait).
 */

import { useMemo } from "react";
import { useSuiClientQuery, useSuiClientQueries } from "@mysten/dapp-kit";
import { config } from "../config";
import type { CharacterProfile } from "../lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CharacterFields {
  tribe_id?: string | number;
  metadata?: {
    fields?: {
      name?: string;
      url?: string;
    };
  };
}

function parseCharacterProfile(
  objectId: string,
  content: unknown,
): CharacterProfile | null {
  const fields = (content as { fields?: CharacterFields })?.fields;
  if (!fields) return null;

  const meta = fields.metadata?.fields;
  return {
    characterId: objectId,
    name: meta?.name || "",
    portraitUrl: meta?.url || "",
    tribeId: Number(fields.tribe_id ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Single lookup
// ---------------------------------------------------------------------------

export function useCharacterProfile(characterId: string | null): {
  profile: CharacterProfile | null;
  isLoading: boolean;
} {
  const { data, isLoading } = useSuiClientQuery(
    "getObject",
    { id: characterId!, options: { showContent: true } },
    { enabled: !!characterId && config.packages.world !== "0x0" },
  );

  const profile = useMemo(() => {
    if (!data?.data) return null;
    return parseCharacterProfile(data.data.objectId, data.data.content);
  }, [data]);

  return { profile, isLoading };
}

// ---------------------------------------------------------------------------
// Batch lookup – for list views (MemberList, Leaderboard, etc.)
// ---------------------------------------------------------------------------

export function useCharacterProfiles(
  characterIds: string[],
): {
  profiles: Map<string, CharacterProfile>;
  isLoading: boolean;
} {
  const unique = useMemo(
    () => [...new Set(characterIds.filter(Boolean))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [characterIds.join(",")],
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

  const profiles = useMemo(() => {
    const map = new Map<string, CharacterProfile>();
    if (!results.data) return map;
    results.data.forEach((obj, i) => {
      if (!obj?.data) return;
      const profile = parseCharacterProfile(unique[i], obj.data.content);
      if (profile) map.set(unique[i], profile);
    });
    return map;
  }, [results.data, unique]);

  return { profiles, isLoading: results.isLoading };
}
