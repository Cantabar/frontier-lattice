import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSuiClient } from "@mysten/dapp-kit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENERGY_TABLE_PARENT =
  "0x885c80a9c99b4fd24a0026981cceb73ebdc519b59656adfbbcce0061a87a1ed9";

const STORAGE_KEY = "frontier-corm:energy-map";

const QUERY_KEY = ["energy-map"] as const;

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function readCache(): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, number>;
  } catch {
    return null;
  }
}

function writeCache(map: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // private browsing / storage quota — safe to skip
  }
}

function removeCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private browsing / storage quota — safe to skip
  }
}

// ---------------------------------------------------------------------------
// Pure export
// ---------------------------------------------------------------------------

export function formatEnergyDisplay(
  typeId: number,
  energyMap: Map<number, number>,
): string {
  const value = energyMap.get(typeId);
  if (value === undefined) return "⚡ — GJ";
  return `⚡ ${value} GJ`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEnergyMap(): {
  energyMap: Map<number, number>;
  isLoading: boolean;
  error: Error | null;
  clearCache: () => void;
} {
  const suiClient = useSuiClient();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery<Record<string, number>>({
    queryKey: QUERY_KEY,
    staleTime: Infinity,
    gcTime: Infinity,

    queryFn: async () => {
      const cached = readCache();
      if (cached) return cached;

      const fieldResult = await suiClient.getDynamicFields({
        parentId: ENERGY_TABLE_PARENT,
      });

      if (fieldResult.hasNextPage) {
        console.warn(
          "useEnergyMap: energy table has more than 50 entries — implement cursor pagination",
        );
      }

      const entries = fieldResult.data ?? [];

      const typeIds: string[] = entries.map((e) => String(e.name.value));
      const objectIds: string[] = entries.map((e) => e.objectId);

      if (objectIds.length === 0) {
        const empty: Record<string, number> = {};
        writeCache(empty);
        return empty;
      }

      const objects = await suiClient.multiGetObjects({
        ids: objectIds,
        options: { showContent: true },
      });

      const record: Record<string, number> = {};

      objects.forEach((obj, i) => {
        try {
          const fields = (
            obj?.data?.content as
              | { fields?: { value?: unknown } }
              | null
              | undefined
          )?.fields;

          if (!fields || fields.value === undefined || fields.value === null) {
            return; // skip malformed
          }

          const energy = Number(fields.value);
          if (Number.isNaN(energy)) return;

          record[typeIds[i]] = energy;
        } catch {
          // skip any individual parse error
        }
      });

      writeCache(record);
      return record;
    },
  });

  const energyMap = useMemo<Map<number, number>>(() => {
    if (!data) return new Map();
    const map = new Map<number, number>();
    for (const [key, value] of Object.entries(data)) {
      const numKey = Number(key);
      if (!Number.isNaN(numKey)) {
        map.set(numKey, value);
      }
    }
    return map;
  }, [data]);

  const clearCache = useCallback(() => {
    removeCache();
    queryClient.removeQueries({ queryKey: QUERY_KEY });
    refetch();
  }, [queryClient, refetch]);

  return {
    energyMap,
    isLoading,
    error: error as Error | null,
    clearCache,
  };
}
