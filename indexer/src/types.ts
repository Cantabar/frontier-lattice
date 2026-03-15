/**
 * Frontier Corm — Event Type Definitions
 *
 * Mirrors the on-chain Move event structs from:
 *   - tribe::tribe (Phase 1)
 *   - forge_planner::forge_planner (Phase 3)
 *   - trustless_contracts::trustless_contracts (Phase 4)
 *
 * Sui emits event fields as JSON via RPC. Object IDs are hex strings.
 * u64 values arrive as strings from Sui RPC (JSON doesn't support 64-bit ints).
 */

// ============================================================
// Module identifiers — used to filter subscriptions
// ============================================================

export const MODULES = {
  tribe: "tribe::tribe",
  forgePlanner: "forge_planner::forge_planner",
  trustlessContracts: "trustless_contracts::trustless_contracts",
  multiInputContract: "multi_input_contract::multi_input_contract",
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
// Phase 4 — Trustless Contracts Events
// ============================================================

export interface ContractCreatedEvent {
  contract_id: string;
  poster_id: string;
  contract_type: Record<string, unknown>;
  escrow_amount: string;
  target_quantity: string;
  deadline_ms: string;
  allow_partial: boolean;
  require_stake: boolean;
  stake_amount: string;
  allowed_characters: string[];
  allowed_tribes: number[];
}

export interface ContractFilledEvent {
  contract_id: string;
  filler_id: string;
  fill_quantity: string;
  payout_amount: string;
  remaining_quantity: string;
}

export interface ContractCompletedEvent {
  contract_id: string;
  poster_id: string;
  total_filled: string;
  total_escrow_paid: string;
}

export interface ContractCancelledEvent {
  contract_id: string;
  poster_id: string;
  escrow_returned: string;
}

export interface ContractExpiredEvent {
  contract_id: string;
  poster_id: string;
  escrow_returned: string;
  stake_forfeited: string;
  fill_pool_returned: string;
}

export interface TransportAcceptedEvent {
  contract_id: string;
  courier_id: string;
  stake_amount: string;
}

export interface TransportDeliveredEvent {
  contract_id: string;
  courier_id: string;
  delivered_quantity: string;
  payment_released: string;
  stake_released: string;
  remaining_quantity: string;
}

// ============================================================
// Multi-Input Contract Events
// ============================================================

export interface MultiInputContractCreatedEvent {
  contract_id: string;
  poster_id: string;
  description: string;
  destination_ssu_id: string;
  slot_type_ids: string[]; // u64 as string
  slot_required_quantities: string[]; // u64 as string
  total_required: string;
  bounty_amount: string;
  deadline_ms: string;
  allowed_characters: string[];
  allowed_tribes: number[];
}

export interface SlotFilledEvent {
  contract_id: string;
  filler_id: string;
  type_id: string;
  fill_quantity: string;
  payout_amount: string;
  slot_remaining: string;
  total_remaining: string;
}

export interface MultiInputContractCompletedEvent {
  contract_id: string;
  poster_id: string;
  total_filled: string;
  total_bounty_paid: string;
}

export interface MultiInputContractCancelledEvent {
  contract_id: string;
  poster_id: string;
  bounty_returned: string;
}

export interface MultiInputContractExpiredEvent {
  contract_id: string;
  poster_id: string;
  bounty_returned: string;
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
  // Forge Planner
  "RecipeRegistryCreatedEvent",
  "RecipeAddedEvent",
  "RecipeRemovedEvent",
  "OrderCreatedEvent",
  "OrderFulfilledEvent",
  "OrderCancelledEvent",
  // Trustless Contracts
  "ContractCreatedEvent",
  "ContractFilledEvent",
  "ContractCompletedEvent",
  "ContractCancelledEvent",
  "ContractExpiredEvent",
  "TransportAcceptedEvent",
  "TransportDeliveredEvent",
  // Multi-Input Contract
  "MultiInputContractCreatedEvent",
  "SlotFilledEvent",
  "MultiInputContractCompletedEvent",
  "MultiInputContractCancelledEvent",
  "MultiInputContractExpiredEvent",
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
  /** Short event name (e.g. "ContractCompletedEvent") */
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
    forgePlanner: string;
    trustlessContracts: string;
    multiInputContract: string;
  };
  /** Postgres connection string */
  databaseUrl: string;
  /** API server port */
  apiPort: number;
  /** Polling interval for event queries (ms) */
  pollIntervalMs: number;
}

export const DEFAULT_CONFIG: IndexerConfig = {
  suiRpcUrl: process.env.SUI_RPC_URL ?? "http://127.0.0.1:9000",
  packageIds: {
    tribe: process.env.PACKAGE_TRIBE ?? "",
    forgePlanner: process.env.PACKAGE_FORGE_PLANNER ?? "",
    trustlessContracts: process.env.PACKAGE_TRUSTLESS_CONTRACTS ?? "",
    multiInputContract: process.env.PACKAGE_MULTI_INPUT_CONTRACT ?? "",
  },
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://corm:corm@localhost:5432/frontier_corm",
  apiPort: Number(process.env.API_PORT) || 3100,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 2000,
};
