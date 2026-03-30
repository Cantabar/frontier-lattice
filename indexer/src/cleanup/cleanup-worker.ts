/**
 * Cleanup Worker — background service that garbage-collects completed
 * contract objects on Sui, reclaiming storage rebates.
 *
 * Lifecycle:
 *   1. Enqueue: scan archived CompletedEvents → insert pending cleanup_jobs
 *   2. Process: for each pending job past the delay window:
 *      a. Verify the object still exists on-chain
 *      b. Build + sign + execute the cleanup PTB
 *      c. Record storage rebate from transaction effects
 *
 * Runs on a configurable timer alongside the indexer in the same process.
 */

import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { Transaction } from "@mysten/sui/transactions";
import type pg from "pg";
import type { IndexerConfig } from "../types.js";
import {
  getExistingCleanupContractIds,
  getPendingCleanupJobs,
  insertCleanupJob,
  markCleanupConfirmed,
  markCleanupFailed,
  markCleanupNotFound,
} from "../db/queries.js";
import {
  buildCleanupCompletedContract,
  buildCleanupCompletedItemContract,
  buildCleanupMultiInputContract,
  buildCleanupAssemblyMetadata,
  isItemContract,
} from "./cleanup-transactions.js";
import { logger } from "../logger.js";

const log = logger.child({ component: "cleanup" });

export class CleanupWorker {
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  private config: IndexerConfig;
  private pool: pg.Pool;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private jobsProcessed = 0;

  constructor(config: IndexerConfig, pool: pg.Pool) {
    this.config = config;
    this.pool = pool;
    this.client = new SuiClient({ url: config.suiRpcUrl });

    // Decode the private key from base64 (Sui keystore format: flag byte + 32 bytes)
    const keyBytes = Buffer.from(config.cleanup.privateKey, "base64");
    // If 33 bytes, first byte is the key scheme flag — strip it
    const rawKey = keyBytes.length === 33 ? keyBytes.slice(1) : keyBytes;
    this.keypair = Ed25519Keypair.fromSecretKey(rawKey);
  }

