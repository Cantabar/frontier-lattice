/**
 * Display formatting utilities.
 */

import { ASSEMBLY_TYPES } from "./types";

/** Truncate a Sui address/object ID for display: 0x1234...abcd */
export function truncateAddress(addr: string | undefined | null, startLen = 6, endLen = 4): string {
  if (!addr) return "—";
  if (addr.length <= startLen + endLen + 3) return addr;
  return `${addr.slice(0, startLen)}...${addr.slice(-endLen)}`;
}

/** Format a u64 token amount (in smallest denomination) for display. */
export function formatAmount(amountStr: string, decimals = 9): string {
  const raw = BigInt(amountStr);
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;

  if (frac === 0n) return whole.toLocaleString();

  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}.${fracStr}`;
}

/**
 * Format a ratio (numerator / denominator) using integer arithmetic.
 * Shows up to `maxDecimals` fractional digits, always keeping at least
 * `minDecimals` so values like "4.50" remain readable.
 */
export function formatRate(
  numerator: bigint,
  denominator: bigint,
  maxDecimals = 4,
  minDecimals = 2,
): string {
  if (denominator === 0n) return "0";
  const scale = 10n ** BigInt(maxDecimals);
  const scaled = (numerator * scale) / denominator;
  const whole = scaled / scale;
  const frac = scaled % scale;

  if (frac === 0n) {
    return minDecimals > 0
      ? `${whole.toString()}.${"0".repeat(minDecimals)}`
      : whole.toString();
  }

  const fracStr = frac.toString().padStart(maxDecimals, "0");
  const trimmed = fracStr.replace(/0+$/, "");
  const finalFrac = trimmed.padEnd(minDecimals, "0");
  return `${whole.toString()}.${finalFrac}`;
}

/** Human-readable relative time: "2m ago", "3h ago", "5d ago". */
export function timeAgo(timestampMs: string | number): string {
  const now = Date.now();
  let then: number;
  if (typeof timestampMs === "number") {
    then = timestampMs;
  } else {
    const numeric = Number(timestampMs);
    then = Number.isFinite(numeric) ? numeric : new Date(timestampMs).getTime();
  }
  if (Number.isNaN(then)) return "—";
  const diff = now - then;

  if (diff < 0) return "just now";

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Deterministic hex colour derived from a Sui object ID, for avatar placeholders. */
export function generateAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = ((hash % 360) + 360) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

/** Human-readable label for a trustless contract variant. */
export function contractTypeLabel(variant: string): string {
  switch (variant) {
    case "CoinForCoin": return "Coin → Coin";
    case "CoinForItem": return "Coin → Item";
    case "ItemForCoin": return "Item → Coin";
    case "ItemForItem": return "Item → Item";
    case "Transport": return "Transport";
    case "BuildRequest": return "Build Request";
    default: return variant;
  }
}

/** Resolve a structure type ID to a human-readable name using ASSEMBLY_TYPES. */
export function structureTypeName(typeId: number): string {
  return ASSEMBLY_TYPES[typeId]?.label ?? `Type #${typeId}`;
}

/** Format a deadline timestamp as a countdown string or "Expired". */
export function formatDeadline(deadlineMs: string): string {
  const deadline = Number(deadlineMs);
  const now = Date.now();
  const diff = deadline - now;

  if (diff <= 0) return "Expired";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h left`;
  }

  return `${hours}h ${minutes}m left`;
}
