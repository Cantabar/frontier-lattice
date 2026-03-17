/**
 * Hooks for reading Trustless Contracts data.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSuiClient, useSuiClientQuery } from "@mysten/dapp-kit";
import { config } from "../config";
import { getTrustlessContractHistory } from "../lib/indexer";
import type {
  PaginationParams,
  TrustlessContractData,
  TrustlessContractType,
  TrustlessContractStatus,
} from "../lib/types";

const pkg = config.packages.trustlessContracts;

// ---------------------------------------------------------------------------
// Helpers to parse Sui event/object JSON into typed data
// ---------------------------------------------------------------------------

function parseContractType(raw: Record<string, unknown>): TrustlessContractType {
  // The on-chain ContractType enum is serialised as { variant: "CoinForCoin", fields: {...} }
  // or as a direct JSON structure depending on the RPC response format.
  const variant = raw.variant as string | undefined;

  if (variant === "CoinForCoin" || ("CoinForCoin" in raw)) {
    const f = (raw.fields ?? raw.CoinForCoin ?? raw) as Record<string, unknown>;
    return {
      variant: "CoinForCoin",
      offeredAmount: String(f.offered_amount ?? "0"),
      wantedAmount: String(f.wanted_amount ?? "0"),
    };
  }
  if (variant === "CoinForItem" || ("CoinForItem" in raw)) {
    const f = (raw.fields ?? raw.CoinForItem ?? raw) as Record<string, unknown>;
    return {
      variant: "CoinForItem",
      offeredAmount: String(f.offered_amount ?? "0"),
      wantedTypeId: Number(f.wanted_type_id ?? 0),
      wantedQuantity: Number(f.wanted_quantity ?? 0),
      destinationSsuId: String(f.destination_ssu_id ?? ""),
    };
  }
  if (variant === "ItemForCoin" || ("ItemForCoin" in raw)) {
    const f = (raw.fields ?? raw.ItemForCoin ?? raw) as Record<string, unknown>;
    return {
      variant: "ItemForCoin",
      offeredTypeId: Number(f.offered_type_id ?? 0),
      offeredQuantity: Number(f.offered_quantity ?? 0),
      sourceSsuId: String(f.source_ssu_id ?? ""),
      wantedAmount: String(f.wanted_amount ?? "0"),
    };
  }
  if (variant === "ItemForItem" || ("ItemForItem" in raw)) {
    const f = (raw.fields ?? raw.ItemForItem ?? raw) as Record<string, unknown>;
    return {
      variant: "ItemForItem",
      offeredTypeId: Number(f.offered_type_id ?? 0),
      offeredQuantity: Number(f.offered_quantity ?? 0),
      sourceSsuId: String(f.source_ssu_id ?? ""),
      wantedTypeId: Number(f.wanted_type_id ?? 0),
      wantedQuantity: Number(f.wanted_quantity ?? 0),
      destinationSsuId: String(f.destination_ssu_id ?? ""),
    };
  }
  if (variant === "Transport" || ("Transport" in raw)) {
    const f = (raw.fields ?? raw.Transport ?? raw) as Record<string, unknown>;
    return {
      variant: "Transport",
      itemTypeId: Number(f.item_type_id ?? 0),
      itemQuantity: Number(f.item_quantity ?? 0),
      sourceSsuId: String(f.source_ssu_id ?? ""),
      destinationSsuId: String(f.destination_ssu_id ?? ""),
      paymentAmount: String(f.payment_amount ?? "0"),
      requiredStake: String(f.required_stake ?? "0"),
    };
  }

  // Fallback
  return { variant: "CoinForCoin", offeredAmount: "0", wantedAmount: "0" };
}

function parseStatus(raw: unknown): TrustlessContractStatus {
  if (typeof raw === "object" && raw !== null) {
    const variant = (raw as Record<string, unknown>).variant as string | undefined;
    if (variant === "Completed" || "Completed" in raw) return "Completed";
    if (variant === "InProgress" || "InProgress" in raw) return "InProgress";
  }
  if (raw === "Completed") return "Completed";
  if (raw === "InProgress") return "InProgress";
  return "Open";
}

/** Extract contract variant from a Move struct type name (e.g. "…::coin_for_coin::CoinForCoinContract<…>"). */
function variantFromMoveType(moveType: string): string {
  if (moveType.includes("::coin_for_coin::")) return "CoinForCoin";
  if (moveType.includes("::coin_for_item::")) return "CoinForItem";
  if (moveType.includes("::item_for_coin::")) return "ItemForCoin";
  if (moveType.includes("::item_for_item::")) return "ItemForItem";
  if (moveType.includes("::transport::")) return "Transport";
  return "CoinForCoin"; // fallback
}