  /** Start the polling loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const addr = this.keypair.getPublicKey().toSuiAddress();
    log.info(`Starting cleanup worker (interval=${this.config.cleanup.intervalMs}ms, delay=${this.config.cleanup.delayMs}ms, address=${addr})`);
    this.poll();
  }

  /** Stop the polling loop. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    log.info(`Stopped. Total jobs processed: ${this.jobsProcessed}`);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      await this.enqueueNewJobs();
      await this.processPendingJobs();
    } catch (err) {
      log.error({ err }, "Poll error");
    }

    if (this.running) {
      this.timer = setTimeout(() => this.poll(), this.config.cleanup.intervalMs);
    }
  }

  // ================================================================
  // Enqueue: scan completed events → insert pending cleanup jobs
  // ================================================================

  private async enqueueNewJobs(): Promise<void> {
    const existingIds = await getExistingCleanupContractIds(this.pool);

    // Find ContractCompletedEvent entries not yet in cleanup_jobs
    const tcCompleted = await this.pool.query(
      `SELECT primary_id, event_data, timestamp_ms
       FROM events
       WHERE event_name = 'ContractCompletedEvent'
       ORDER BY id ASC`,
    );

    // Find MultiInputContractCompletedEvent entries not yet in cleanup_jobs
    const micCompleted = await this.pool.query(
      `SELECT primary_id, event_data, timestamp_ms
       FROM events
       WHERE event_name = 'MultiInputContractCompletedEvent'
       ORDER BY id ASC`,
    );

    let enqueued = 0;

    for (const row of tcCompleted.rows as { primary_id: string; event_data: string; timestamp_ms: string }[]) {
      if (existingIds.has(row.primary_id)) continue;

      // Look up the creation event to get contract_type, poster_id, source_ssu_id
      const meta = await this.getContractCreationMeta(row.primary_id);

      await insertCleanupJob(
        this.pool,
        row.primary_id,
        "trustless_contracts",
        meta.contractType,
        meta.posterId,
        meta.sourceSsuId,
        new Date(Number(row.timestamp_ms)).toISOString(),
      );
      existingIds.add(row.primary_id);
      enqueued++;
    }

    for (const row of micCompleted.rows as { primary_id: string; event_data: string; timestamp_ms: string }[]) {
      if (existingIds.has(row.primary_id)) continue;

      const eventData = typeof row.event_data === "string" ? JSON.parse(row.event_data) : row.event_data;

      await insertCleanupJob(
        this.pool,
        row.primary_id,
        "trustless_contracts",
        "MultiInput",
        eventData.poster_id ?? null,
        null,
        new Date(Number(row.timestamp_ms)).toISOString(),
      );
      existingIds.add(row.primary_id);
      enqueued++;
    }

    // ── Metadata cleanup: StatusChangedEvent with action UNANCHORED ──────
    const unanchoredEvents = await this.pool.query(
      `SELECT primary_id, event_data, timestamp_ms
       FROM events
       WHERE event_name = 'StatusChangedEvent'
       ORDER BY id ASC`,
    );

    for (const row of unanchoredEvents.rows as { primary_id: string; event_data: string; timestamp_ms: string }[]) {
      if (existingIds.has(row.primary_id)) continue;
      const eventData = typeof row.event_data === "string" ? JSON.parse(row.event_data) : row.event_data;
      // Only enqueue if action is UNANCHORED
      const action = eventData.action;
      const isUnanchored = action === "UNANCHORED" ||
        (typeof action === "object" && action !== null && "variant" in action && action.variant === "UNANCHORED");
      if (!isUnanchored) continue;

      // Only enqueue if metadata exists for this assembly
      const metaCheck = await this.pool.query(
        `SELECT 1 FROM metadata_snapshots WHERE assembly_id = $1 LIMIT 1`,
        [row.primary_id],
      );
      if (metaCheck.rows.length === 0) continue;

      await insertCleanupJob(
        this.pool,
        row.primary_id,
        "assembly_metadata",
        "MetadataCleanup",
        null,
        null,
        new Date(Number(row.timestamp_ms)).toISOString(),
      );
      existingIds.add(row.primary_id);
      enqueued++;
    }

    if (enqueued > 0) {
      log.info(`Enqueued ${enqueued} new cleanup job(s)`);
    }
  }

  /** Map creation event names to their contract variant. */
  private static readonly CREATION_EVENT_VARIANTS: Record<string, string> = {
    CoinForCoinCreatedEvent: "CoinForCoin",
    CoinForItemCreatedEvent: "CoinForItem",
    ItemForCoinCreatedEvent: "ItemForCoin",
    ItemForItemCreatedEvent: "ItemForItem",
    TransportCreatedEvent: "Transport",
  };

  /**
   * Look up the creation event for a trustless contract to extract
   * contract variant, poster_id, and source_ssu_id (for item contracts).
   */
  private async getContractCreationMeta(contractId: string): Promise<{
    contractType: string | null;
    posterId: string | null;
    sourceSsuId: string | null;
  }> {
    const creationNames = Object.keys(CleanupWorker.CREATION_EVENT_VARIANTS);
    const placeholders = creationNames.map((_, i) => `$${i + 2}`).join(", ");
    const result = await this.pool.query(
      `SELECT event_name, event_data FROM events
       WHERE event_name IN (${placeholders}) AND primary_id = $1
       LIMIT 1`,
      [contractId, ...creationNames],
    );

    if (result.rows.length === 0) {
      return { contractType: null, posterId: null, sourceSsuId: null };
    }

    const row = result.rows[0];
    const data = typeof row.event_data === "string" ? JSON.parse(row.event_data) : row.event_data;
    const variant = CleanupWorker.CREATION_EVENT_VARIANTS[row.event_name] ?? null;

    return {
      contractType: variant,
      posterId: data.poster_id ?? null,
      sourceSsuId: data.source_ssu_id ?? null,
    };
  }

