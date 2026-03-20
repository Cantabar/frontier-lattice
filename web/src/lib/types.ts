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

// ============================================================
// Multi-Input Contract
// ============================================================

export interface MultiInputSlot {
  typeId: number;
  required: number;
  filled: number;
}

export interface MultiInputContractData {
  id: string;
  posterId: string;
  posterAddress: string;
  description: string;
  destinationSsuId: string;
  slots: MultiInputSlot[];
  totalRequired: number;
  totalFilled: number;
  bountyAmount: string;
  /** Live remaining bounty balance (from getObject, absent when sourced from event). */
  bountyBalance?: string;
  deadlineMs: string;
  allowedCharacters: string[];
  allowedTribes: number[];
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
  | { variant: "Transport"; itemTypeId: number; itemQuantity: number; sourceSsuId: string; destinationSsuId: string; paymentAmount: string; requiredStake: string };

export type TrustlessContractStatus = "Open" | "InProgress" | "Completed";

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
  /** Items released to fillers so far (ItemForCoin / ItemForItem only; absent for event-sourced data). */
  itemsReleased?: number;
  /** When true, filled items are deposited to the SSU's owner inventory instead of the poster's player inventory. */
  useOwnerInventory?: boolean;
}

// ============================================================
// Smart Assemblies (Structures)
// ============================================================

export type AssemblyStatus = "Anchored" | "Online" | "Offline" | "Unanchoring";

/** Network Node — energy source that powers connected assemblies. */
export interface NetworkNodeData {
  id: string;
  typeId: number;
  status: AssemblyStatus;
  name: string;
  fuelQuantity: number;
  fuelMaxCapacity: number;
  maxEnergyProduction: number;
  currentEnergyProduction: number;
  totalReservedEnergy: number;
  connectedAssemblyCount: number;
}

/** Which Move module the structure belongs to — needed to target the correct on-chain entry function. */
export type StructureMoveType = "Assembly" | "StorageUnit" | "Gate" | "Turret";

export interface AssemblyData {
  id: string;
  ownerCapId: string;
  /** OwnerCap object version (needed for Receiving<T> in PTBs). */
  ownerCapVersion: string;
  /** OwnerCap object digest (needed for Receiving<T> in PTBs). */
  ownerCapDigest: string;
  typeId: number;
  status: AssemblyStatus;
  /** Move module type (Assembly, StorageUnit, Gate, Turret). */
  moveType: StructureMoveType;
  name: string;
  description: string;
  imageUrl: string;
  energySourceId: string | null;
  /** Authorized extension TypeName (e.g. "…::corm_auth::CormAuth"), or null if none. */
  extension: string | null;
}

/**
 * Structure group as defined by the game's group hierarchy.
 * Used for categorising structures in the UI and filtering.
 */
export type AssemblyGroup =
  | "Core"
  | "Industry"
  | "Storage"
  | "Gate"
  | "Defense"
  | "Hangar"
  | "Misc"
  | "Beacon"
  | "Construction";

export interface AssemblyTypeInfo {
  label: string;
  /** Short category used by the filter tabs (backward-compat). */
  short: string;
  /** Structural group from the static data. */
  group: AssemblyGroup;
}

/**
 * Well-known assembly type IDs from the world contracts.
 * These map `type_id` values to human-readable labels.
 *
 * Generated from static-data/data/phobos/fsd_built/types.json — category 22 (Deployable).
 */
