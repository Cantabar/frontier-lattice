/**
 * Hook that fetches tribe metadata (name, ticker, description, etc.) from the
 * Eve Frontier Stillness World API and caches it aggressively in the browser.
 *
 * This is a "backfill" data source — the UI renders immediately with numeric
 * tribe IDs, and the real names appear once this query resolves.
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

async function fetchAllTribes(): Promise<Map<number, WorldTribeInfo>> {
  const map = new Map<number, WorldTribeInfo>();
  let page = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = `${config.worldApiUrl}/v2/tribes?page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) break;

    const body: TribeApiResponse = await res.json();
    for (const tribe of body.data) {
      map.set(tribe.id, tribe);
    }

    // Check if we've fetched all entries
    if (body.data.length < PAGE_SIZE || map.size >= body.metadata.total) break;
    page++;
  }

  return map;
}

export function useWorldTribeInfo() {
  const { data, isLoading } = useQuery({
    queryKey: ["worldTribeInfo"],
    queryFn: fetchAllTribes,
    staleTime: Infinity, // tribe names never change after creation
    gcTime: Infinity,
    retry: 1,
    // Silently return empty map on failure — this is a best-effort backfill
    placeholderData: () => new Map<number, WorldTribeInfo>(),
  });

  return { tribeInfo: data ?? new Map<number, WorldTribeInfo>(), isLoading };
}
