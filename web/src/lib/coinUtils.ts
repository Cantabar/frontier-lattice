/**
 * Coin type parsing utilities.
 *
 * SUI coin types are fully-qualified Move type strings, e.g.:
 *   "0x2::sui::SUI"
 *   "0xabc123::my_coin::MYCOIN"
 *
 * These helpers extract human-readable labels and detect native SUI.
 */

/**
 * Extracts the coin type argument from a Tribe (or similar) object type string.
 * e.g. "0xabc::tribe::Tribe<0x2::sui::SUI>" → "0x2::sui::SUI"
 */
export function extractCoinTypeFromObjectType(objectType: string): string | null {
  const match = objectType.match(/<(.+)>/);
  return match?.[1] ?? null;
}

/**
 * Extracts the human-readable symbol (last segment) from a full coin type.
 * e.g. "0x2::sui::SUI" → "SUI"
 *      "0xabc::my_coin::MYCOIN" → "MYCOIN"
 */
export function parseCoinSymbol(coinType: string): string {
  const parts = coinType.split("::");
  return parts[parts.length - 1] ?? coinType;
}

/**
 * Extracts the module::name portion from a full coin type.
 * e.g. "0x2::sui::SUI" → "sui::SUI"
 */
export function parseCoinModule(coinType: string): string {
  const parts = coinType.split("::");
  if (parts.length >= 3) return `${parts[1]}::${parts[2]}`;
  return coinType;
}

/** Returns true if the coin type is native SUI. */
export function isNativeSui(coinType: string): boolean {
  return coinType === "0x2::sui::SUI";
}

/** Default decimals for native SUI (1 SUI = 10^9 MIST). */
export const SUI_DECIMALS = 9;

/**
 * Convert a human-readable coin amount to its smallest on-chain unit.
 * e.g. toBaseUnits("1.5", 9) → 1_500_000_000
 */
export function toBaseUnits(humanAmount: string | number, decimals: number): number {
  return Math.round(Number(humanAmount) * 10 ** decimals);
}

/**
 * Convert a base-unit (smallest denomination) amount to human-readable.
 * e.g. fromBaseUnits(1_500_000_000, 9) → 1.5
 */
export function fromBaseUnits(baseUnits: string | number, decimals: number): number {
  return Number(baseUnits) / 10 ** decimals;
}
