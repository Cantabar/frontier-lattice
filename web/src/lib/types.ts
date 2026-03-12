/**
 * Shared UI types mirroring on-chain Move structs and indexer responses.
 *
 * Sui RPC returns object IDs as hex strings and u64 values as strings.
 */

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
  leaderCharacterId: string;
  memberCount: number;
  treasuryBalance: string; // u64 as string
  voteThreshold: number;
  members: TribeMember[];
}

export interface TribeCapData {
  id: string;
  tribeId: string;
  characterId: string;
  role: Role;
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
// Indexer event types (Phase 4)
// ============================================================

export type EventTypeName =
  // Tribe
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
  | "OrderCancelledEvent";

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
