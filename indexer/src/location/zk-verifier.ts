/**
 * Shadow Location Network — server-side Groth16 proof verification.
 *
 * Loads circuit verification keys (exported by `build-zk-artifacts.sh`)
 * and exposes a thin wrapper around snarkjs groth16.verify().
 *
 * The verifier is initialised lazily on first use. If the verification
 * key files are missing (circuits not yet compiled) the module logs a
 * warning and rejects all verification attempts gracefully.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";

const log = logger.child({ component: "zk-verifier" });

// snarkjs is optional at startup — circuits may not be compiled yet.
// We dynamic-import at verification time so the server still boots.
let snarkjs: typeof import("snarkjs") | null = null;

async function loadSnarkjs(): Promise<typeof import("snarkjs")> {
  if (!snarkjs) {
    snarkjs = await import("snarkjs");
  }
  return snarkjs;
}

// ============================================================
// Verification Key Loading
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = process.env.ZK_ARTIFACTS_DIR
  ? resolve(process.env.ZK_ARTIFACTS_DIR)
  : resolve(__dirname, "../../circuits/artifacts");

interface VKey {
  protocol: string;
  curve: string;
  nPublic: number;
  [key: string]: unknown;
}

const vkeys: Record<string, VKey | null> = {
  region: null,
  proximity: null,
  mutual_proximity: null,
};

function loadVKey(filterType: "region" | "proximity" | "mutual_proximity"): VKey | null {
  const filenames: Record<string, string> = {
    region: "region_filter_vkey.json",
    proximity: "proximity_filter_vkey.json",
    mutual_proximity: "mutual_proximity_filter_vkey.json",
  };
  const filename = filenames[filterType];
  const path = resolve(ARTIFACTS_DIR, filename);

  if (!existsSync(path)) {
    log.warn(
      `[zk] Verification key not found: ${path} — ${filterType} proofs will be rejected until circuits are built.`,
    );
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as VKey;
  } catch (err) {
    log.error({ err }, `Failed to parse verification key ${path}`);
    return null;
  }
}

/** Attempt to load all verification keys. Safe to call multiple times. */
export function initVerifier(): void {
  if (!vkeys.region) vkeys.region = loadVKey("region");
  if (!vkeys.proximity) vkeys.proximity = loadVKey("proximity");
  if (!vkeys.mutual_proximity) vkeys.mutual_proximity = loadVKey("mutual_proximity");
}

// ============================================================
// Public API
// ============================================================

export interface VerifyResult {
  valid: boolean;
  error?: string;
}

/**
 * Verify a Groth16 proof for a location filter circuit.
 *
 * @param filterType  "region" | "proximity"
 * @param publicSignals  Array of decimal-encoded field elements (order must
 *                       match the circuit's public input declaration)
 * @param proof  The Groth16 proof object ({ pi_a, pi_b, pi_c, protocol, curve })
 */
export async function verifyFilterProof(
  filterType: "region" | "proximity" | "mutual_proximity",
  publicSignals: string[],
  proof: Record<string, unknown>,
): Promise<VerifyResult> {
  // Lazy-load vkey if not yet available
  if (!vkeys[filterType]) {
    vkeys[filterType] = loadVKey(filterType);
  }

  const vkey = vkeys[filterType];
  if (!vkey) {
    return {
      valid: false,
      error: `Verification key for "${filterType}" circuit is not available. Run 'make zk-build' first.`,
    };
  }

  try {
    const snarks = await loadSnarkjs();
    const ok = await snarks.groth16.verify(vkey, publicSignals, proof);
    return { valid: ok };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Proof verification failed",
    };
  }
}

/**
 * Build a deterministic filter key for deduplication.
 *
 * For region filters the key encodes the 6 bounds; for proximity
 * filters it encodes the reference point + max distance².
 */
export function buildFilterKey(
  filterType: "region" | "proximity" | "mutual_proximity",
  publicSignals: string[],
): string {
  if (filterType === "mutual_proximity") {
    // publicSignals: [locationHash1, locationHash2, maxDistanceSquared]
    // Key on the max distance only — structure IDs are in the DB columns
    const maxDistSq = publicSignals[2] ?? "0";
    return `mutual_proximity:${maxDistSq}`;
  }
  // publicSignals[0] is always location_hash — skip it for the key since the
  // unique constraint already includes structure_id
  const params = publicSignals.slice(1);
  return `${filterType}:${params.join(",")}`;
}
