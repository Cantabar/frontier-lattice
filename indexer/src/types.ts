/**
 * Frontier Corm — Event Type Definitions
 *
 * Mirrors the on-chain Move event structs from:
 *   - tribe::tribe (Phase 1)
 *   - trustless_contracts::{coin_for_coin,coin_for_item,item_for_coin,item_for_item,transport,contract_utils,multi_input} (Phase 4)
 *
 * Sui emits event fields as JSON via RPC. Object IDs are hex strings.
 * u64 values arrive as strings from Sui RPC (JSON doesn't support 64-bit ints).
 */

// ============================================================
// Module identifiers — used to filter subscriptions
// ============================================================

export const MODULES = {
  tribe: "tribe::tribe",
  /** Shared lifecycle events (filled, completed, cancelled, expired) */
  contractUtils: "trustless_contracts::contract_utils",
  /** Per-module creation events */
  coinForCoin: "trustless_contracts::coin_for_coin",
  coinForItem: "trustless_contracts::coin_for_item",
  itemForCoin: "trustless_contracts::item_for_coin",
  itemForItem: "trustless_contracts::item_for_item",
  transport: "trustless_contracts::transport",
  multiInput: "trustless_contracts::multi_input",
  /** Witnessed contracts */
  buildRequest: "witnessed_contracts::build_request",
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
// Trustless Contracts Events
// ============================================================

// Per-module creation events (no generic ContractCreatedEvent exists)

export interface CoinForCoinCreatedEvent {
  contract_id: string;
  poster_id: string;
  offered_amount: string;
  wanted_amount: string;
  target_quantity: string;
  deadline_ms: string;
  allow_partial: boolean;
  allowed_characters: string[];
  allowed_tribes: number[];
}

export interface CoinForItemCreatedEvent {
  contract_id: string;
  poster_id: string;
  escrow_amount: string;
  wanted_type_id: string;
  wanted_quantity: number;
  destination_ssu_id: string;
  target_quantity: string;
  deadline_ms: string;
  allow_partial: boolean;
  use_owner_inventory: boolean;
  allowed_characters: string[];
  allowed_tribes: number[];
}

export interface ItemForCoinCreatedEvent {
  contract_id: string;
  poster_id: string;
  offered_type_id: string;
  offered_quantity: number;
  source_ssu_id: string;
  wanted_amount: string;
  target_quantity: string;
  deadline_ms: string;
  allow_partial: boolean;
  allowed_characters: string[];
  allowed_tribes: number[];
}

export interface ItemForItemCreatedEvent {
  contract_id: string;
  poster_id: string;
  offered_type_id: string;
  offered_quantity: number;
  source_ssu_id: string;
  wanted_type_id: string;
  wanted_quantity: number;
  destination_ssu_id: string;
  target_quantity: string;
  deadline_ms: string;
  allow_partial: boolean;
  use_owner_inventory: boolean;
  allowed_characters: string[];
  allowed_tribes: number[];
}

export interface TransportCreatedEvent {
  contract_id: string;
  poster_id: string;
  item_type_id: string;
  item_quantity: number;
  source_ssu_id: string;
  destination_ssu_id: string;
  payment_amount: string;
  stake_amount: string;
  deadline_ms: string;
  use_owner_inventory: boolean;
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
// Witnessed Contracts — Build Request Events
// ============================================================

export interface BuildRequestCreatedEvent {
  contract_id: string;
  poster_id: string;
  requested_type_id: string;
  require_corm_auth: boolean;
  bounty_amount: string;
  deadline_ms: string;
  allowed_characters: string[];
  allowed_tribes: number[];
}

export interface BuildRequestFulfilledEvent {
  contract_id: string;
  builder_address: string;
  structure_id: string;
  structure_type_id: string;
  bounty_paid: string;
}

export interface BuildRequestCancelledEvent {
  contract_id: string;
  poster_id: string;
  bounty_returned: string;
}

export interface BuildRequestExpiredEvent {
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
  "TreasuryDepositEvent",
  "TreasuryProposalCreatedEvent",
  "TreasuryProposalVotedEvent",
  "TreasurySpendEvent",
  // Trustless Contracts — per-module creation events
  "CoinForCoinCreatedEvent",
  "CoinForItemCreatedEvent",
  "ItemForCoinCreatedEvent",
  "ItemForItemCreatedEvent",
  "TransportCreatedEvent",
  // Trustless Contracts — shared lifecycle events (in contract_utils)
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
  // Witnessed Contracts — Build Request
  "BuildRequestCreatedEvent",
  "BuildRequestFulfilledEvent",
  "BuildRequestCancelledEvent",
  "BuildRequestExpiredEvent",
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
    trustlessContracts: string;
    witnessedContracts?: string;
  };
  /** Postgres connection string */
  databaseUrl: string;
  /** API server port */
  apiPort: number;
  /** Polling interval for event queries (ms) */
  pollIntervalMs: number;
  /** Cleanup worker configuration */
  cleanup: CleanupConfig;
}

export interface CleanupConfig {
  /** Feature flag to enable/disable the cleanup worker */
  enabled: boolean;
  /** Base64-encoded Ed25519 private key for the service wallet */
  privateKey: string;
  /** Delay (ms) after a contract completes before submitting cleanup */
  delayMs: number;
  /** How often the worker polls for pending jobs (ms) */
  intervalMs: number;
  /** Max retries per cleanup job before marking as failed */
  maxRetries: number;
  /** Gas budget per cleanup transaction (MIST) */
  gasBudget: number;
  /** Coin type for CE (escrow) type argument — default 0x2::sui::SUI */
  coinType: string;
  /** Coin type for CF (fill) type argument — default same as coinType */
  fillCoinType: string;
}

export const DEFAULT_CONFIG: IndexerConfig = {
  suiRpcUrl: process.env.SUI_RPC_URL ?? "http://127.0.0.1:9000",
  packageIds: {
    tribe: process.env.PACKAGE_TRIBE ?? "",
    trustlessContracts: process.env.PACKAGE_TRUSTLESS_CONTRACTS ?? "",
  },
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://corm:corm@localhost:5432/frontier_corm",
  apiPort: Number(process.env.API_PORT) || 3100,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 2000,
  cleanup: {
    enabled: process.env.CLEANUP_ENABLED === "true",
    privateKey: process.env.CLEANUP_WORKER_PRIVATE_KEY ?? "",
    delayMs: Number(process.env.CLEANUP_DELAY_MS) || 30_000,
    intervalMs: Number(process.env.CLEANUP_INTERVAL_MS) || 15_000,
    maxRetries: Number(process.env.CLEANUP_MAX_RETRIES) || 3,
    gasBudget: Number(process.env.CLEANUP_GAS_BUDGET) || 5_000_000,
    coinType: process.env.CLEANUP_COIN_TYPE ?? "0x2::sui::SUI",
    fillCoinType: process.env.CLEANUP_FILL_COIN_TYPE ?? process.env.CLEANUP_COIN_TYPE ?? "0x2::sui::SUI",
  },
};
