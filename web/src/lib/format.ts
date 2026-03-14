/**
 * Display formatting utilities.
 */

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

/** Human-readable relative time: "2m ago", "3h ago", "5d ago". */
export function timeAgo(timestampMs: string | number): string {
  const now = Date.now();
  const then = typeof timestampMs === "string" ? Number(timestampMs) : timestampMs;
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
