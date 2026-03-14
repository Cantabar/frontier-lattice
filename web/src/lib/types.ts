/**
 * Shared UI types mirroring on-chain Move structs and indexer responses.
 *
 * Sui RPC returns object IDs as hex strings and u64 values as strings.
 */

// ============================================================
// Character Profile (resolved from on-chain Character objects)
// ============================================================

export interface CharacterProfile {
  characterId: string;
  name: string;
  portraitUrl: string;
  tribeId: number;
}

// ============================================================
// Tribe (Phase 1)
// ============================================================

export type Role = "Leader" | "Officer" | "Member";

export interface TribeMember {
  characterId: string;
  role: Role;
  reputation: number;
}

export interface TribeData {
  id: string;
  name: string;
  inGameTribeId: number;
  leaderCharacterId: string;
  memberCount: number;
  treasuryBalance: string; // u64 as string
  voteThreshold: number;
  members: TribeMember[];
  /** Full coin type string extracted from the Tribe<C> object type */
  coinType: string;
}

export interface TribeCapData {
  id: string;
  tribeId: string;
  characterId: string;
  role: Role;
}

/** Lightweight tribe summary for list/discovery views. */
export interface TribeListItem {
  id: string;
  name: string;
  inGameTribeId: number;
  leaderCharacterId: string;
  /** Full coin type string. Optional — may not be available from event-sourced lists. */
  coinType?: string;
}

/** Tribe metadata from the Stillness World API (/v2/tribes). */
export interface WorldTribeInfo {
  id: number;
  name: string;
  nameShort: string; // ticker, e.g. "PGCL"
  description: string;
  taxRate: number;
  tribeUrl: string;
}

/** Merged tribe entry for the All Tribes display. */
export interface InGameTribe {
  inGameTribeId: number;
  characterCount: number;
  onChainTribe: TribeListItem | null;
  worldInfo: WorldTribeInfo | null;
}

export interface TreasuryProposalData {
  id: string;
  tribeId: string;
  amount: string;
  recipient: string;
  voteCount: number;
  executed: boolean;
  deadlineMs: string;
}

// ============================================================
// Contract Board (Phase 2)
// ============================================================

export type CompletionType =
  | { variant: "Delivery"; storageUnitId: string; typeId: number; quantity: number }
  | { variant: "Bounty"; targetCharacterId: string }
  | { variant: "Transport"; gateId: string }
  | { variant: "Custom"; commitmentHash: number[] };

export type JobStatus = "Open" | "Assigned" | "Disputed";

export interface JobPostingData {
  id: string;
  posterId: string;
  posterAddress: string;
  posterTribeId: string;
  description: string;
  completionType: CompletionType;
  rewardAmount: string;
  assigneeId?: string;
  assigneeAddress?: string;
  deadlineMs: string;
  status: JobStatus;
  minReputation: number;
}

// ============================================================
// Forge Planner (Phase 3)
// ============================================================

export interface InputRequirement {
  typeId: number;
  quantity: number;
}

export interface RecipeData {
  outputTypeId: number;
  outputQuantity: number;
  inputs: InputRequirement[];
  runTime: number;
}

export interface RecipeRegistryData {
  id: string;
  tribeId: string;
  recipeCount: number;
}

export interface ManufacturingOrderData {
  id: string;
  tribeId: string;
  registryId: string;
  creatorId: string;
  creatorAddress: string;
  description: string;
  outputTypeId: number;
  outputQuantity: number;
  runCount: number;
  requiredInputs: InputRequirement[];
  bountyAmount: string;
  status: "Active";
}

// ============================================================
// Trustless Contracts
// ============================================================

export type TrustlessContractVariant =
  | "CoinForCoin"
  | "CoinForItem"
  | "ItemForCoin"
  | "ItemForItem"
  | "Transport";

export type TrustlessContractType =
  | { variant: "CoinForCoin"; offeredAmount: string; wantedAmount: string }
  | { variant: "CoinForItem"; offeredAmount: string; wantedTypeId: number; wantedQuantity: number; destinationSsuId: string }
  | { variant: "ItemForCoin"; offeredTypeId: number; offeredQuantity: number; sourceSsuId: string; wantedAmount: string }
  | { variant: "ItemForItem"; offeredTypeId: number; offeredQuantity: number; sourceSsuId: string; wantedTypeId: number; wantedQuantity: number; destinationSsuId: string }
  | { variant: "Transport"; itemTypeId: number; itemQuantity: number; destinationSsuId: string; paymentAmount: string; requiredStake: string };