export const ASSEMBLY_TYPES: Record<number, AssemblyTypeInfo> = {
  // ── Core (group 4885) ──────────────────────────────────────────
  87160: { label: "Refuge", short: "Core", group: "Core" },
  87161: { label: "Field Refinery", short: "Core", group: "Core" },
  87162: { label: "Field Printer", short: "Core", group: "Core" },
  87566: { label: "Field Storage", short: "Core", group: "Core" },
  88092: { label: "Network Node", short: "Core", group: "Core" },

  // ── Industry (group 4848) ──────────────────────────────────────
  87119: { label: "Mini Printer", short: "Industry", group: "Industry" },
  87120: { label: "Heavy Printer", short: "Industry", group: "Industry" },
  88063: { label: "Refinery", short: "Industry", group: "Industry" },
  88064: { label: "Heavy Refinery", short: "Industry", group: "Industry" },
  88067: { label: "Printer", short: "Industry", group: "Industry" },
  88068: { label: "Assembler", short: "Industry", group: "Industry" },
  88069: { label: "Mini Berth", short: "Industry", group: "Industry" },
  88070: { label: "Berth", short: "Industry", group: "Industry" },
  88071: { label: "Heavy Berth", short: "Industry", group: "Industry" },
  90184: { label: "Relay", short: "Industry", group: "Industry" },
  91978: { label: "Nursery", short: "Industry", group: "Industry" },

  // ── Storage (group 4849) ───────────────────────────────────────
  77917: { label: "Heavy Storage", short: "Storage", group: "Storage" },
  88082: { label: "Mini Storage", short: "Storage", group: "Storage" },
  88083: { label: "Storage", short: "Storage", group: "Storage" },

  // ── Gates (group 4850) ─────────────────────────────────────────
  84955: { label: "Heavy Gate", short: "Gate", group: "Gate" },
  88086: { label: "Mini Gate", short: "Gate", group: "Gate" },

  // ── Defense (group 4851) ───────────────────────────────────────
  92279: { label: "Mini Turret", short: "Defense", group: "Defense" },
  92401: { label: "Turret", short: "Defense", group: "Defense" },
  92404: { label: "Heavy Turret", short: "Defense", group: "Defense" },

  // ── Hangars (group 4854) ───────────────────────────────────────
  88093: { label: "Shelter", short: "Hangar", group: "Hangar" },
  88094: { label: "Heavy Shelter", short: "Hangar", group: "Hangar" },
  91871: { label: "Nest", short: "Hangar", group: "Hangar" },

  // ── Miscellaneous / Decorative (group 4855) ────────────────────
  88098: { label: "Monolith 1", short: "Misc", group: "Misc" },
  88099: { label: "Monolith 2", short: "Misc", group: "Misc" },
  88100: { label: "Wall 1", short: "Misc", group: "Misc" },
  88101: { label: "Wall 2", short: "Misc", group: "Misc" },
  89775: { label: "SEER I", short: "Misc", group: "Misc" },
  89776: { label: "SEER II", short: "Misc", group: "Misc" },
  89777: { label: "HARBINGER I", short: "Misc", group: "Misc" },
  89778: { label: "HARBINGER II", short: "Misc", group: "Misc" },
  89779: { label: "RAINMAKER II", short: "Misc", group: "Misc" },
  89780: { label: "RAINMAKER I", short: "Misc", group: "Misc" },

  // ── Beacon (group 4814) ────────────────────────────────────────
  85291: { label: "Deployable Beacon", short: "Beacon", group: "Beacon" },

  // ── Construction Sites (group 5021) ────────────────────────────
  // Duplicates of the above with separate typeIDs; share the same icons.
  91700: { label: "Mini Printer", short: "Industry", group: "Construction" },
  91701: { label: "Printer", short: "Industry", group: "Construction" },
  91702: { label: "Heavy Printer", short: "Industry", group: "Construction" },
  91703: { label: "Refinery", short: "Industry", group: "Construction" },
  91704: { label: "Heavy Refinery", short: "Industry", group: "Construction" },
  91705: { label: "Mini Berth", short: "Industry", group: "Construction" },
  91706: { label: "Berth", short: "Industry", group: "Construction" },
  91707: { label: "Heavy Berth", short: "Industry", group: "Construction" },
  91708: { label: "Assembler", short: "Industry", group: "Construction" },
  91709: { label: "Shelter", short: "Hangar", group: "Construction" },
  91710: { label: "Heavy Shelter", short: "Hangar", group: "Construction" },
  91711: { label: "Mini Gate", short: "Gate", group: "Construction" },
  91712: { label: "Heavy Gate", short: "Gate", group: "Construction" },
  91713: { label: "Mini Storage", short: "Storage", group: "Construction" },
  91714: { label: "Storage", short: "Storage", group: "Construction" },
  91715: { label: "Heavy Storage", short: "Storage", group: "Construction" },
  91717: { label: "Relay", short: "Industry", group: "Construction" },
  91718: { label: "Monolith 1", short: "Misc", group: "Construction" },
  91719: { label: "Monolith 2", short: "Misc", group: "Construction" },
  91720: { label: "Wall 1", short: "Misc", group: "Construction" },
  91721: { label: "Wall 2", short: "Misc", group: "Construction" },
  91722: { label: "RAINMAKER I", short: "Misc", group: "Construction" },
  91723: { label: "RAINMAKER II", short: "Misc", group: "Construction" },
  91724: { label: "HARBINGER I", short: "Misc", group: "Construction" },
  91725: { label: "HARBINGER II", short: "Misc", group: "Construction" },
  91726: { label: "SEER I", short: "Misc", group: "Construction" },
  91727: { label: "SEER II", short: "Misc", group: "Construction" },
  91751: { label: "Refuge", short: "Core", group: "Construction" },
  91752: { label: "Field Refinery", short: "Core", group: "Construction" },
  91753: { label: "Field Printer", short: "Core", group: "Construction" },
  91756: { label: "Field Storage", short: "Core", group: "Construction" },
  92165: { label: "Nursery", short: "Industry", group: "Construction" },
  92166: { label: "Nest", short: "Hangar", group: "Construction" },
  92280: { label: "Mini Turret", short: "Defense", group: "Construction" },
  92406: { label: "Turret", short: "Defense", group: "Construction" },
  92407: { label: "Heavy Turret", short: "Defense", group: "Construction" },
};

/** All known assembly type categories for filtering. */
export type AssemblyTypeFilter = "all" | "Storage" | "Gate" | "Defense" | "Industry" | "Core" | "Hangar" | "Misc" | "Beacon";

// ============================================================
// Indexer event types (Phase 4)
// ============================================================

export type EventTypeName =
  // Tribe
  | "TribeRegistryCreatedEvent"
  | "TribeCreatedEvent"
  | "MemberJoinedEvent"
  | "MemberRemovedEvent"
  | "TreasuryDepositEvent"
  | "TreasuryProposalCreatedEvent"
  | "TreasuryProposalVotedEvent"
  | "TreasurySpendEvent"
  | "TreasuryWithdrawEvent"
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
  | "TransportDeliveredEvent"
  // Multi-Input Contract
  | "MultiInputContractCreatedEvent"
  | "SlotFilledEvent"
  | "MultiInputContractCompletedEvent"
  | "MultiInputContractCancelledEvent"
  | "MultiInputContractExpiredEvent";

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

export interface PaginationParams {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}
