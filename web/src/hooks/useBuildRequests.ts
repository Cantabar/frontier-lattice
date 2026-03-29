/**
 * Hooks for reading Build Request (Witnessed) Contracts data.
 *
 * Follows the same pattern as useContracts.ts:
 *   1. Query creation events to discover contract IDs
 *   2. Batch-fetch live object state via multiGetObjects
 *   3. Merge into BuildRequestContractData[]
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSuiClient, useSuiClientQuery } from "@mysten/dapp-kit";
import { config } from "../config";
import type { BuildRequestContractData, BuildRequestStatus } from "../lib/types";
import { extractCoinTypeFromObjectType } from "../lib/coinUtils";

const pkg = config.packages.witnessedContracts;

// ---------------------------------------------------------------------------
// Helpers to parse Sui event/object JSON into typed data
// ---------------------------------------------------------------------------

function parseStatus(raw: unknown): BuildRequestStatus {
  if (typeof raw === "object" && raw !== null) {
    const variant = (raw as Record<string, unknown>).variant as string | undefined;
    if (variant === "Completed" || "Completed" in raw) return "Completed";
  }
  if (raw === "Completed") return "Completed";
  return "Open";
}

function eventToContract(ev: {
  type: string;
  parsedJson?: unknown;
  id: { txDigest: string };
}): BuildRequestContractData {
  const d = (ev.parsedJson as Record<string, unknown>) ?? {};
  return {
    id: String(d.contract_id ?? ev.id.txDigest),
    posterId: String(d.poster_id ?? ""),
    posterAddress: "",
    bountyAmount: String(d.bounty_amount ?? "0"),
    requestedTypeId: Number(d.requested_type_id ?? 0),
    requireCormAuth: Boolean(d.require_corm_auth),
    deadlineMs: String(d.deadline_ms ?? "0"),
    status: "Open",
    allowedCharacters: (d.allowed_characters as string[]) ?? [],
    allowedTribes: (d.allowed_tribes as number[]) ?? [],
  };
}

function objectToContract(
  objectId: string,
  fields: Record<string, unknown>,
  moveType?: string,
): BuildRequestContractData {
  const coinType = moveType
    ? extractCoinTypeFromObjectType(moveType) ?? undefined
    : undefined;

  return {
    id: objectId,
    posterId: String(fields.poster_id ?? ""),
    posterAddress: String(fields.poster_address ?? ""),
    bountyAmount: String(fields.bounty_amount ?? "0"),
    requestedTypeId: Number(fields.requested_type_id ?? 0),
    requireCormAuth: Boolean(fields.require_corm_auth),
    builderAddress: fields.builder_address
      ? String(fields.builder_address)
      : undefined,
    structureId: fields.structure_id
      ? String(fields.structure_id)
      : undefined,
    deadlineMs: String(fields.deadline_ms ?? "0"),
    status: parseStatus(fields.status),
    allowedCharacters: (fields.allowed_characters as string[]) ?? [],
    allowedTribes: (fields.allowed_tribes as number[]) ?? [],
    referenceStructureId: fields.reference_structure_id
      ? String(fields.reference_structure_id)
      : undefined,
    maxDistance:
      fields.max_distance != null ? Number(fields.max_distance) : undefined,
    proximityTribeId: fields.proximity_tribe_id
      ? String(fields.proximity_tribe_id)
      : undefined,
    coinType,
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const CREATION_EVENT_TYPE = `${pkg}::build_request::BuildRequestCreatedEvent`;

/** Fetch active build request contracts from on-chain events + live state. */
export function useActiveBuildRequests() {
  const client = useSuiClient();

  const {
    data,
    isLoading: eventsLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["buildRequestCreationEvents", pkg],
    queryFn: async () => {
      const result = await client.queryEvents({
        query: { MoveEventType: CREATION_EVENT_TYPE },
        limit: 50,
        order: "descending",
      });
      return result.data;
    },
    enabled: pkg !== "0x0",
    refetchInterval: 15_000,
  });

  const eventContracts: BuildRequestContractData[] = (data ?? []).map(
    eventToContract,
  );
  const contractIds = eventContracts
    .map((c) => c.id)
    .filter((id) => id.startsWith("0x"));

  // Batch-fetch live object state
  const { data: liveObjects, isLoading: objectsLoading } = useQuery({
    queryKey: ["buildRequestLiveState", contractIds],
    queryFn: () =>
      client.multiGetObjects({
        ids: contractIds,
        options: { showContent: true },
      }),
    enabled: contractIds.length > 0,
    refetchInterval: 15_000,
  });

  const contracts = useMemo(() => {
    if (!liveObjects) return eventContracts;
    const liveMap = new Map<
      string,
      { fields: Record<string, unknown>; moveType: string }
    >();
    for (const obj of liveObjects) {
      if (obj.data?.objectId) {
        const content = obj.data.content as
          | { fields?: Record<string, unknown>; type?: string }
          | undefined;
        const fields = content?.fields;
        const moveType = content?.type ?? "";
        if (fields) liveMap.set(obj.data.objectId, { fields, moveType });
      }
    }
    return eventContracts
      .map((ec) => {
        const live = liveMap.get(ec.id);
        return live
          ? objectToContract(ec.id, live.fields, live.moveType)
          : ec;
      })
      // Exclude deleted objects
      .filter((ec) => liveMap.has(ec.id));
  }, [eventContracts, liveObjects]);

  return {
    contracts,
    isLoading: eventsLoading || objectsLoading,
    error,
    refetch,
  };
}

/** Fetch a single build request contract for the detail page. */
export function useBuildRequestObject(contractId: string | undefined) {
  const { data, isLoading, error } = useSuiClientQuery(
    "getObject",
    {
      id: contractId!,
      options: { showContent: true },
    },
    { enabled: !!contractId, refetchInterval: 10_000 },
  );

  const objectId = data?.data?.objectId ?? "";
  const content = data?.data?.content as
    | { fields?: Record<string, unknown>; type?: string }
    | undefined;
  const fields = content?.fields;
  const moveType = content?.type ?? "";
  const contract =
    fields && objectId
      ? objectToContract(objectId, fields, moveType)
      : null;

  return { contract, isLoading, error };
}
