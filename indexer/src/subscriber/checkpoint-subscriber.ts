/**
 * Checkpoint Subscriber — polls Sui RPC for on-chain events from
 * Frontier Corm packages and feeds them to the archiver.
 *
 * Uses `queryEvents` with cursor-based pagination for reliability.
 * Each event is enriched with checkpoint metadata (digest, sequence,
 * timestamp) by querying the transaction's checkpoint.
 *
 * The subscriber maintains a cursor in SQLite so it can resume from
 * where it left off after a restart.
 */

import { SuiClient, type SuiEvent } from "@mysten/sui/client";
import type pg from "pg";
import type { IndexerConfig, EventTypeName } from "../types.js";
import { EVENT_TYPES } from "../types.js";
import { getCursor, updateCursor } from "../db/queries.js";
import { EventArchiver } from "../archiver/event-archiver.js";

export interface CheckpointMetadata {
  checkpointSeq: string;
  checkpointDigest: string;
  timestampMs: string;
}

export class CheckpointSubscriber {
  private client: SuiClient;
  private config: IndexerConfig;
  private pool: pg.Pool;
  private archiver: EventArchiver;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Fully qualified event type strings to listen for (package::module::Event) */
  private eventTypeFilters: string[];

  /** Cache: tx_digest → checkpoint metadata (avoids repeated RPC calls) */
  private checkpointCache = new Map<string, CheckpointMetadata>();

  constructor(
    config: IndexerConfig,
    pool: pg.Pool,
    archiver: EventArchiver,
  ) {
    this.config = config;
    this.pool = pool;
    this.archiver = archiver;
    this.client = new SuiClient({ url: config.suiRpcUrl });

    // Build fully qualified event type filters from package IDs
    this.eventTypeFilters = this.buildEventTypeFilters();
  }

  /**
   * Builds fully qualified event type strings for all known events.
   * Format: `{packageId}::{module}::{EventName}`
   */
  private buildEventTypeFilters(): string[] {
    const filters: string[] = [];
    const { tribe, forgePlanner, trustlessContracts, multiInputContract } = this.config.packageIds;

    // Map event names to their package + module
    const eventModuleMap: Record<string, { packageId: string; module: string }> = {};

    // Tribe events
    for (const name of [
      "TribeCreatedEvent", "MemberJoinedEvent", "MemberRemovedEvent",
      "ReputationUpdatedEvent", "TreasuryDepositEvent",
      "TreasuryProposalCreatedEvent", "TreasuryProposalVotedEvent",
      "TreasurySpendEvent",
    ]) {
      eventModuleMap[name] = { packageId: tribe, module: "tribe" };
    }

    // Forge Planner events
    for (const name of [
      "RecipeRegistryCreatedEvent", "RecipeAddedEvent", "RecipeRemovedEvent",
      "OrderCreatedEvent", "OrderFulfilledEvent", "OrderCancelledEvent",
    ]) {
      eventModuleMap[name] = { packageId: forgePlanner, module: "forge_planner" };
    }

    // Trustless Contracts events
    for (const name of [
      "ContractCreatedEvent", "ContractFilledEvent", "ContractCompletedEvent",
      "ContractCancelledEvent", "ContractExpiredEvent",
      "TransportAcceptedEvent", "TransportDeliveredEvent",
    ]) {
      eventModuleMap[name] = { packageId: trustlessContracts, module: "trustless_contracts" };
    }

    // Multi-Input Contract events
    for (const name of [
      "MultiInputContractCreatedEvent", "SlotFilledEvent",
      "MultiInputContractCompletedEvent", "MultiInputContractCancelledEvent",
      "MultiInputContractExpiredEvent",
    ]) {
      eventModuleMap[name] = { packageId: multiInputContract, module: "multi_input_contract" };
    }

    for (const [name, { packageId, module }] of Object.entries(eventModuleMap)) {
      if (packageId) {
        filters.push(`${packageId}::${module}::${name}`);
      }
    }

    return filters;
  }

