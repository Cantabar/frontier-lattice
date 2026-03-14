/**
 * Hooks for reading Trustless Contracts data.
 */

import { useQuery } from "@tanstack/react-query";
import { useSuiClientQuery } from "@mysten/dapp-kit";
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
    if ("InProgress" in raw) return "InProgress";
  }
  if (raw === "InProgress") return "InProgress";
  return "Open";
}

function eventToContract(ev: { parsedJson?: unknown; id: { txDigest: string } }): TrustlessContractData {
  const d = (ev.parsedJson as Record<string, unknown>) ?? {};
  const ct = (d.contract_type as Record<string, unknown>) ?? {};

  return {
    id: String(d.contract_id ?? ev.id.txDigest),
    posterId: String(d.poster_id ?? ""),
    posterAddress: "",
    contractType: parseContractType(ct),
    escrowAmount: String(d.escrow_amount ?? "0"),
    targetQuantity: String(d.target_quantity ?? "0"),
    filledQuantity: "0",
    allowPartial: Boolean(d.allow_partial),
    requireStake: Boolean(d.require_stake),
    stakeAmount: String(d.stake_amount ?? "0"),
    deadlineMs: String(d.deadline_ms ?? "0"),
    status: "Open",
    allowedCharacters: (d.allowed_characters as string[]) ?? [],
    allowedTribes: (d.allowed_tribes as number[]) ?? [],
  };
}

function objectToContract(fields: Record<string, unknown>): TrustlessContractData {
  const ct = (fields.contract_type as Record<string, unknown>) ?? {};
  return {
    id: String(fields.id ?? ""),
    posterId: String(fields.poster_id ?? ""),
    posterAddress: String(fields.poster_address ?? ""),
    contractType: parseContractType(ct),
    escrowAmount: String(fields.escrow_amount ?? "0"),
    targetQuantity: String(fields.target_quantity ?? "0"),
    filledQuantity: String(fields.filled_quantity ?? "0"),
    allowPartial: Boolean(fields.allow_partial),
    requireStake: Boolean(fields.require_stake),
    stakeAmount: String(fields.stake_amount ?? "0"),
    deadlineMs: String(fields.deadline_ms ?? "0"),
    status: parseStatus(fields.status),
    courierId: fields.courier_id ? String(fields.courier_id) : undefined,
    courierAddress: fields.courier_address ? String(fields.courier_address) : undefined,
    allowedCharacters: (fields.allowed_characters as string[]) ?? [],
    allowedTribes: (fields.allowed_tribes as number[]) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Fetch active contracts from on-chain ContractCreatedEvent emissions. */
export function useActiveContracts() {
  const { data, isLoading, error, refetch } = useSuiClientQuery(
    "queryEvents",
    {
      query: {
        MoveEventType: `${pkg}::trustless_contracts::ContractCreatedEvent`,
      },
      limit: 50,
      order: "descending",
    },
    { enabled: pkg !== "0x0" },
  );

  const contracts: TrustlessContractData[] = (data?.data ?? []).map(eventToContract);

  return { contracts, isLoading, error, refetch };
}

/** Fetch a single contract shared object for live state (balances, filled qty). */
export function useContractObject(contractId: string | undefined) {
  const { data, isLoading, error } = useSuiClientQuery(
    "getObject",
    {
      id: contractId!,
      options: { showContent: true },
    },
    { enabled: !!contractId },
  );

  const fields = (data?.data?.content as { fields?: Record<string, unknown> })?.fields;
  const contract = fields ? objectToContract(fields) : null;

  return { contract, isLoading, error };
}

/** Fetch contract history (completed/cancelled/expired) from indexer. */
export function useContractHistory(params: PaginationParams = {}) {
  return useQuery({
    queryKey: ["contractHistory", params],
    queryFn: () => getTrustlessContractHistory(params),
  });
}
