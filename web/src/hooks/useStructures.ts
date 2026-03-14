/**
 * Hook for querying Smart Assemblies (structures) owned by the current player.
 *
 * On-chain, different structure kinds have separate Move types — Assembly,
 * StorageUnit, Gate and Turret — each with their own OwnerCap<T>.
 * OwnerCaps are transferred to the player's Character object (not the wallet),
 * so we query for objects owned by the Character ID.
 */

import { useMemo } from "react";
import { useSuiClientQueries } from "@mysten/dapp-kit";
import { useIdentity } from "./useIdentity";
import { config } from "../config";
import type { AssemblyData, AssemblyStatus, StructureMoveType } from "../lib/types";

const worldPkg = () => config.packages.world;

/** Move module::Type pairs whose OwnerCaps represent player structures. */
const STRUCTURE_TYPES = [
  "assembly::Assembly",
  "storage_unit::StorageUnit",
  "gate::Gate",
  "turret::Turret",
] as const;

/** Maps STRUCTURE_TYPES index → StructureMoveType. */
const MOVE_TYPE_BY_INDEX: StructureMoveType[] = [
  "Assembly",
  "StorageUnit",
  "Gate",
  "Turret",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAssemblyStatus(raw: unknown): AssemblyStatus {
  // On-chain the field is `AssemblyStatus { status: Status }` where Status is
  // an enum with variants NULL, OFFLINE, ONLINE.  SUI RPC serialises this as:
  //   { type: "...::AssemblyStatus", fields: { status: { variant: "ONLINE", ... } } }
  // Unwrap the outer struct to reach the inner Status enum.
  let target = raw;
  if (typeof target === "object" && target !== null) {
    const outer = target as Record<string, unknown>;
    if (outer.fields && typeof outer.fields === "object") {
      const inner = (outer.fields as Record<string, unknown>).status;
      if (inner !== undefined) target = inner;
    }
  }

  // Normalise: accept { variant: "ONLINE" } objects or plain strings, case-insensitive.
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

interface MetadataFields {
  name?: string;
  description?: string;
  url?: string;
}

function parseAssemblyFields(
  objectId: string,
  ownerCapId: string,
  ownerCapVersion: string,
  ownerCapDigest: string,
  moveType: StructureMoveType,
  fields: Record<string, unknown>,
): AssemblyData {
  const metaOuter = fields.metadata as { fields?: MetadataFields } | null;
  const meta = metaOuter?.fields;

  // Parse extension: Option<TypeName> → string | null
  // SUI RPC serialises as null or { fields: { name: "..." } }
  let extension: string | null = null;
  if (fields.extension != null) {
    const ext = fields.extension as { fields?: { name?: string } };
    extension = ext.fields?.name ?? null;
  }

  return {
    id: objectId,
    ownerCapId,
    ownerCapVersion,
    ownerCapDigest,
    typeId: Number(fields.type_id ?? 0),
    status: parseAssemblyStatus(fields.status),
    moveType,
    name: meta?.name || "",
    description: meta?.description || "",
    imageUrl: meta?.url || "",
    energySourceId: fields.energy_source_id
      ? String(fields.energy_source_id)
      : null,
    extension,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMyStructures() {
  const { characterId } = useIdentity();
  const pkg = worldPkg();
  const enabled = !!characterId && pkg !== "0x0";

  // Step 1: Query OwnerCap<T> objects owned by the Character (not the wallet)
  const capResults = useSuiClientQueries({
    queries: enabled
      ? STRUCTURE_TYPES.map((t) => ({
          method: "getOwnedObjects" as const,
          params: {
            owner: characterId,
            filter: { StructType: `${pkg}::access::OwnerCap<${pkg}::${t}>` },
            options: { showContent: true, showOwner: true },
          },
        }))
      : [],
    combine: (results) => ({
      // Tag each object with its STRUCTURE_TYPES index so we know the Move type.
      data: results.flatMap((r, idx) =>
        (r.data?.data ?? []).map((obj) => ({ obj, moveTypeIdx: idx })),
      ),
      isLoading: results.some((r) => r.isLoading),
      error: results.find((r) => r.error)?.error ?? null,
      refetch: () => results.forEach((r) => r.refetch()),
    }),
  });

  // Extract cap ID → assembly ID mappings (with Move type + version/digest for Receiving<T>)
  const capMappings = useMemo(() => {
    if (!capResults.data) return [];
    return capResults.data
      .map(({ obj, moveTypeIdx }) => {
        const data = obj.data;
        const fields = (data?.content as { fields?: Record<string, unknown> })?.fields;
        if (!fields || !data) return null;
        return {
          capId: data.objectId,
          capVersion: data.version ?? "",
          capDigest: data.digest ?? "",
          assemblyId: String(fields.authorized_object_id ?? ""),
          moveType: MOVE_TYPE_BY_INDEX[moveTypeIdx],
        };
      })
      .filter(
        (m): m is {
          capId: string;
          capVersion: string;
          capDigest: string;
          assemblyId: string;
          moveType: StructureMoveType;
        } => m !== null && !!m.assemblyId,
      );
  }, [capResults.data]);

  // Step 2: Batch-fetch each shared structure object
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
      refetch: () => results.forEach((r) => r.refetch()),
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
        const cap = capMappings[i];
        return parseAssemblyFields(
          obj.data.objectId,
          cap.capId,
          cap.capVersion,
          cap.capDigest,
          cap.moveType,
          fields,
        );
      })
      .filter((s): s is AssemblyData => s !== null);
  }, [assemblyResults.data, capMappings]);

  return {
    structures,
    isLoading: capResults.isLoading || assemblyResults.isLoading,
    error: capResults.error ?? assemblyResults.error,
    refetch: () => {
      capResults.refetch();
      assemblyResults.refetch();
    },
  };
}