  /** Start the polling loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(
      `[subscriber] Starting event poll (interval=${this.config.pollIntervalMs}ms, ` +
      `filters=${this.eventTypeFilters.length} event types)`,
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
    console.log("[subscriber] Stopped.");
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      await this.pollOnce();
    } catch (err) {
      console.error("[subscriber] Poll error:", err);
    }

    // Schedule next poll
    if (this.running) {
      this.timer = setTimeout(() => this.poll(), this.config.pollIntervalMs);
    }
  }

  /**
   * Single poll iteration: query events for each package, enrich with
   * checkpoint data, and pass to the archiver.
   */
  private async pollOnce(): Promise<void> {
    const cursor = await getCursor(this.pool);

    // Build the event cursor for Sui RPC — shared across all event type queries
    // so that no event type's results advance the cursor past another type's events.
    const suiCursor = cursor.last_tx_digest
      ? { txDigest: cursor.last_tx_digest, eventSeq: String(cursor.last_event_seq ?? 0) }
      : undefined;

    // Query events for each filter (package-level query)
    let totalProcessed = 0;
    let latestCursorUpdate: { txDigest: string; eventSeq: number; timestampMs: string } | null = null;

    for (const eventType of this.eventTypeFilters) {
      try {
        const result = await this.client.queryEvents({
          query: { MoveEventType: eventType },
          cursor: suiCursor,
          limit: 50,
          order: "ascending",
        });

        if (result.data.length === 0) continue;

        for (const event of result.data) {
          await this.processEvent(event);
          totalProcessed++;
        }

        // Track the latest event across all types for cursor update
        const lastEvent = result.data[result.data.length - 1];
        if (lastEvent?.id) {
          const ts = Number(lastEvent.timestampMs ?? "0");
          if (!latestCursorUpdate || ts > Number(latestCursorUpdate.timestampMs)) {
            latestCursorUpdate = {
              txDigest: lastEvent.id.txDigest,
              eventSeq: Number(lastEvent.id.eventSeq),
              timestampMs: lastEvent.timestampMs ?? "0",
            };
          }
        }
      } catch (err) {
        // Log but continue with other event types
        console.error(`[subscriber] Error querying ${eventType}:`, err);
      }
    }

    // Update cursor once after all event types are processed
    if (latestCursorUpdate) {
      await updateCursor(
        this.pool,
        latestCursorUpdate.txDigest,
        latestCursorUpdate.eventSeq,
        latestCursorUpdate.timestampMs,
      );
    }

    if (totalProcessed > 0) {
      console.log(`[subscriber] Processed ${totalProcessed} events`);
    }
  }

  /**
   * Process a single Sui event: extract checkpoint metadata and pass
   * to the archiver.
   */
  private async processEvent(event: SuiEvent): Promise<void> {
    const checkpointMeta = await this.getCheckpointMetadata(event);

    // Parse the event type to extract the short name
    // Format: {packageId}::{module}::{EventName}
    const eventTypeParts = event.type.split("::");
    const eventName = eventTypeParts[eventTypeParts.length - 1] as EventTypeName;
    const moduleName = eventTypeParts.length >= 2 ? eventTypeParts[eventTypeParts.length - 2] : "unknown";

    // Validate this is a known event type
    if (!EVENT_TYPES.includes(eventName)) {
      console.warn(`[subscriber] Unknown event type: ${event.type}`);
      return;
    }

    await this.archiver.archive({
      eventType: event.type,
      eventName,
      module: moduleName,
      eventData: event.parsedJson as Record<string, unknown>,
      txDigest: event.id.txDigest,
      eventSeq: Number(event.id.eventSeq),
      checkpointSeq: checkpointMeta.checkpointSeq,
      checkpointDigest: checkpointMeta.checkpointDigest,
      timestampMs: checkpointMeta.timestampMs,
    });
  }

  /**
   * Get checkpoint metadata for an event. Uses the event's timestampMs
   * and packageId field, plus a transaction query for the checkpoint digest.
   *
   * Results are cached by tx_digest since multiple events in the same
   * transaction share the same checkpoint.
   */
  private async getCheckpointMetadata(event: SuiEvent): Promise<CheckpointMetadata> {
    const txDigest = event.id.txDigest;

    // Check cache first
    const cached = this.checkpointCache.get(txDigest);
    if (cached) return cached;

    try {
      const txBlock = await this.client.getTransactionBlock({
        digest: txDigest,
        options: { showEffects: true },
      });

      // The checkpoint is available from the transaction response
      const checkpointSeq = txBlock.checkpoint ?? "0";
      const timestampMs = txBlock.timestampMs ?? event.timestampMs ?? "0";

      // Get the checkpoint digest
      let checkpointDigest = "";
      if (checkpointSeq !== "0") {
        try {
          const checkpoint = await this.client.getCheckpoint({
            id: checkpointSeq,
          });
          checkpointDigest = checkpoint.digest;
        } catch {
          // Fallback: use the transaction digest as a reference
          checkpointDigest = `checkpoint:${checkpointSeq}`;
        }
      }

      const meta: CheckpointMetadata = {
        checkpointSeq,
        checkpointDigest,
        timestampMs,
      };

      this.checkpointCache.set(txDigest, meta);

      // Prune cache if it gets too large
      if (this.checkpointCache.size > 1000) {
        const keys = [...this.checkpointCache.keys()];
        for (let i = 0; i < 500; i++) {
          this.checkpointCache.delete(keys[i]);
        }
      }

      return meta;
    } catch (err) {
      console.error(`[subscriber] Failed to get checkpoint for tx ${txDigest}:`, err);
      return {
        checkpointSeq: "0",
        checkpointDigest: "",
        timestampMs: event.timestampMs ?? "0",
      };
    }
  }
}
