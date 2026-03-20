/**
 * Hook encapsulating all contract filtering + sorting state and logic.
 *
 * Keeps TrustlessContracts.tsx focused on layout/rendering while this
 * hook owns the filter dimensions, sort order, and derived results.
 */

import { useState, useMemo, useEffect } from "react";
import { canViewContract } from "../lib/contractVisibility";
import { getStructuresByLocationTag, type StructureTagResult } from "../lib/indexer";
import type {
  TrustlessContractData,
  TrustlessContractVariant,
} from "../lib/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type StatusTab = "all" | "Open" | "InProgress" | "Completed";

export type SortKey =
  | "newest"
  | "deadline-asc"
  | "deadline-desc"
  | "reward-high"
  | "reward-low";

export interface ContractFilters {
  // Status & type (top-level controls)
  statusTab: StatusTab;
  setStatusTab: (tab: StatusTab) => void;
  typeFilter: TrustlessContractVariant | "all";
  setTypeFilter: (type: TrustlessContractVariant | "all") => void;

  // Advanced filters
  wantedItemTypeId: number | null;
  setWantedItemTypeId: (id: number | null) => void;
  offeredItemTypeId: number | null;
  setOfferedItemTypeId: (id: number | null) => void;
  posterCharacterId: string | null;
  setPosterCharacterId: (id: string | null) => void;
  filterTribeId: number | null;
  setFilterTribeId: (id: number | null) => void;
  filterRegionId: number | null;
  setFilterRegionId: (id: number | null) => void;
  filterConstellationId: number | null;
  setFilterConstellationId: (id: number | null) => void;

  // Sort
  sortKey: SortKey;
  setSortKey: (key: SortKey) => void;

  // Derived
  filteredAndSorted: TrustlessContractData[];
  activeFilterCount: number;
  clearFilters: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ViewerIdentity {
  characterId: string | null;
  inGameTribeId: number | null;
}

function getWantedItemTypeId(c: TrustlessContractData): number | null {
  const ct = c.contractType;
  if (ct.variant === "CoinForItem") return ct.wantedTypeId;
  if (ct.variant === "ItemForItem") return ct.wantedTypeId;
  return null;
}

function getOfferedItemTypeId(c: TrustlessContractData): number | null {
  const ct = c.contractType;
  if (ct.variant === "ItemForCoin") return ct.offeredTypeId;
  if (ct.variant === "ItemForItem") return ct.offeredTypeId;
  if (ct.variant === "Transport") return ct.itemTypeId;
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useContractFilters(
  contracts: TrustlessContractData[],
  viewer: ViewerIdentity,
): ContractFilters {
  const [statusTab, setStatusTab] = useState<StatusTab>("Open");
  const [typeFilter, setTypeFilter] = useState<TrustlessContractVariant | "all">("all");
  const [wantedItemTypeId, setWantedItemTypeId] = useState<number | null>(null);
  const [offeredItemTypeId, setOfferedItemTypeId] = useState<number | null>(null);
  const [posterCharacterId, setPosterCharacterId] = useState<string | null>(null);
  const [filterTribeId, setFilterTribeId] = useState<number | null>(null);
  const [filterRegionId, setFilterRegionId] = useState<number | null>(null);
  const [filterConstellationId, setFilterConstellationId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  // Fetch structure IDs matching the active region/constellation filter
  const [taggedStructures, setTaggedStructures] = useState<Set<string> | null>(null);
  useEffect(() => {
    const tagType = filterConstellationId != null
      ? "constellation" as const
      : filterRegionId != null
        ? "region" as const
        : null;
    const tagId = filterConstellationId ?? filterRegionId;

    if (!tagType || tagId == null) {
      setTaggedStructures(null);
      return;
    }

    let cancelled = false;
    getStructuresByLocationTag(tagType, tagId)
      .then((res) => {
        if (!cancelled) {
          setTaggedStructures(new Set(res.structures.map((s: StructureTagResult) => s.structure_id)));
        }
      })
      .catch(() => {
        if (!cancelled) setTaggedStructures(new Set());
      });

    return () => { cancelled = true; };
  }, [filterRegionId, filterConstellationId]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (wantedItemTypeId !== null) count++;
    if (offeredItemTypeId !== null) count++;
    if (posterCharacterId !== null) count++;
    if (filterTribeId !== null) count++;
    if (filterRegionId !== null) count++;
    if (filterConstellationId !== null) count++;
    return count;
  }, [wantedItemTypeId, offeredItemTypeId, posterCharacterId, filterTribeId, filterRegionId, filterConstellationId]);

  const filteredAndSorted = useMemo(() => {
    let result = contracts.filter((c) => {
      if (!canViewContract(c, viewer)) return false;
      if (statusTab !== "all" && c.status !== statusTab) return false;
      if (typeFilter !== "all" && c.contractType.variant !== typeFilter) return false;
      if (wantedItemTypeId !== null && getWantedItemTypeId(c) !== wantedItemTypeId) return false;
      if (offeredItemTypeId !== null && getOfferedItemTypeId(c) !== offeredItemTypeId) return false;
      if (posterCharacterId !== null && c.posterId !== posterCharacterId) return false;
      if (filterTribeId !== null) {
        // Show contracts available to the tribe: unrestricted OR explicitly allowing this tribe
        const hasRestriction = c.allowedTribes.length > 0;
        if (hasRestriction && !c.allowedTribes.includes(filterTribeId)) return false;
      }
      // Region/constellation filter: check if source/destination SSU is in the tagged set
      if (taggedStructures !== null) {
        const ct = c.contractType;
        const ssuIds: string[] = [];
        if ("sourceSsuId" in ct && ct.sourceSsuId) ssuIds.push(ct.sourceSsuId);
        if ("destinationSsuId" in ct && ct.destinationSsuId) ssuIds.push(ct.destinationSsuId);
        if (ssuIds.length === 0 || !ssuIds.some((id) => taggedStructures.has(id))) return false;
      }
      return true;
    });

    if (sortKey !== "newest") {
      result = [...result].sort((a, b) => {
        switch (sortKey) {
          case "deadline-asc":
            return Number(a.deadlineMs) - Number(b.deadlineMs);
          case "deadline-desc":
            return Number(b.deadlineMs) - Number(a.deadlineMs);
          case "reward-high":
            return Number(BigInt(b.escrowAmount) - BigInt(a.escrowAmount));
          case "reward-low":
            return Number(BigInt(a.escrowAmount) - BigInt(b.escrowAmount));
          default:
            return 0;
        }
      });
    }

    return result;
  }, [contracts, viewer, statusTab, typeFilter, wantedItemTypeId, offeredItemTypeId, posterCharacterId, filterTribeId, taggedStructures, sortKey]);

  function clearFilters() {
    setWantedItemTypeId(null);
    setOfferedItemTypeId(null);
    setPosterCharacterId(null);
    setFilterTribeId(null);
    setFilterRegionId(null);
    setFilterConstellationId(null);
  }

  return {
    statusTab,
    setStatusTab,
    typeFilter,
    setTypeFilter,
    wantedItemTypeId,
    setWantedItemTypeId,
    offeredItemTypeId,
    setOfferedItemTypeId,
    posterCharacterId,
    setPosterCharacterId,
    filterTribeId,
    setFilterTribeId,
    filterRegionId,
    setFilterRegionId,
    filterConstellationId,
    setFilterConstellationId,
    sortKey,
    setSortKey,
    filteredAndSorted,
    activeFilterCount,
    clearFilters,
  };
}
