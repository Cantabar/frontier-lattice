/**
 * Hook for reading Smart Storage Unit inventory from on-chain dynamic fields.
 *
 * On-chain, each StorageUnit stores Inventory objects as dynamic fields keyed
 * by the owner_cap_id (owner's inventory) or a deterministic open-storage key
 * derived from blake2b(ssu_id ++ "open_inventory").
 *
 * Each Inventory contains a VecMap<u64, ItemEntry> where the key is type_id
 * and the value holds { tenant, type_id, item_id, volume, quantity }.
 *
 * We use getDynamicFields to discover inventory keys, then
 * getDynamicFieldObject to read each Inventory's contents.
 */

import { useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { blake2b } from "@noble/hashes/blake2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InventoryItemEntry {
  typeId: number;
  itemId: number;
  volume: number;
  quantity: number;
}

export interface InventorySlot {
  /** Dynamic field key (owner_cap_id or open-storage key) */
  key: string;
  /** "owner" for the owner_cap_id slot, "open" for the open-storage slot, "other" for player slots */
  kind: "owner" | "open" | "other";
  maxCapacity: number;
  usedCapacity: number;
  items: InventoryItemEntry[];
}

export interface SsuInventoryResult {
  slots: InventorySlot[];
  isLoading: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic open-storage key for an SSU, matching the on-chain
 * `open_storage_key_from_id` function in storage_unit.move:
 *   blake2b256(bcs(storage_unit_id) ++ "open_inventory")
 */
function computeOpenStorageKey(ssuId: string): string {
  // BCS serialization of a Move ID/address is the raw 32 bytes (no length prefix).
  const hex = ssuId.startsWith("0x") ? ssuId.slice(2) : ssuId;
  const idBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    idBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const suffix = new TextEncoder().encode("open_inventory");
  const combined = new Uint8Array(idBytes.length + suffix.length);
  combined.set(idBytes, 0);
  combined.set(suffix, idBytes.length);
  const digest = blake2b(combined, { dkLen: 32 });
  return (
    "0x" +
    Array.from(digest)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Parse the Sui RPC representation of a VecMap<u64, ItemEntry> into typed items.
 *
 * The RPC returns VecMap contents as an array of { key, value } objects under
 * the `contents` field. Each value is an ItemEntry struct with Move fields.
 */
function parseInventoryItems(itemsField: unknown): InventoryItemEntry[] {
  if (!itemsField || typeof itemsField !== "object") return [];

  // VecMap is serialised as { type, fields: { contents: [{ fields: { key, value } }] } }
  const outer = itemsField as { fields?: { contents?: unknown[] } };
  const contents = outer?.fields?.contents ?? (itemsField as { contents?: unknown[] }).contents;
  if (!Array.isArray(contents)) return [];

  return contents.map((entry) => {
    const e = (entry as { fields?: Record<string, unknown> }).fields ?? (entry as Record<string, unknown>);
    const value = (e.value as { fields?: Record<string, unknown> })?.fields ?? (e.value as Record<string, unknown>);
    return {
      typeId: Number(e.key ?? value?.type_id ?? 0),
      itemId: Number(value?.item_id ?? 0),
      volume: Number(value?.volume ?? 0),
      quantity: Number(value?.quantity ?? 0),
    };
  });
}

function parseInventorySlot(
  key: string,
  kind: "owner" | "open" | "other",
  fields: Record<string, unknown>,
): InventorySlot {
  return {
    key,
    kind,
    maxCapacity: Number(fields.max_capacity ?? 0),
    usedCapacity: Number(fields.used_capacity ?? 0),
    items: parseInventoryItems(fields.items),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch inventory contents for a single SSU.
 *
 * @param ssuId       - The StorageUnit object ID
 * @param ownerCapId  - The owner_cap_id stored on the StorageUnit (from AssemblyData)
 * @param enabled     - Set false to skip fetching (e.g. when no SSU is selected)
 */
export function useSsuInventory(
  ssuId: string | undefined,
  ownerCapId: string | undefined,
  enabled = true,
): SsuInventoryResult {
  const client = useSuiClient();

  const {
    data: slots,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["ssuInventory", ssuId, ownerCapId],
    queryFn: async (): Promise<InventorySlot[]> => {
      if (!ssuId || !ownerCapId) return [];

      // List all dynamic fields on the StorageUnit
      const dfResult = await client.getDynamicFields({ parentId: ssuId });
      const results: InventorySlot[] = [];
      const openKey = computeOpenStorageKey(ssuId);

      for (const df of dfResult.data) {
        // Inventory dynamic fields are keyed by ID (address type).
        // Skip non-address keys (e.g. extension_freeze marker).
        const nameValue = (df.name as { value?: string }).value ?? String(df.name);
        const nameType = (df.name as { type?: string }).type ?? "";
        if (!nameType.includes("ID") && !nameType.includes("address")) continue;

        // Determine slot kind by matching against known keys
        let kind: "owner" | "open" | "other" = "other";
        if (nameValue === ownerCapId) {
          kind = "owner";
        } else if (nameValue === openKey) {
          kind = "open";
        }

        // Fetch the Inventory struct from this dynamic field
        try {
          const obj = await client.getDynamicFieldObject({
            parentId: ssuId,
            name: df.name,
          });
          const content = obj.data?.content as { fields?: Record<string, unknown> } | undefined;
          const fields = content?.fields;
          // Dynamic field wraps the value in a `value` field
          const innerFields = (fields?.value as { fields?: Record<string, unknown> })?.fields
            ?? (fields?.value as Record<string, unknown>)
            ?? fields;
          if (!innerFields || typeof innerFields !== "object") continue;
          // Only process objects that look like Inventory (have max_capacity + items)
          if (!("max_capacity" in innerFields) || !("items" in innerFields)) continue;
          results.push(parseInventorySlot(nameValue, kind, innerFields as Record<string, unknown>));
        } catch {
          // Skip fields we can't read (e.g. non-Inventory dynamic fields)
          continue;
        }
      }

      return results;
    },
    enabled: enabled && !!ssuId && !!ownerCapId,
  });

  return {
    slots: slots ?? [],
    isLoading,
    error: error as Error | null,
  };
}
