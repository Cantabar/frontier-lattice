/**
 * Hooks for reading Multi-Input Contract data.
 *
 * useActiveMultiInputContracts — reads contract list from on-chain events.
 * useMultiInputContractObject  — fetches live aggregate fill state via getObject.
 * useMultiInputSlotFills       — aggregates SlotFilledEvent data per type_id for
 *                               a given contract, enabling per-slot progress display.
 */

import { useSuiClientQuery } from "@mysten/dapp-kit";
import { config } from "../config";
import type { MultiInputContractData, MultiInputSlot } from "../lib/types";

const pkg = config.packages.multiInputContract;

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function eventToContract(ev: { parsedJson?: unknown }): MultiInputContractData | null {
  const d = (ev.parsedJson as Record<string, unknown>) ?? {};
  const contractId = String(d.contract_id ?? "");
  if (!contractId) return null;

  const rawTypeIds = (d.slot_type_ids as unknown[]) ?? [];
  const rawRequired = (d.slot_required_quantities as unknown[]) ?? [];

  const slots: MultiInputSlot[] = rawTypeIds.map((tid, i) => ({
    typeId: Number(tid),
    required: Number(rawRequired[i] ?? 0),
    filled: 0, // not available from creation event; enriched later
  }));

  return {
    id: contractId,
    posterId: String(d.poster_id ?? ""),
    posterAddress: "",
    description: String(d.description ?? ""),
    destinationSsuId: String(d.destination_ssu_id ?? ""),
    slots,
    totalRequired: Number(d.total_required ?? 0),
    totalFilled: 0, // not available from event; fetch via getObject
    bountyAmount: String(d.bounty_amount ?? "0"),
    deadlineMs: String(d.deadline_ms ?? "0"),
    allowedCharacters: (d.allowed_characters as string[]) ?? [],
    allowedTribes: (d.allowed_tribes as number[]) ?? [],
  };
}

function objectFieldsToContract(
  id: string,
  fields: Record<string, unknown>,
): MultiInputContractData {
  const rawTypeIds = (fields.slot_type_ids as unknown[]) ?? [];

  // The slots Table<u64, SlotState> is a dynamic-field object; individual slot
  // states are not inline.  We set required/filled to 0 here — callers should
  // layer in required amounts from the creation event and filled amounts from
  // SlotFilledEvent aggregation.
  const slots: MultiInputSlot[] = rawTypeIds.map((tid) => ({
    typeId: Number(tid),
    required: 0,
    filled: 0,
  }));

  const bountyField = fields.bounty as { fields?: { value?: unknown } } | null;
  const bountyBalance =
    bountyField?.fields?.value !== undefined
      ? String(bountyField.fields.value)
      : undefined;

  return {
    id,
    posterId: String(fields.poster_id ?? ""),
    posterAddress: String(fields.poster_address ?? ""),
    description: String(fields.description ?? ""),
    destinationSsuId: String(fields.destination_ssu_id ?? ""),
    slots,
    totalRequired: Number(fields.total_required ?? 0),
    totalFilled: Number(fields.total_filled ?? 0),
    bountyAmount: String(fields.bounty_amount ?? "0"),
    bountyBalance,
    deadlineMs: String(fields.deadline_ms ?? "0"),
    allowedCharacters: (fields.allowed_characters as string[]) ?? [],
    allowedTribes: (fields.allowed_tribes as number[]) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Fetch active multi-input contracts from on-chain creation events. */
export function useActiveMultiInputContracts() {
  const { data, isLoading, error, refetch } = useSuiClientQuery(
    "queryEvents",
    {
      query: {
        MoveEventType: `${pkg}::multi_input_contract::MultiInputContractCreatedEvent`,
      },
      limit: 50,
      order: "descending",
    },
    { enabled: pkg !== "0x0" },
  );

  const contracts: MultiInputContractData[] = (data?.data ?? [])
    .map(eventToContract)
    .filter((c): c is MultiInputContractData => c !== null);

  return { contracts, isLoading, error, refetch };
}

/**
 * Fetch a single contract shared object for live aggregate fill state
 * (total_filled, total_required, bounty balance).
 */
export function useMultiInputContractObject(contractId: string | undefined) {
  const { data, isLoading, error } = useSuiClientQuery(
    "getObject",
    { id: contractId!, options: { showContent: true } },
    { enabled: !!contractId },
  );

  const fields = (data?.data?.content as { fields?: Record<string, unknown> })?.fields;
  const contract =
    fields && contractId ? objectFieldsToContract(contractId, fields) : null;

  return { contract, isLoading, error };
}

/**
 * Aggregate SlotFilledEvent data for a specific contract.
 * Returns a Map<typeId, totalFilled> enabling per-slot progress display.
 *
 * Queries all recent SlotFilledEvents and filters client-side by contract_id.
 * Sufficient for hackathon use; replace with indexer query for production scale.
 */
export function useMultiInputSlotFills(contractId: string | undefined) {
  const { data, isLoading } = useSuiClientQuery(
    "queryEvents",
    {
      query: {
        MoveEventType: `${pkg}::multi_input_contract::SlotFilledEvent`,
      },
      limit: 200,
      order: "descending",
    },
    { enabled: !!contractId && pkg !== "0x0" },
  );

  const fills = new Map<number, number>();
  for (const ev of data?.data ?? []) {
    const d = (ev.parsedJson as Record<string, unknown>) ?? {};
    if (String(d.contract_id) !== contractId) continue;
    const typeId = Number(d.type_id);
    const qty = Number(d.fill_quantity ?? 0);
    fills.set(typeId, (fills.get(typeId) ?? 0) + qty);
  }

  return { fills, isLoading };
}
