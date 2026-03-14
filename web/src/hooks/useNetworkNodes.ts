/**
 * Hook for fetching NetworkNode shared objects by ID.
 *
 * Each structure's `energySourceId` points to a shared NetworkNode.
 * This hook batch-fetches those objects so the UI can display node
 * metadata (name, status, fuel level, connected assembly count).
 */

import { useMemo } from "react";
import { useSuiClientQueries } from "@mysten/dapp-kit";
import type { AssemblyStatus, NetworkNodeData } from "../lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseStatus(raw: unknown): AssemblyStatus {
  // On-chain: AssemblyStatus { status: Status } where Status is an enum
  // with uppercase variants (ONLINE, OFFLINE).  Unwrap the outer struct.
  let target = raw;
  if (typeof target === "object" && target !== null) {
    const outer = target as Record<string, unknown>;
    if (outer.fields && typeof outer.fields === "object") {
      const inner = (outer.fields as Record<string, unknown>).status;
      if (inner !== undefined) target = inner;
    }
  }

  let v = "";
  if (typeof target === "string") {
    v = target;
  } else if (typeof target === "object" && target !== null) {
    v = String((target as Record<string, unknown>).variant ?? "");
  }
  const upper = v.toUpperCase();
  if (upper === "ONLINE")  return "Online";
  if (upper === "OFFLINE") return "Offline";
  if (upper === "UNANCHORING") return "Unanchoring";
  return "Anchored";
}

function parseNetworkNode(
  objectId: string,
  fields: Record<string, unknown>,
): NetworkNodeData {
  const metaOuter = fields.metadata as { fields?: { name?: string } } | null;
  const name = metaOuter?.fields?.name || "";

  const fuelOuter = fields.fuel as {
    fields?: { quantity?: unknown; max_capacity?: unknown };
  } | null;
  const fuelQuantity = Number(fuelOuter?.fields?.quantity ?? 0);
  const fuelMaxCapacity = Number(fuelOuter?.fields?.max_capacity ?? 0);

  const energyOuter = fields.energy_source as {
    fields?: {
      max_energy_production?: unknown;
      current_energy_production?: unknown;
      total_reserved_energy?: unknown;
    };
  } | null;
  const maxEnergyProduction = Number(energyOuter?.fields?.max_energy_production ?? 0);
  const currentEnergyProduction = Number(energyOuter?.fields?.current_energy_production ?? 0);
  const totalReservedEnergy = Number(energyOuter?.fields?.total_reserved_energy ?? 0);

  const connectedIds = fields.connected_assembly_ids as unknown[] | null;
  const connectedAssemblyCount = Array.isArray(connectedIds) ? connectedIds.length : 0;

  return {
    id: objectId,
    typeId: Number(fields.type_id ?? 0),
    status: parseStatus(fields.status),
    name,
    fuelQuantity,
    fuelMaxCapacity,
    maxEnergyProduction,
    currentEnergyProduction,
    totalReservedEnergy,
    connectedAssemblyCount,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetches NetworkNode objects for the given IDs.
 *
 * @param nodeIds Unique network node object IDs to fetch.
 * @returns A Map keyed by node ID, plus loading/error state.
 */
export function useNetworkNodes(nodeIds: string[]) {
  const results = useSuiClientQueries({
    queries:
      nodeIds.length > 0
        ? nodeIds.map((id) => ({
            method: "getObject" as const,
            params: { id, options: { showContent: true } },
          }))
        : [],
    combine: (res) => ({
      data: res.map((r) => r.data),
      isLoading: res.some((r) => r.isLoading),
      error: res.find((r) => r.error)?.error ?? null,
      refetch: () => res.forEach((r) => r.refetch()),
    }),
  });

  const nodes = useMemo(() => {
    const map = new Map<string, NetworkNodeData>();
    if (!results.data) return map;
    results.data.forEach((obj, i) => {
      if (!obj?.data) return;
      const fields = (obj.data.content as { fields?: Record<string, unknown> })?.fields;
      if (!fields) return;
      map.set(nodeIds[i], parseNetworkNode(obj.data.objectId, fields));
    });
    return map;
  }, [results.data, nodeIds]);

  return { nodes, isLoading: results.isLoading, error: results.error, refetch: results.refetch };
}
