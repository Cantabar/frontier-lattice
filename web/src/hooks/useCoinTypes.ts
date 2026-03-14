/**
 * Discovers distinct coin types held by the connected wallet.
 *
 * Queries owned objects matching `0x2::coin::Coin<*>` and deduplicates
 * the full coin type strings. Used by CoinTypeSelector to populate
 * the dropdown with coins the user can actually deposit.
 */

import { useCurrentAccount, useSuiClientQuery } from "@mysten/dapp-kit";
import { useMemo } from "react";
import { extractCoinTypeFromObjectType } from "../lib/coinUtils";

export interface CoinTypeEntry {
  /** Full coin type string, e.g. "0x2::sui::SUI" */
  coinType: string;
}

/**
 * Returns the list of distinct coin types the connected wallet owns.
 * Always includes "0x2::sui::SUI" as the first entry.
 */
export function useCoinTypes() {
  const account = useCurrentAccount();
  const address = account?.address ?? "";

  const { data, isLoading } = useSuiClientQuery(
    "getOwnedObjects",
    {
      owner: address,
      filter: { MatchAll: [{ StructType: "0x2::coin::Coin" }] },
      options: { showType: true },
      limit: 50,
    },
    { enabled: !!address },
  );

  const coinTypes: CoinTypeEntry[] = useMemo(() => {
    const seen = new Set<string>();
    // Always include native SUI
    seen.add("0x2::sui::SUI");

    for (const obj of data?.data ?? []) {
      const objType = obj.data?.type;
      if (!objType) continue;
      const ct = extractCoinTypeFromObjectType(objType);
      if (ct) seen.add(ct);
    }

    return Array.from(seen).map((coinType) => ({ coinType }));
  }, [data]);

  return { coinTypes, isLoading };
}

/**
 * Returns owned Coin<C> object IDs for a specific coin type.
 * Used to build merge+split transactions for non-SUI deposits.
 */
export function useCoinObjectIds(coinType: string) {
  const account = useCurrentAccount();
  const address = account?.address ?? "";

  const { data, isLoading } = useSuiClientQuery(
    "getOwnedObjects",
    {
      owner: address,
      filter: { StructType: `0x2::coin::Coin<${coinType}>` },
      options: { showType: true },
      limit: 50,
    },
    { enabled: !!address && !!coinType },
  );

  const objectIds: string[] = useMemo(
    () => (data?.data ?? []).map((o) => o.data?.objectId).filter((id): id is string => !!id),
    [data],
  );

  return { objectIds, isLoading };
}
