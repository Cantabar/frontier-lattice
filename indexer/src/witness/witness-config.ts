/**
 * Witness Service Configuration.
 *
 * The witness service signs BuildAttestations when it detects that a
 * build request contract can be fulfilled (structure anchored + optional
 * CormAuth extension authorized). It then submits the attestation as a
 * `fulfill` transaction.
 */

export interface WitnessConfig {
  /** Feature flag to enable/disable the witness service */
  enabled: boolean;
  /** Base64-encoded Ed25519 private key for signing attestations */
  privateKey: string;
  /** How often the service polls for matchable events (ms) */
  intervalMs: number;
  /** Gas budget per fulfill transaction (MIST) */
  gasBudget: number;
  /** Attestation validity window — how far in the future the deadline is set (ms) */
  attestationTtlMs: number;
  /** World package ID — needed to watch anchor/extension events */
  worldPackageId: string;
  /** Witnessed contracts package ID */
  witnessedContractsPackageId: string;
  /** Coin type for bounty (default 0x2::sui::SUI) */
  coinType: string;
}

export const DEFAULT_WITNESS_CONFIG: WitnessConfig = {
  enabled: process.env.WITNESS_ENABLED === "true",
  privateKey: process.env.WITNESS_PRIVATE_KEY ?? "",
  intervalMs: Number(process.env.WITNESS_INTERVAL_MS) || 15_000,
  gasBudget: Number(process.env.WITNESS_GAS_BUDGET) || 10_000_000,
  attestationTtlMs: Number(process.env.WITNESS_ATTESTATION_TTL_MS) || 5 * 60 * 1000, // 5 min
  worldPackageId: process.env.WORLD_PACKAGE_ID ?? "",
  witnessedContractsPackageId: process.env.PACKAGE_WITNESSED_CONTRACTS ?? "",
  coinType: process.env.WITNESS_COIN_TYPE ?? "0x2::sui::SUI",
};
