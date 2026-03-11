/**
 * Frontier Lattice — Event Type Definitions
 *
 * Mirrors the on-chain Move event structs from:
 *   - tribe::tribe (Phase 1)
 *   - contract_board::contract_board (Phase 2)
 *   - forge_planner::forge_planner (Phase 3)
 *
 * Sui emits event fields as JSON via RPC. Object IDs are hex strings.
 * u64 values arrive as strings from Sui RPC (JSON doesn't support 64-bit ints).
 */

// ============================================================
// Module identifiers — used to filter subscriptions
// ============================================================

export const MODULES = {
  tribe: "tribe::tribe",
  contractBoard: "contract_board::contract_board",
  forgePlanner: "forge_planner::forge_planner",
} as const;

// ============================================================
// Phase 1 — Tribe Events
// ============================================================

export interface TribeCreatedEvent {
  tribe_id: string;
  name: string;
  leader_character_id: string;
}

export interface MemberJoinedEvent {
  tribe_id: string;
  character_id: string;
  role: { Leader: null } | { Officer: null } | { Member: null };
}

export interface MemberRemovedEvent {
  tribe_id: string;
  character_id: string;
}

export interface ReputationUpdatedEvent {
  tribe_id: string;
  character_id: string;
  new_score: string; // u64 as string
}

export interface TreasuryDepositEvent {
  tribe_id: string;
  amount: string;
}

export interface TreasuryProposalCreatedEvent {
  tribe_id: string;
  proposal_id: string;
  amount: string;
  recipient: string;
  deadline_ms: string;
}

export interface TreasuryProposalVotedEvent {
  tribe_id: string;
  proposal_id: string;
  character_id: string;
  vote_count: string;
}

export interface TreasurySpendEvent {
  tribe_id: string;
  proposal_id: string;
  amount: string;
  recipient: string;
}

// ============================================================
// Phase 2 — Contract Board Events
// ============================================================

export interface JobCreatedEvent {
  job_id: string;
  poster_id: string;
  poster_tribe_id: string;
  completion_type: CompletionTypeJson;
  reward_amount: string;
  deadline_ms: string;
  min_reputation: string;
}

export interface JobAcceptedEvent {
  job_id: string;
  assignee_id: string;
}

export interface JobCompletedEvent {
  job_id: string;
  poster_id: string;
  assignee_id: string;
  reward_amount: string;
  completion_type: CompletionTypeJson;
  rep_awarded: string;
}

export interface JobExpiredEvent {
  job_id: string;
  poster_id: string;
  reward_amount: string;
}

export interface JobCancelledEvent {
  job_id: string;
  poster_id: string;
  reward_amount: string;
}

/** Sui serialises Move enums with variant-as-key JSON objects. */
export type CompletionTypeJson =
  | { Delivery: { storage_unit_id: string; type_id: string; quantity: number } }
  | { Bounty: { target_character_id: string } }
  | { Transport: { gate_id: string } }
  | { Custom: { commitment_hash: number[] } };

// ============================================================
// Phase 3 — Forge Planner Events
// ============================================================

export interface RecipeRegistryCreatedEvent {
  registry_id: string;
  tribe_id: string;
}

export interface RecipeAddedEvent {
  registry_id: string;
  tribe_id: string;
  output_type_id: string;
  output_quantity: number;
  input_count: string;
  run_time: string;
}

export interface RecipeRemovedEvent {
  registry_id: string;
  tribe_id: string;
  output_type_id: string;
}

export interface OrderCreatedEvent {
  order_id: string;
  tribe_id: string;
  creator_id: string;
  output_type_id: string;
  output_quantity: number;
  run_count: string;
  bounty_amount: string;
}

export interface OrderFulfilledEvent {
  order_id: string;
  tribe_id: string;
  creator_id: string;
  fulfiller_id: string;
  output_type_id: string;
  output_quantity: number;
  bounty_amount: string;
}

export interface OrderCancelledEvent {
  order_id: string;
  tribe_id: string;
  creator_id: string;
  output_type_id: string;
  bounty_amount: string;
}

// ============================================================
// All known event type names (short names matching Move structs)
// ============================================================

export const EVENT_TYPES = [
  // Tribe
  "TribeCreatedEvent",
  "MemberJoinedEvent",
  "MemberRemovedEvent",
  "ReputationUpdatedEvent",
  "TreasuryDepositEvent",
  "TreasuryProposalCreatedEvent",
  "TreasuryProposalVotedEvent",
  "TreasurySpendEvent",
  // Contract Board
  "JobCreatedEvent",
  "JobAcceptedEvent",
  "JobCompletedEvent",
  "JobExpiredEvent",
  "JobCancelledEvent",
  // Forge Planner
  "RecipeRegistryCreatedEvent",
  "RecipeAddedEvent",
  "RecipeRemovedEvent",
  "OrderCreatedEvent",
  "OrderFulfilledEvent",
  "OrderCancelledEvent",
] as const;

export type EventTypeName = (typeof EVENT_TYPES)[number];

// ============================================================
// Archived Event — stored in SQLite with checkpoint proof data
// ============================================================

/**
 * An archived on-chain event with checkpoint inclusion proof metadata.
 *
 * The proof chain:
 *   event data → transaction digest → checkpoint content digest
 *
 * Given the validator set for the checkpoint's epoch, any third party
 * can verify the event actually occurred on-chain.
 */
export interface ArchivedEvent {
  /** Auto-increment primary key */
  id?: number;
  /** Sui event type (fully qualified: package::module::EventName) */
  event_type: string;
  /** Short event name (e.g. "JobCompletedEvent") */
  event_name: EventTypeName;
  /** Module that emitted the event */
  module: string;
  /** JSON-serialised event data */
  event_data: string;

  // -- Checkpoint proof fields --

  /** Transaction digest containing this event */
  tx_digest: string;
  /** Event sequence number within the transaction */
  event_seq: number;
  /** Checkpoint sequence number */
  checkpoint_seq: string;
  /** Checkpoint digest (validator-signed summary) */
  checkpoint_digest: string;
  /** Checkpoint timestamp (ms since epoch) */
  timestamp_ms: string;

  // -- Denormalised query fields --

  /** Primary object ID (tribe_id, job_id, order_id — depends on event type) */
  primary_id: string;
  /** Tribe ID (present on all events, enables tribe-scoped queries) */
  tribe_id: string;
  /** Character ID (if applicable — actor in the event) */
  character_id: string | null;

  /** When the event was archived (ISO 8601) */
  archived_at?: string;
}

// ============================================================
// Indexer Configuration
// ============================================================

export interface IndexerConfig {
  /** Sui RPC endpoint (e.g. http://127.0.0.1:9000 for local) */
  suiRpcUrl: string;
  /** Package IDs to subscribe to (one per deployed Move package) */
  packageIds: {
    tribe: string;
    contractBoard: string;
    forgePlanner: string;
  };
  /** SQLite database file path */
  dbPath: string;
  /** API server port */
  apiPort: number;
  /** Polling interval for event queries (ms) */
  pollIntervalMs: number;
}

export const DEFAULT_CONFIG: IndexerConfig = {
  suiRpcUrl: process.env.SUI_RPC_URL ?? "http://127.0.0.1:9000",
  packageIds: {
    tribe: process.env.PACKAGE_TRIBE ?? "",
    contractBoard: process.env.PACKAGE_CONTRACT_BOARD ?? "",
    forgePlanner: process.env.PACKAGE_FORGE_PLANNER ?? "",
  },
  dbPath: process.env.DB_PATH ?? "./data/frontier-lattice.db",
  apiPort: Number(process.env.API_PORT) || 3100,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 2000,
};