  // ================================================================
  // Process: execute cleanup transactions for pending jobs
  // ================================================================

  private async processPendingJobs(): Promise<void> {
    const jobs = await getPendingCleanupJobs(
      this.pool,
      this.config.cleanup.delayMs,
      10,
    );

    for (const job of jobs) {
      try {
        await this.processJob(job);
        this.jobsProcessed++;
      } catch (err) {
        log.error({ err }, `Error processing job ${job.id} (contract ${job.contract_id})`);
      }
    }
  }

  private async processJob(job: {
    id: number;
    contract_id: string;
    contract_module: string;
    contract_type: string | null;
    poster_id: string | null;
    source_ssu_id: string | null;
  }): Promise<void> {
    // 1. Verify the object still exists on-chain
    try {
      const obj = await this.client.getObject({ id: job.contract_id });
      if (!obj.data) {
        // Object already deleted (cleaned up by someone else)
        log.info(`Contract ${job.contract_id} already deleted, marking not_found`);
        await markCleanupNotFound(this.pool, job.id);
        return;
      }
    } catch {
      // Object not found or RPC error — mark as not_found
      log.info(`Contract ${job.contract_id} not found on-chain, marking not_found`);
      await markCleanupNotFound(this.pool, job.id);
      return;
    }

    // 2. Build the cleanup transaction
    let tx: Transaction;

    if (job.contract_module === "assembly_metadata") {
      tx = buildCleanupAssemblyMetadata(this.config, job.contract_id);
    } else if (job.contract_module === "trustless_contracts" && job.contract_type === "MultiInput") {
      tx = buildCleanupMultiInputContract(this.config, job.contract_id);
    } else if (isItemContract(job.contract_type)) {
      // Item-bearing trustless contract needs poster + SSU
      if (!job.poster_id || !job.source_ssu_id) {
        log.warn(`Job ${job.id}: item contract missing poster_id or source_ssu_id, skipping`);
        await markCleanupFailed(
          this.pool, job.id,
          "Missing poster_id or source_ssu_id for item contract cleanup",
          this.config.cleanup.maxRetries,
        );
        return;
      }
      tx = buildCleanupCompletedItemContract(
        this.config,
        job.contract_id,
        job.poster_id,
        job.source_ssu_id,
        job.contract_type,
      );
    } else {
      // Coin-only trustless contract
      tx = buildCleanupCompletedContract(this.config, job.contract_id, job.contract_type);
    }

    // 3. Sign and execute
    try {
      tx.setSender(this.keypair.getPublicKey().toSuiAddress());

      const txBytes = await tx.build({ client: this.client });
      const { signature } = await this.keypair.signTransaction(txBytes);

      const result = await this.client.executeTransactionBlock({
        transactionBlock: txBytes,
        signature,
        options: { showEffects: true },
      });

      // 4. Extract storage rebate from effects
      const effects = result.effects;
      if (effects?.status?.status === "success") {
        const gasUsed = effects.gasUsed;
        const storageRebate = BigInt(gasUsed?.storageRebate ?? "0");
        const computationCost = BigInt(gasUsed?.computationCost ?? "0");
        const storageCost = BigInt(gasUsed?.storageCost ?? "0");

        await markCleanupConfirmed(
          this.pool,
          job.id,
          result.digest,
          storageRebate,
          computationCost,
          storageCost,
        );

        const netMist = storageRebate - computationCost - storageCost;
        log.info(`Contract ${job.contract_id} cleaned up (rebate=${storageRebate} MIST, net=${netMist} MIST, tx=${result.digest})`);
      } else {
        const errMsg = effects?.status?.error ?? "Transaction failed with unknown error";
        log.warn(`Transaction failed for ${job.contract_id}: ${errMsg}`);
        await markCleanupFailed(this.pool, job.id, errMsg, this.config.cleanup.maxRetries);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.warn(`Execution error for ${job.contract_id}: ${errMsg}`);
      await markCleanupFailed(this.pool, job.id, errMsg, this.config.cleanup.maxRetries);
    }
  }
}