/** Map fully-qualified event type suffix → contract variant for creation events. */
function variantFromEventType(eventType: string): string {
  if (eventType.includes("CoinForCoinCreatedEvent")) return "CoinForCoin";
  if (eventType.includes("CoinForItemCreatedEvent")) return "CoinForItem";
  if (eventType.includes("ItemForCoinCreatedEvent")) return "ItemForCoin";
  if (eventType.includes("ItemForItemCreatedEvent")) return "ItemForItem";
  if (eventType.includes("TransportCreatedEvent")) return "Transport";
  return "CoinForCoin"; // fallback
}

/** Build a TrustlessContractType from a creation event's fields + detected variant. */
function contractTypeFromEvent(variant: string, d: Record<string, unknown>): TrustlessContractType {
  switch (variant) {
    case "CoinForCoin":
      return { variant: "CoinForCoin", offeredAmount: String(d.offered_amount ?? "0"), wantedAmount: String(d.wanted_amount ?? "0") };
    case "CoinForItem":
      return { variant: "CoinForItem", offeredAmount: String(d.escrow_amount ?? "0"), wantedTypeId: Number(d.wanted_type_id ?? 0), wantedQuantity: Number(d.wanted_quantity ?? 0), destinationSsuId: String(d.destination_ssu_id ?? "") };
    case "ItemForCoin":
      return { variant: "ItemForCoin", offeredTypeId: Number(d.offered_type_id ?? 0), offeredQuantity: Number(d.offered_quantity ?? 0), sourceSsuId: String(d.source_ssu_id ?? ""), wantedAmount: String(d.wanted_amount ?? "0") };
    case "ItemForItem":
      return { variant: "ItemForItem", offeredTypeId: Number(d.offered_type_id ?? 0), offeredQuantity: Number(d.offered_quantity ?? 0), sourceSsuId: String(d.source_ssu_id ?? ""), wantedTypeId: Number(d.wanted_type_id ?? 0), wantedQuantity: Number(d.wanted_quantity ?? 0), destinationSsuId: String(d.destination_ssu_id ?? "") };
    case "Transport":
      return { variant: "Transport", itemTypeId: Number(d.item_type_id ?? 0), itemQuantity: Number(d.item_quantity ?? 0), sourceSsuId: String(d.source_ssu_id ?? ""), destinationSsuId: String(d.destination_ssu_id ?? ""), paymentAmount: String(d.payment_amount ?? "0"), requiredStake: String(d.stake_amount ?? "0") };
    default:
      return { variant: "CoinForCoin", offeredAmount: "0", wantedAmount: "0" };
  }
}

function eventToContract(ev: { type: string; parsedJson?: unknown; id: { txDigest: string } }): TrustlessContractData {
  const d = (ev.parsedJson as Record<string, unknown>) ?? {};
  const variant = variantFromEventType(ev.type);

  return {
    id: String(d.contract_id ?? ev.id.txDigest),
    posterId: String(d.poster_id ?? ""),
    posterAddress: "",
    contractType: contractTypeFromEvent(variant, d),
    escrowAmount: String(d.escrow_amount ?? d.offered_amount ?? d.payment_amount ?? "0"),
    targetQuantity: String(d.target_quantity ?? "0"),
    filledQuantity: "0",
    allowPartial: Boolean(d.allow_partial),
    requireStake: variant === "Transport",
    stakeAmount: String(d.stake_amount ?? "0"),
    deadlineMs: String(d.deadline_ms ?? "0"),
    status: "Open",
    allowedCharacters: (d.allowed_characters as string[]) ?? [],
    allowedTribes: (d.allowed_tribes as number[]) ?? [],
    useOwnerInventory: d.use_owner_inventory != null ? Boolean(d.use_owner_inventory) : undefined,
  };
}

