/**
 * Types, validation, and chunking helpers for bulk ItemForCoin contract creation.
 */

import { toBaseUnits } from "./coinUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PriceMode = "unit" | "total";

export interface BulkItemRow {
  /** Item type ID from the SSU inventory. */
  typeId: number;
  /** Human-readable item name (for display). */
  itemName: string;
  /** Quantity to offer in the contract. */
  quantity: number;
  /** Maximum available in the SSU owner inventory. */
  availableQuantity: number;
  /** Whether the user is entering a unit or total price. */
  priceMode: PriceMode;
  /** Raw user input for price (string to avoid float issues). */
  priceInput: string;
}

/** Validated & normalised payload ready for the PTB builder. */
export interface BulkItemPayload {
  typeId: number;
  itemName: string;
  quantity: number;
  /** Wanted amount in base units (after decimals conversion). */
  wantedAmount: number;
}

/** Per-row validation error. `null` means valid. */
export interface BulkRowError {
  quantity: string | null;
  price: string | null;
  divisibility: string | null;
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

export function validateRow(
  row: BulkItemRow,
  allowPartial: boolean,
  decimals: number,
  symbol: string,
): BulkRowError {
  const err: BulkRowError = { quantity: null, price: null, divisibility: null };

  if (row.quantity <= 0) {
    err.quantity = "Must be greater than 0";
  } else if (row.quantity > row.availableQuantity) {
    err.quantity = `Exceeds available (${row.availableQuantity.toLocaleString()})`;
  }

  const price = Number(row.priceInput);
  if (row.priceInput === "" || isNaN(price) || price < 0) {
    err.price = "Enter a valid amount";
  }

  // Divisibility check (mirrors CreateContractPage logic)
  if (allowPartial && !err.quantity && !err.price && price > 0) {
    const wantedBase = computeWantedBase(row, decimals);
    if (wantedBase > 0 && row.quantity > 0 && wantedBase % row.quantity !== 0) {
      const unitDown = Math.floor(wantedBase / row.quantity) * row.quantity;
      const unitUp = (Math.floor(wantedBase / row.quantity) + 1) * row.quantity;
      const fmtDown = (unitDown / 10 ** decimals).toFixed(decimals).replace(/\.?0+$/, "");
      const fmtUp = (unitUp / 10 ** decimals).toFixed(decimals).replace(/\.?0+$/, "");
      err.divisibility = `Total must be evenly divisible by quantity (${row.quantity}). Nearest: ${fmtDown} or ${fmtUp} ${symbol}`;
    }
  }

  return err;
}

export function hasRowError(err: BulkRowError): boolean {
  return err.quantity !== null || err.price !== null || err.divisibility !== null;
}

export function hasAnyError(rows: BulkItemRow[], allowPartial: boolean, decimals: number, symbol: string): boolean {
  return rows.some((r) => hasRowError(validateRow(r, allowPartial, decimals, symbol)));
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Compute the total wanted amount in base units from a row. */
export function computeWantedBase(row: BulkItemRow, decimals: number): number {
  const price = Number(row.priceInput);
  if (isNaN(price) || price < 0) return 0;
  if (row.priceMode === "total") {
    return toBaseUnits(row.priceInput, decimals);
  }
  // Unit mode: total = unit * quantity
  const total = price * row.quantity;
  return toBaseUnits(String(total), decimals);
}

/** Convert validated rows into payloads ready for the PTB builder. */
export function rowsToPayloads(rows: BulkItemRow[], decimals: number): BulkItemPayload[] {
  return rows.map((row) => ({
    typeId: row.typeId,
    itemName: row.itemName,
    quantity: row.quantity,
    wantedAmount: computeWantedBase(row, decimals),
  }));
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Split payloads into chunks of at most `chunkSize` items.
 * Each chunk becomes one PTB / one wallet signature.
 *
 * A conservative default of 5 contracts per transaction keeps the PTB well
 * within SUI's 1024-command / 128KB limits. The adaptive retry in the
 * execution flow can increase this when dry-run succeeds.
 */
export const DEFAULT_CHUNK_SIZE = 5;

export function chunkPayloads<T>(payloads: T[], chunkSize = DEFAULT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < payloads.length; i += chunkSize) {
    chunks.push(payloads.slice(i, i + chunkSize));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Compute the "other" price from the user input for preview. */
export function computeCounterpart(
  row: BulkItemRow,
  decimals: number,
): { unitPrice: string; totalPrice: string } {
  const price = Number(row.priceInput);
  if (isNaN(price) || price < 0 || row.quantity <= 0) {
    return { unitPrice: "—", totalPrice: "—" };
  }
  if (row.priceMode === "unit") {
    const total = price * row.quantity;
    return {
      unitPrice: row.priceInput,
      totalPrice: total.toFixed(decimals).replace(/\.?0+$/, ""),
    };
  }
  // total mode
  const unit = price / row.quantity;
  return {
    unitPrice: unit.toFixed(decimals).replace(/\.?0+$/, ""),
    totalPrice: row.priceInput,
  };
}