export type TrustlessContractStatus = "Open" | "InProgress";

export interface TrustlessContractData {
  id: string;
  posterId: string;
  posterAddress: string;
  contractType: TrustlessContractType;
  escrowAmount: string;
  targetQuantity: string;
  filledQuantity: string;
  allowPartial: boolean;
  requireStake: boolean;
  stakeAmount: string;
  deadlineMs: string;
  status: TrustlessContractStatus;
  courierId?: string;
  courierAddress?: string;
  allowedCharacters: string[];
  allowedTribes: number[];
}

// ============================================================
// Smart Assemblies (Structures)
// ============================================================

export type AssemblyStatus = "Anchored" | "Online" | "Offline" | "Unanchoring";

export interface AssemblyData {
  id: string;
  ownerCapId: string;
  typeId: number;
  status: AssemblyStatus;
  name: string;
  description: string;
  imageUrl: string;
  energySourceId: string | null;
}

/**
 * Well-known assembly type IDs from the world contracts.
 * These map `type_id` values to human-readable labels.
 */
export const ASSEMBLY_TYPES: Record<number, { label: string; short: string }> = {
  // From static-data/data/phobos/fsd_built/types.json — extend as new types are added.
  88082: { label: "Mini Storage", short: "SSU" },
  88083: { label: "Storage", short: "SSU" },
  88084: { label: "Large Storage Unit", short: "SSU" },
  87566: { label: "Field Storage", short: "SSU" },
  91713: { label: "Mini Storage", short: "SSU" },
  91714: { label: "Storage", short: "SSU" },
  91715: { label: "Heavy Storage", short: "SSU" },
  84955: { label: "Heavy Gate", short: "Gate" },
  88086: { label: "Mini Gate", short: "Gate" },
  87495: { label: "Deployable Stargate Small", short: "Gate" },
  91711: { label: "Mini Gate", short: "Gate" },
  91712: { label: "Heavy Gate", short: "Gate" },
  92279: { label: "Mini Turret", short: "Turret" },
  92280: { label: "Mini Turret", short: "Turret" },
  92401: { label: "Turret", short: "Turret" },
};

/** All known assembly type categories for filtering. */
export type AssemblyTypeFilter = "all" | "SSU" | "Gate" | "Turret";

// ============================================================
// Indexer event types (Phase 4)
// ============================================================

export type EventTypeName =
  // Tribe
  | "TribeRegistryCreatedEvent"
  | "TribeCreatedEvent"
  | "MemberJoinedEvent"
  | "MemberRemovedEvent"
  | "ReputationUpdatedEvent"
  | "TreasuryDepositEvent"
  | "TreasuryProposalCreatedEvent"
  | "TreasuryProposalVotedEvent"
  | "TreasurySpendEvent"
  | "TreasuryWithdrawEvent"
  // Contract Board
  | "JobCreatedEvent"
  | "JobAcceptedEvent"
  | "JobCompletedEvent"
  | "JobExpiredEvent"
  | "JobCancelledEvent"
  // Forge Planner
  | "RecipeRegistryCreatedEvent"
  | "RecipeAddedEvent"
  | "RecipeRemovedEvent"
  | "OrderCreatedEvent"
  | "OrderFulfilledEvent"
  | "OrderCancelledEvent"
  // Trustless Contracts
  | "ContractCreatedEvent"
  | "ContractFilledEvent"
  | "ContractCompletedEvent"
  | "ContractCancelledEvent"
  | "ContractExpiredEvent"
  | "TransportAcceptedEvent"
  | "TransportDeliveredEvent";

export interface ArchivedEvent {
  id: number;
  event_type: string;
  event_name: EventTypeName;
  event_data: Record<string, unknown>;
  tx_digest: string;
  event_seq: number;
  checkpoint_seq: string | null;
  checkpoint_digest: string | null;
  timestamp_ms: string;
  primary_id: string | null;
  tribe_id: string | null;
  character_id: string | null;
}

export interface ReputationSnapshot {
  tribe_id: string;
  character_id: string;
  score: number;
  last_event_id: number;
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}
