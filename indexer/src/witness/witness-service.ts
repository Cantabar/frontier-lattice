/**
 * Witness Service — watches for world events (structure anchoring,
 * extension authorization) and matches them against open build request
 * contracts. When conditions are met, signs a BuildAttestation and
 * submits it as a `fulfill` transaction.
 *
 * Architecture:
 *   1. Poll the archived events table for relevant world events
 *      (StorageUnitCreatedEvent, GateCreatedEvent, TurretCreatedEvent,
 *       ExtensionAuthorizedEvent)
 *   2. Query open BuildRequestContracts from the SUI RPC
 *   3. Match: does any new structure satisfy an open contract?
 *   4. If match found: sign attestation → submit fulfill transaction
 *
 * The service runs alongside the indexer and shares the same Postgres
 * connection pool for reading archived events.
 */

import type pg from "pg";
import { SuiClient, type SuiObjectResponse } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { WitnessConfig } from "./witness-config.js";
import { encodeBuildAttestation, signAttestation, loadKeypair } from "./attestation.js";

const CORM_AUTH_EXT_SUFFIX = "corm_auth::CormAuth";

export class WitnessService {
  private pool: pg.Pool;
  private client: SuiClient;
  private config: WitnessConfig;
  private keypair: Ed25519Keypair;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(pool: pg.Pool, suiRpcUrl: string, config: WitnessConfig) {
    this.pool = pool;
    this.client = new SuiClient({ url: suiRpcUrl });
    this.config = config;
    this.keypair = loadKeypair(config.privateKey);
  }

  /** Start the polling loop. */
  start(): void {
    if (this.running) return;
    if (!this.config.enabled) {
      console.log("[witness] Service disabled, skipping.");
      return;
    }
    this.running = true;
    console.log(
      `[witness] Starting (interval=${this.config.intervalMs}ms, ` +
      `address=${this.keypair.toSuiAddress()})`,
    );
    this.poll();
  }

  /** Stop the polling loop. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[witness] Stopped.");
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      await this.processOnce();
    } catch (err) {
      console.error("[witness] Poll error:", err);
    }

    if (this.running) {
      this.timer = setTimeout(() => this.poll(), this.config.intervalMs);
    }
  }

  /**
   * Single poll: find open build request contracts, check if any
   * matching world events exist in the archive, and fulfill if so.
   */
  private async processOnce(): Promise<void> {
    // TODO: Implement full matching logic:
    //
    // 1. Query open BuildRequestContracts via SUI RPC
    //    (queryObjects with StructType filter on BuildRequestContract)
    //
    // 2. For each open contract, query the events archive for:
    //    - Anchor events (StorageUnitCreatedEvent etc.) matching
    //      the contract's requested_type_id
    //    - ExtensionAuthorizedEvent with CormAuth for the same structure
    //      (if require_corm_auth is true)
    //
    // 3. For matches: resolve the builder's character and address,
    //    encode the BuildAttestation, sign it, and submit a fulfill tx.
    //
    // This is a polling-based approach. A future optimization could use
    // the subscriber's event stream directly for lower latency.
    //
    // For now this is a scaffold — the matching and submission logic
    // will be wired up once the contracts are deployed and the event
    // types are available on-chain.
  }
}
