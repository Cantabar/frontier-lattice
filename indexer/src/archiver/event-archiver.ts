/**
 * Event Archiver — receives filtered Sui events from the subscriber,
 * enriches them with denormalised fields, stores them in Postgres with
 * checkpoint proof metadata.
 *
 * The archiver is the write-side of the indexer. It:
 *   1. Extracts denormalised fields (tribe_id, character_id, primary_id)
 *      from the event JSON for efficient querying
 *   2. Inserts the event into the `events` table
 *
 * The proof chain stored per event:
 *   event_data → tx_digest → checkpoint_seq → checkpoint_digest
 *
 * Any third party with the validator set for that epoch can verify:
 *   - The checkpoint digest is signed by ≥2/3 validators
 *   - The transaction digest is included in the checkpoint
 *   - The event was emitted by that transaction
 */

import type pg from "pg";
import type { ArchivedEvent, EventTypeName } from "../types.js";
import { insertEvent } from "../db/queries.js";

export interface RawEventInput {
  eventType: string;
  eventName: EventTypeName;
  module: string;
  eventData: Record<string, unknown>;
  txDigest: string;
  eventSeq: number;
  checkpointSeq: string;
  checkpointDigest: string;
  timestampMs: string;
}

export class EventArchiver {
  private pool: pg.Pool;
  private eventCount = 0;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /**
   * Archive a single event. Extracts denormalised fields, inserts into
   * the events table, and updates materialised views.
   */
  async archive(input: RawEventInput): Promise<void> {
    const { primaryId, tribeId, characterId } = extractDenormalisedFields(
      input.eventName,
      input.eventData,
    );

    const archived: ArchivedEvent = {
      event_type: input.eventType,
      event_name: input.eventName,
      module: input.module,
      event_data: JSON.stringify(input.eventData),
      tx_digest: input.txDigest,
      event_seq: input.eventSeq,
      checkpoint_seq: input.checkpointSeq,
      checkpoint_digest: input.checkpointDigest,
      timestamp_ms: input.timestampMs,
      primary_id: primaryId,
      tribe_id: tribeId,
      character_id: characterId,
    };

    await insertEvent(this.pool, archived);
    await this.materializeMetadata(input.eventName, input.eventData);
    this.eventCount++;

    if (this.eventCount % 100 === 0) {
      console.log(`[archiver] Archived ${this.eventCount} events total`);
    }
  }

  /** Total number of events archived in this session. */
  get totalArchived(): number {
    return this.eventCount;
  }

  /**
   * Materialize assembly metadata snapshots from create/update/delete events.
   * Uses upsert/delete to keep the metadata_snapshots table current.
   */
  private async materializeMetadata(
    eventName: EventTypeName,
    data: Record<string, unknown>,
  ): Promise<void> {
    switch (eventName) {
      case "MetadataCreatedEvent":
      case "MetadataUpdatedEvent":
        await this.pool.query(
          `INSERT INTO metadata_snapshots (assembly_id, name, description, owner, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (assembly_id) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             owner = COALESCE(EXCLUDED.owner, metadata_snapshots.owner),
             updated_at = NOW()`,
          [
            String(data.assembly_id ?? ""),
            String(data.name ?? ""),
            String(data.description ?? ""),
            String(data.owner ?? ""),
          ],
        );
        break;
      case "MetadataDeletedEvent":
        await this.pool.query(
          `DELETE FROM metadata_snapshots WHERE assembly_id = $1`,
          [String(data.assembly_id ?? "")],
        );
        break;
    }
  }
}

// ============================================================
// Field extraction — map event name → denormalised query fields
// ============================================================

/**
 * Extracts the primary_id, tribe_id, and character_id from an event's
 * JSON data based on the event type. These denormalised fields enable
 * efficient queries without parsing the JSON blob.
 */
function extractDenormalisedFields(
  eventName: EventTypeName,
  data: Record<string, unknown>,
): { primaryId: string; tribeId: string; characterId: string | null } {
  switch (eventName) {
    // -- Tribe events --
    case "TribeCreatedEvent":
      return {
        primaryId: str(data.tribe_id),
        tribeId: str(data.tribe_id),
        characterId: str(data.leader_character_id),
      };
    case "MemberJoinedEvent":
      return {
        primaryId: str(data.tribe_id),
        tribeId: str(data.tribe_id),
        characterId: str(data.character_id),
      };
    case "MemberRemovedEvent":
      return {
        primaryId: str(data.tribe_id),
        tribeId: str(data.tribe_id),
        characterId: str(data.character_id),
      };
    case "TreasuryDepositEvent":
      return {
        primaryId: str(data.tribe_id),
        tribeId: str(data.tribe_id),
        characterId: null,
      };
    case "TreasuryProposalCreatedEvent":
      return {
        primaryId: str(data.proposal_id),
        tribeId: str(data.tribe_id),
        characterId: null,
      };
    case "TreasuryProposalVotedEvent":
      return {
        primaryId: str(data.proposal_id),
        tribeId: str(data.tribe_id),
        characterId: str(data.character_id),
      };
    case "TreasurySpendEvent":
      return {
        primaryId: str(data.proposal_id),
        tribeId: str(data.tribe_id),
        characterId: null,
      };

    // -- Trustless Contracts events (per-module creation events) --
    case "CoinForCoinCreatedEvent":
    case "CoinForItemCreatedEvent":
    case "ItemForCoinCreatedEvent":
    case "ItemForItemCreatedEvent":
    case "TransportCreatedEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.poster_id),
      };
    case "ContractFilledEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.filler_id),
      };
    case "ContractCompletedEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.poster_id),
      };
    case "ContractCancelledEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.poster_id),
      };
    case "ContractExpiredEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.poster_id),
      };
    case "TransportAcceptedEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.courier_id),
      };
    case "TransportDeliveredEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.courier_id),
      };

    // -- Multi-Input Contract events --
    case "MultiInputContractCreatedEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.poster_id),
      };
    case "SlotFilledEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.filler_id),
      };
    case "MultiInputContractCompletedEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.poster_id),
      };
    case "MultiInputContractCancelledEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.poster_id),
      };
    case "MultiInputContractExpiredEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.poster_id),
      };

    // -- Witnessed Contracts — Build Request --
    case "BuildRequestCreatedEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.poster_id),
      };
    case "BuildRequestFulfilledEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: null,
      };
    case "BuildRequestCancelledEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.poster_id),
      };
    case "BuildRequestExpiredEvent":
      return {
        primaryId: str(data.contract_id),
        tribeId: "",
        characterId: str(data.poster_id),
      };

    // -- Assembly Metadata events --
    case "MetadataCreatedEvent":
    case "MetadataUpdatedEvent":
    case "MetadataDeletedEvent":
      return {
        primaryId: str(data.assembly_id),
        tribeId: "",
        characterId: str(data.owner ?? ""),
      };

    // -- World status events --
    case "StatusChangedEvent":
      return {
        primaryId: str(data.assembly_id),
        tribeId: "",
        characterId: null,
      };

    default:
      return { primaryId: "", tribeId: "", characterId: null };
  }
}

/** Safe string extraction from unknown value. */
function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}
