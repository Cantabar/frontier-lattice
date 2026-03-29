/**
 * Hook that fetches tribe metadata (name, ticker, description, etc.) from the
 * Eve Frontier Stillness World API and persists it in localStorage.
 *
 * Since tribe names are immutable after creation, we only re-fetch from the API
 * when new tribe IDs are discovered that aren't already cached locally.
 *
 * This is a "backfill" data source — the UI renders immediately with numeric
 * tribe IDs, and the real names appear once the data is available.
 *
 * Gracefully returns an empty map if the API is unreachable (e.g. local-only dev).
 *
 * Uses the individual `/v2/tribes/{id}` endpoint instead of the bulk list
 * endpoint, which has broken pagination on Stillness.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { config } from "../config";
import { mockWorldTribes } from "../lib/mock/data";
import type { WorldTribeInfo } from "../lib/types";

const STORAGE_KEY = "frontier-corm:worldTribeInfo";

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadFromStorage(): Map<number, WorldTribeInfo> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const entries: WorldTribeInfo[] = JSON.parse(raw);
    return new Map(entries.map((t) => [t.id, t]));
  } catch {
    return new Map();
  }
}

function saveToStorage(map: Map<number, WorldTribeInfo>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...map.values()]));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

/**
 * Remove the persisted tribe-info cache from localStorage.
 * Call `queryClient.invalidateQueries({ queryKey: ["worldTribeInfo"] })` after
 * this to trigger a fresh network fetch.
 */
export function clearWorldTribeInfoCache(): string {
  localStorage.removeItem(STORAGE_KEY);
  return STORAGE_KEY;
}

// ---------------------------------------------------------------------------
// Fetch individual tribes with localStorage merge
// ---------------------------------------------------------------------------

/**
 * Fetch metadata for a specific set of tribe IDs. Checks localStorage first
 * and only hits the API for IDs not already cached.
 */
async function fetchTribes(
  tribeIds: number[],
): Promise<Map<number, WorldTribeInfo>> {
  // In local mode, return mock tribe data without hitting any API.
  if (config.appEnv === "local") {
    return new Map(mockWorldTribes.map((t) => [t.id, t]));
  }

  const cached = loadFromStorage();

  // Determine which IDs we still need to fetch
  const missing = tribeIds.filter((id) => id > 0 && !cached.has(id));
  if (missing.length === 0) return cached;

  // Fetch missing IDs individually via /v2/tribes/{id}
  const results = await Promise.allSettled(
    missing.map(async (id) => {
      const res = await fetch(`${config.worldApiUrl}/v2/tribes/${id}`);
      if (!res.ok) return null;
      return (await res.json()) as WorldTribeInfo;
    }),
  );

  let updated = false;
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      cached.set(result.value.id, result.value);
      updated = true;
    }
  }

  if (updated) {
    saveToStorage(cached);
  }

  return cached;
}

export function useWorldTribeInfo(tribeIds: number[]) {
  // Stable query key: sort so order doesn't cause unnecessary refetches
  const sortedIds = useMemo(
    () => [...new Set(tribeIds.filter((id) => id > 0))].sort((a, b) => a - b),
    [tribeIds],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["worldTribeInfo", sortedIds],
    queryFn: () => fetchTribes(sortedIds),
    staleTime: Infinity, // tribe names never change after creation
    gcTime: Infinity,
    retry: 1,
    enabled: sortedIds.length > 0 || config.appEnv === "local",
    // Seed from localStorage immediately so names render before the API call
    initialData: () => {
      const cached = loadFromStorage();
      return cached.size > 0 ? cached : undefined;
    },
    initialDataUpdatedAt: () => {
      // If we have cached data, treat it as "just updated" so it doesn't
      // immediately trigger a refetch. The query still runs once per session
      // to pick up any newly created tribes.
      const cached = loadFromStorage();
      return cached.size > 0 ? Date.now() : 0;
    },
  });

  return { tribeInfo: data ?? new Map<number, WorldTribeInfo>(), isLoading };
}