function objectToContract(objectId: string, fields: Record<string, unknown>, moveType?: string): TrustlessContractData {
  const ct = (fields.contract_type as Record<string, unknown>) ?? {};
  let status = parseStatus(fields.status);

  // Infer Completed for pre-upgrade contracts that were fully filled
  // but still have status Open (before the Completed variant existed)
  const filled = BigInt(String(fields.filled_quantity ?? "0"));
  const target = BigInt(String(fields.target_quantity ?? "0"));
  if (status === "Open" && target > 0n && filled >= target) {
    status = "Completed";
  }

  // On-chain contract structs are flat (no nested contract_type field).
  // When contract_type is absent, infer the variant from the Move type name
  // and build the contract type from the top-level fields.
  const hasContractType = Object.keys(ct).length > 0;
  const contractType = hasContractType
    ? parseContractType(ct)
    : contractTypeFromEvent(variantFromMoveType(moveType ?? ""), fields as Record<string, unknown>);

  return {
    id: objectId,
    posterId: String(fields.poster_id ?? ""),
    posterAddress: String(fields.poster_address ?? ""),
    contractType,
    escrowAmount: String(fields.escrow_amount ?? "0"),
    targetQuantity: String(fields.target_quantity ?? "0"),
    filledQuantity: String(fields.filled_quantity ?? "0"),
    allowPartial: Boolean(fields.allow_partial),
    requireStake: Boolean(fields.require_stake),
    stakeAmount: String(fields.stake_amount ?? "0"),
    deadlineMs: String(fields.deadline_ms ?? "0"),
    status,
    courierId: fields.courier_id ? String(fields.courier_id) : undefined,
    courierAddress: fields.courier_address ? String(fields.courier_address) : undefined,
    allowedCharacters: (fields.allowed_characters as string[]) ?? [],
    allowedTribes: (fields.allowed_tribes as number[]) ?? [],
    itemsReleased: fields.items_released != null ? Number(fields.items_released) : undefined,
    useOwnerInventory: fields.use_owner_inventory != null ? Boolean(fields.use_owner_inventory) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Per-module creation event types to query. */
const CREATION_EVENT_TYPES = [
  `${pkg}::coin_for_coin::CoinForCoinCreatedEvent`,
  `${pkg}::coin_for_item::CoinForItemCreatedEvent`,
  `${pkg}::item_for_coin::ItemForCoinCreatedEvent`,
  `${pkg}::item_for_item::ItemForItemCreatedEvent`,
  `${pkg}::transport::TransportCreatedEvent`,
];

/** Fetch active contracts from on-chain creation event emissions,
 *  enriched with live object state (filled_quantity, status). */
export function useActiveContracts() {
  const client = useSuiClient();

  // Query all creation event types in parallel and merge results
  const { data, isLoading: eventsLoading, error, refetch } = useQuery({
    queryKey: ["trustlessCreationEvents", pkg],
    queryFn: async () => {
      const results = await Promise.all(
        CREATION_EVENT_TYPES.map((eventType) =>
          client.queryEvents({ query: { MoveEventType: eventType }, limit: 50, order: "descending" }),
        ),
      );
      // Merge all events and sort by timestamp descending
      return results
        .flatMap((r) => r.data)
        .sort((a, b) => Number(b.timestampMs ?? 0) - Number(a.timestampMs ?? 0));
    },
    enabled: pkg !== "0x0",
    refetchInterval: 15_000,
  });

  const eventContracts: TrustlessContractData[] = (data ?? []).map(eventToContract);
  const contractIds = eventContracts.map((c) => c.id).filter((id) => id.startsWith("0x"));

  // Batch-fetch live object state so filled_quantity & status are current
  const { data: liveObjects, isLoading: objectsLoading } = useQuery({
    queryKey: ["contractLiveState", contractIds],
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
    const liveMap = new Map<string, { fields: Record<string, unknown>; moveType: string }>();
    for (const obj of liveObjects) {
      if (obj.data?.objectId) {
        const content = obj.data.content as { fields?: Record<string, unknown>; type?: string } | undefined;
        const fields = content?.fields;
        const moveType = content?.type ?? "";
        if (fields) liveMap.set(obj.data.objectId, { fields, moveType });
      }
    }
    return eventContracts
      .map((ec) => {
        const live = liveMap.get(ec.id);
        return live ? objectToContract(ec.id, live.fields, live.moveType) : ec;
      })
      // Exclude contracts whose objects were deleted (cleaned up)
      .filter((ec) => liveMap.has(ec.id));
  }, [eventContracts, liveObjects]);

  return { contracts, isLoading: eventsLoading || objectsLoading, error, refetch };
}

/** Fetch a single contract shared object for live state (balances, filled qty). */
export function useContractObject(contractId: string | undefined) {
  const { data, isLoading, error } = useSuiClientQuery(
    "getObject",
    {
      id: contractId!,
      options: { showContent: true },
    },
    { enabled: !!contractId, refetchInterval: 10_000 },
  );

  const objectId = data?.data?.objectId ?? "";
  const content = data?.data?.content as { fields?: Record<string, unknown>; type?: string } | undefined;
  const fields = content?.fields;
  const moveType = content?.type ?? "";
  const contract = fields && objectId ? objectToContract(objectId, fields, moveType) : null;

  return { contract, isLoading, error };
}

/** Fetch contract history (completed/cancelled/expired) from indexer. */
export function useContractHistory(params: PaginationParams = {}) {
  return useQuery({
    queryKey: ["contractHistory", params],
    queryFn: () => getTrustlessContractHistory(params),
  });
}
