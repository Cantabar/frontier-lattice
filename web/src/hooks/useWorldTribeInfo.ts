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
 */

import { useQuery } from "@tanstack/react-query";
import { config } from "../config";
import type { WorldTribeInfo } from "../lib/types";

interface TribeApiResponse {
  data: WorldTribeInfo[];
  metadata: { total: number; limit: number; offset: number };
}

const PAGE_SIZE = 100;
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
// Fetch with localStorage merge
// ---------------------------------------------------------------------------

async function fetchAllTribes(): Promise<Map<number, WorldTribeInfo>> {
  // Start with whatever is already persisted
  const cached = loadFromStorage();

  const fetched = new Map<number, WorldTribeInfo>();
  let page = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = `${config.worldApiUrl}/v2/tribes?page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) break;

    const body: TribeApiResponse = await res.json();
    for (const tribe of body.data) {
      fetched.set(tribe.id, tribe);
    }

    // Check if we've fetched all entries
    if (body.data.length < PAGE_SIZE || fetched.size >= body.metadata.total) break;
    page++;
  }

  // Merge: new API data wins, but keep any cached entries the API didn't return
  // (shouldn't happen, but defensive)
  if (fetched.size > 0) {
    for (const [id, tribe] of fetched) {
      cached.set(id, tribe);
    }
    saveToStorage(cached);
  }

  return cached;
}

export function useWorldTribeInfo() {
  const { data, isLoading } = useQuery({
    queryKey: ["worldTribeInfo"],
    queryFn: fetchAllTribes,
    staleTime: Infinity, // tribe names never change after creation
    gcTime: Infinity,
    retry: 1,
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
