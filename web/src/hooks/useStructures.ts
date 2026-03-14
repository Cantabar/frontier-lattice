/**
 * Hook for querying Smart Assemblies (structures) owned by the current wallet.
 *
 * Ownership is represented by OwnerCap<Assembly> objects (wallet-owned).
 * Each OwnerCap points to a shared Assembly object via `authorized_object_id`.
 * We query for the caps first, then batch-fetch the Assembly objects.
 */

import { useMemo } from "react";
import { useSuiClientQuery, useSuiClientQueries } from "@mysten/dapp-kit";
import { useIdentity } from "./useIdentity";
import { config } from "../config";
import type { AssemblyData, AssemblyStatus } from "../lib/types";

const worldPkg = () => config.packages.world;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAssemblyStatus(raw: unknown): AssemblyStatus {
  if (typeof raw === "object" && raw !== null) {
    if ("Online" in raw) return "Online";
    if ("Offline" in raw) return "Offline";
    if ("Unanchoring" in raw) return "Unanchoring";
  }
  if (raw === "Online") return "Online";
  if (raw === "Offline") return "Offline";
  if (raw === "Unanchoring") return "Unanchoring";
  return "Anchored";
}

interface MetadataFields {
  name?: string;
  description?: string;
  url?: string;
}

function parseAssemblyFields(
  objectId: string,
  ownerCapId: string,
  fields: Record<string, unknown>,
): AssemblyData {
  const metaOuter = fields.metadata as { fields?: MetadataFields } | null;
  const meta = metaOuter?.fields;

  return {
    id: objectId,
    ownerCapId,
    typeId: Number(fields.type_id ?? 0),
    status: parseAssemblyStatus(fields.status),
    name: meta?.name || "",
    description: meta?.description || "",
    imageUrl: meta?.url || "",
    energySourceId: fields.energy_source_id
      ? String(fields.energy_source_id)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMyStructures() {
  const { address } = useIdentity();
  const pkg = worldPkg();
  const enabled = !!address && pkg !== "0x0";

  // Step 1: Query wallet-owned OwnerCap<Assembly> objects
  const {
    data: capData,
    isLoading: capsLoading,
    error: capsError,
    refetch,
  } = useSuiClientQuery(
    "getOwnedObjects",
    {
      owner: address,
      filter: {
        StructType: `${pkg}::access::OwnerCap<${pkg}::assembly::Assembly>`,
      },
      options: { showContent: true },
    },
    { enabled },
  );

  // Extract cap ID → assembly ID mappings
  const capMappings = useMemo(() => {
    if (!capData?.data) return [];
    return capData.data
      .map((obj) => {
        const fields = (obj.data?.content as { fields?: Record<string, unknown> })?.fields;
        if (!fields) return null;
        return {
          capId: obj.data!.objectId,
          assemblyId: String(fields.authorized_object_id ?? ""),
        };
      })
      .filter((m): m is { capId: string; assemblyId: string } => m !== null && !!m.assemblyId);
  }, [capData]);

  // Step 2: Batch-fetch each Assembly shared object
  const assemblyResults = useSuiClientQueries({
    queries: capMappings.length > 0
      ? capMappings.map((m) => ({
          method: "getObject" as const,
          params: { id: m.assemblyId, options: { showContent: true } },
        }))
      : [],
    combine: (results) => ({
      data: results.map((r) => r.data),
      isLoading: results.some((r) => r.isLoading),
      error: results.find((r) => r.error)?.error ?? null,
    }),
  });

  // Step 3: Parse into AssemblyData[]
  const structures = useMemo(() => {
    if (!assemblyResults.data) return [];
    return assemblyResults.data
      .map((obj, i) => {
        if (!obj?.data) return null;
        const fields = (obj.data.content as { fields?: Record<string, unknown> })?.fields;
        if (!fields) return null;
        return parseAssemblyFields(
          obj.data.objectId,
          capMappings[i].capId,
          fields,
        );
      })
      .filter((s): s is AssemblyData => s !== null);
  }, [assemblyResults.data, capMappings]);

  return {
    structures,
    isLoading: capsLoading || assemblyResults.isLoading,
    error: capsError ?? assemblyResults.error,
    refetch,
  };
}
