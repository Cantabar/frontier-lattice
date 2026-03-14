/**
 * Programmable Transaction Block (PTB) builders for Frontier Corm contracts.
 *
 * Each function returns a Transaction object ready for useSignAndExecuteTransaction.
 * Type argument C (coin type) defaults to config.coinType but can be overridden
 * per-call to support tribes with custom coin types.
 */

import { Transaction } from "@mysten/sui/transactions";
import { config } from "../config";
import { isNativeSui } from "./coinUtils";
import type { Role } from "./types";

const { packages, coinType: defaultCoinType } = config;
const SUI_CLOCK = "0x6";

/** Resolve coin type: use explicit override or fall back to config default. */
function ct(override?: string): string {
  return override ?? defaultCoinType;
}

// ============================================================
// Tribe (Phase 1)
// ============================================================

export function buildCreateTribe(params: {
  registryId: string;
  characterId: string;
  name: string;
  voteThreshold: number;
  sender: string;
  coinType?: string;
}): Transaction {
  const tx = new Transaction();
  const [leaderCap] = tx.moveCall({
    target: `${packages.tribe}::tribe::create_tribe`,
    typeArguments: [ct(params.coinType)],
    arguments: [
      tx.object(params.registryId),
      tx.object(params.characterId),
      tx.pure.string(params.name),
      tx.pure.u64(params.voteThreshold),
    ],
  });
  tx.transferObjects([leaderCap], tx.pure.address(params.sender));
  return tx;
}

export function buildAddMember(params: {
  tribeId: string;
  capId: string;
  newMemberCharacterId: string;
  role: Role;
  newMemberAddress: string;
  coinType?: string;
}): Transaction {
  const tx = new Transaction();
  const roleTarget = `${packages.tribe}::tribe::role_${params.role.toLowerCase()}`;
  const [role] = tx.moveCall({ target: roleTarget });
  const [memberCap] = tx.moveCall({
    target: `${packages.tribe}::tribe::add_member`,
    typeArguments: [ct(params.coinType)],
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.object(params.newMemberCharacterId),
      role,
    ],
  });
  tx.transferObjects([memberCap], tx.pure.address(params.newMemberAddress));
  return tx;
}

export function buildRemoveMember(params: {
  tribeId: string;
  capId: string;
  characterId: string;
  coinType?: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.tribe}::tribe::remove_member`,
    typeArguments: [ct(params.coinType)],
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.pure.id(params.characterId),
    ],
  });
  return tx;
}

export function buildUpdateReputation(params: {
  tribeId: string;
  capId: string;
  characterId: string;
  delta: number;
  increase: boolean;
  coinType?: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.tribe}::tribe::update_reputation`,
    typeArguments: [ct(params.coinType)],
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.pure.id(params.characterId),
      tx.pure.u64(params.delta),
      tx.pure.bool(params.increase),
    ],
  });
  return tx;
}

/**
 * Deposit coins into a tribe treasury.
 *
 * For native SUI, splits from gas. For custom coins, the caller must provide
 * `coinObjectIds` — the owned Coin<C> objects to merge and split from.
 */
export function buildDepositToTreasury(params: {
  tribeId: string;
  amount: number;
  coinType?: string;
  /** Required when coinType is not native SUI. Owned Coin<C> object IDs. */
  coinObjectIds?: string[];
}): Transaction {
  const tx = new Transaction();
  const resolvedType = ct(params.coinType);

  let coin;
  if (isNativeSui(resolvedType)) {
    [coin] = tx.splitCoins(tx.gas, [params.amount]);
  } else {
    // Merge all provided coin objects, then split the deposit amount
    const ids = params.coinObjectIds ?? [];
    if (ids.length === 0) throw new Error("coinObjectIds required for non-SUI deposits");
    const primary = tx.object(ids[0]);
    if (ids.length > 1) {
      tx.mergeCoins(primary, ids.slice(1).map((id) => tx.object(id)));
    }
    [coin] = tx.splitCoins(primary, [params.amount]);
  }

  tx.moveCall({
    target: `${packages.tribe}::tribe::deposit_to_treasury`,
    typeArguments: [resolvedType],
    arguments: [tx.object(params.tribeId), coin],
  });
  return tx;
}

export function buildWithdrawFromTreasury(params: {
  tribeId: string;
  capId: string;
  amount: number;
  recipient: string;
  coinType?: string;
}): Transaction {
  const tx = new Transaction();
  const [coin] = tx.moveCall({
    target: `${packages.tribe}::tribe::withdraw_from_treasury`,
    typeArguments: [ct(params.coinType)],
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.pure.u64(params.amount),
    ],
  });
  tx.transferObjects([coin], tx.pure.address(params.recipient));
  return tx;
}

/**
 * Build a transaction that calls tribe_for_game_id (read-only).
 * Execute via devInspectTransactionBlock to resolve an in-game tribe ID
 * to an on-chain Tribe object ID without signing.
 */
export function buildLookupTribeByGameId(params: {
  registryId: string;
  gameId: number;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.tribe}::tribe::tribe_for_game_id`,
    arguments: [
      tx.object(params.registryId),
      tx.pure.u32(params.gameId),
    ],
  });
  return tx;
}

export function buildProposeTreasurySpend(params: {
  tribeId: string;
  capId: string;
  amount: number;
  recipient: string;
  deadlineMs: number;
  coinType?: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.tribe}::tribe::propose_treasury_spend`,
    typeArguments: [ct(params.coinType)],
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.pure.u64(params.amount),
      tx.pure.address(params.recipient),
      tx.pure.u64(params.deadlineMs),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildVoteOnProposal(params: {
  tribeId: string;
  proposalId: string;
  capId: string;
  coinType?: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.tribe}::tribe::vote_on_proposal`,
    typeArguments: [ct(params.coinType)],
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.proposalId),
      tx.object(params.capId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildExecuteProposal(params: {
  tribeId: string;
  proposalId: string;
  coinType?: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.tribe}::tribe::execute_proposal`,
    typeArguments: [ct(params.coinType)],
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.proposalId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

// ============================================================
// Contract Board (Phase 2)
// ============================================================

export function buildCreateJob(params: {
  tribeId: string;
  capId: string;
  characterId: string;
  description: string;
  completionType: { target: string; args: unknown[] };
  escrowAmount: number;
  deadlineMs: number;
  minReputation: number;
}): Transaction {
  const tx = new Transaction();
  const [completionType] = tx.moveCall({
    target: params.completionType.target,
    arguments: params.completionType.args as ReturnType<typeof tx.pure.string>[],
  });
  const [escrowCoin] = tx.splitCoins(tx.gas, [params.escrowAmount]);
  tx.moveCall({
    target: `${packages.contractBoard}::contract_board::create_job`,
    typeArguments: [defaultCoinType],
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.object(params.characterId),
      tx.pure.string(params.description),
      completionType,
      escrowCoin,
      tx.pure.u64(params.deadlineMs),
      tx.pure.u64(params.minReputation),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildAcceptJob(params: {
  jobId: string;
  tribeId: string;
  capId: string;
  characterId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.contractBoard}::contract_board::accept_job`,
    typeArguments: [defaultCoinType],
    arguments: [
      tx.object(params.jobId),
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.object(params.characterId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildConfirmCompletion(params: {
  jobId: string;
  capId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.contractBoard}::contract_board::confirm_completion`,
    typeArguments: [defaultCoinType],
    arguments: [tx.object(params.jobId), tx.object(params.capId)],
  });
  return tx;
}

export function buildCancelJob(params: {
  jobId: string;
  capId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.contractBoard}::contract_board::cancel_job`,
    typeArguments: [defaultCoinType],
    arguments: [tx.object(params.jobId), tx.object(params.capId)],
  });
  return tx;
}

export function buildExpireJob(params: { jobId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.contractBoard}::contract_board::expire_job`,
    typeArguments: [defaultCoinType],
    arguments: [tx.object(params.jobId), tx.object(SUI_CLOCK)],
  });
  return tx;
}

// ============================================================
// Forge Planner (Phase 3)
// ============================================================

export function buildCreateRegistry(params: {
  tribeId: string;
  capId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.forgePlanner}::forge_planner::create_registry`,
    typeArguments: [defaultCoinType],
    arguments: [tx.object(params.tribeId), tx.object(params.capId)],
  });
  return tx;
}

export function buildAddRecipe(params: {
  registryId: string;
  tribeId: string;
  capId: string;
  outputTypeId: number;
  outputQuantity: number;
  inputs: { typeId: number; quantity: number }[];
  runTime: number;
}): Transaction {
  const tx = new Transaction();
  const inputTypeIds = params.inputs.map((i) => i.typeId);
  const inputQuantities = params.inputs.map((i) => i.quantity);
  tx.moveCall({
    target: `${packages.forgePlanner}::forge_planner::add_recipe`,
    typeArguments: [defaultCoinType],
    arguments: [
      tx.object(params.registryId),
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.pure.u64(params.outputTypeId),
      tx.pure.u32(params.outputQuantity),
      tx.pure("vector<u64>", inputTypeIds),
      tx.pure("vector<u32>", inputQuantities),
      tx.pure.u64(params.runTime),
    ],
  });
  return tx;
}

export function buildCreateOrder(params: {
  registryId: string;
  tribeId: string;
  capId: string;
  characterId: string;
  description: string;
  outputTypeId: number;
  runCount: number;
  bountyAmount: number;
}): Transaction {
  const tx = new Transaction();
  const [bountyCoin] = tx.splitCoins(tx.gas, [params.bountyAmount]);
  tx.moveCall({
    target: `${packages.forgePlanner}::forge_planner::create_order`,
    typeArguments: [defaultCoinType],
    arguments: [
      tx.object(params.registryId),
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.object(params.characterId),
      tx.pure.string(params.description),
      tx.pure.u64(params.outputTypeId),
      tx.pure.u64(params.runCount),
      bountyCoin,
    ],
  });
  return tx;
}

export function buildFulfillOrder(params: {
  orderId: string;
  capId: string;
  fulfillerCharacterId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.forgePlanner}::forge_planner::fulfill_order`,
    typeArguments: [defaultCoinType],
    arguments: [
      tx.object(params.orderId),
      tx.object(params.capId),
      tx.object(params.fulfillerCharacterId),
    ],
  });
  return tx;
}

export function buildCancelOrder(params: {
  orderId: string;
  capId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.forgePlanner}::forge_planner::cancel_order`,
    typeArguments: [defaultCoinType],
    arguments: [tx.object(params.orderId), tx.object(params.capId)],
  });
  return tx;
}

// ============================================================
// Trustless Contracts
// ============================================================

const { fillCoinType } = config;
const tcPkg = () => packages.trustlessContracts;
const tcTarget = (fn: string) => `${tcPkg()}::trustless_contracts::${fn}`;
const tcTypes = () => [defaultCoinType, fillCoinType];

// --- Creation ---

export function buildCreateCoinForCoin(params: {
  characterId: string;
  escrowAmount: number;
  wantedAmount: number;
  allowPartial: boolean;
  deadlineMs: number;
  allowedCharacters: string[];
  allowedTribes: number[];
}): Transaction {
  const tx = new Transaction();
  const [escrow] = tx.splitCoins(tx.gas, [params.escrowAmount]);
  tx.moveCall({
    target: tcTarget("create_coin_for_coin"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.characterId),
      escrow,
      tx.pure.u64(params.wantedAmount),
      tx.pure.bool(params.allowPartial),
      tx.pure.u64(params.deadlineMs),
      tx.pure("vector<address>", params.allowedCharacters),
      tx.pure("vector<u32>", params.allowedTribes),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildCreateCoinForItem(params: {
  characterId: string;
  escrowAmount: number;
  wantedTypeId: number;
  wantedQuantity: number;
  destinationSsuId: string;
  allowPartial: boolean;
  deadlineMs: number;
  allowedCharacters: string[];
  allowedTribes: number[];
}): Transaction {
  const tx = new Transaction();
  const [escrow] = tx.splitCoins(tx.gas, [params.escrowAmount]);
  tx.moveCall({
    target: tcTarget("create_coin_for_item"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.characterId),
      escrow,
      tx.pure.u64(params.wantedTypeId),
      tx.pure.u32(params.wantedQuantity),
      tx.pure.id(params.destinationSsuId),
      tx.pure.bool(params.allowPartial),
      tx.pure.u64(params.deadlineMs),
      tx.pure("vector<address>", params.allowedCharacters),
      tx.pure("vector<u32>", params.allowedTribes),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildCreateItemForCoin(params: {
  characterId: string;
  sourceSsuId: string;
  itemId: string;
  wantedAmount: number;
  allowPartial: boolean;
  deadlineMs: number;
  allowedCharacters: string[];
  allowedTribes: number[];
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget("create_item_for_coin"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.characterId),
      tx.object(params.sourceSsuId),
      tx.object(params.itemId),
      tx.pure.u64(params.wantedAmount),
      tx.pure.bool(params.allowPartial),
      tx.pure.u64(params.deadlineMs),
      tx.pure("vector<address>", params.allowedCharacters),
      tx.pure("vector<u32>", params.allowedTribes),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildCreateItemForItem(params: {
  characterId: string;
  sourceSsuId: string;
  itemId: string;
  wantedTypeId: number;
  wantedQuantity: number;
  destinationSsuId: string;
  allowPartial: boolean;
  deadlineMs: number;
  allowedCharacters: string[];
  allowedTribes: number[];
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget("create_item_for_item"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.characterId),
      tx.object(params.sourceSsuId),
      tx.object(params.itemId),
      tx.pure.u64(params.wantedTypeId),
      tx.pure.u32(params.wantedQuantity),
      tx.pure.id(params.destinationSsuId),
      tx.pure.bool(params.allowPartial),
      tx.pure.u64(params.deadlineMs),
      tx.pure("vector<address>", params.allowedCharacters),
      tx.pure("vector<u32>", params.allowedTribes),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildCreateTransport(params: {
  characterId: string;
  escrowAmount: number;
  itemTypeId: number;
  itemQuantity: number;
  destinationSsuId: string;
  requiredStake: number;
  deadlineMs: number;
  allowedCharacters: string[];
  allowedTribes: number[];
}): Transaction {
  const tx = new Transaction();
  const [escrow] = tx.splitCoins(tx.gas, [params.escrowAmount]);
  tx.moveCall({
    target: tcTarget("create_transport"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.characterId),
      escrow,
      tx.pure.u64(params.itemTypeId),
      tx.pure.u32(params.itemQuantity),
      tx.pure.id(params.destinationSsuId),
      tx.pure.u64(params.requiredStake),
      tx.pure.u64(params.deadlineMs),
      tx.pure("vector<address>", params.allowedCharacters),
      tx.pure("vector<u32>", params.allowedTribes),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

// --- Filling ---

export function buildFillWithCoins(params: {
  contractId: string;
  fillAmount: number;
  characterId: string;
}): Transaction {
  const tx = new Transaction();
  const [fill] = tx.splitCoins(tx.gas, [params.fillAmount]);
  tx.moveCall({
    target: tcTarget("fill_with_coins"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.contractId),
      fill,
      tx.object(params.characterId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildFillWithItems(params: {
  contractId: string;
  destinationSsuId: string;
  posterCharacterId: string;
  fillerCharacterId: string;
  itemId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget("fill_with_items"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.destinationSsuId),
      tx.object(params.posterCharacterId),
      tx.object(params.fillerCharacterId),
      tx.object(params.itemId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildFillItemForCoin(params: {
  contractId: string;
  sourceSsuId: string;
  characterId: string;
  fillAmount: number;
}): Transaction {
  const tx = new Transaction();
  const [fill] = tx.splitCoins(tx.gas, [params.fillAmount]);
  tx.moveCall({
    target: tcTarget("fill_item_for_coin"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.sourceSsuId),
      tx.object(params.characterId),
      fill,
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

// --- Transport ---

export function buildAcceptTransport(params: {
  contractId: string;
  stakeAmount: number;
  characterId: string;
}): Transaction {
  const tx = new Transaction();
  const [stake] = tx.splitCoins(tx.gas, [params.stakeAmount]);
  tx.moveCall({
    target: tcTarget("accept_transport"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.contractId),
      stake,
      tx.object(params.characterId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildDeliverTransport(params: {
  contractId: string;
  destinationSsuId: string;
  courierCharacterId: string;
  posterCharacterId: string;
  itemId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget("deliver_transport"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.destinationSsuId),
      tx.object(params.courierCharacterId),
      tx.object(params.posterCharacterId),
      tx.object(params.itemId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

// --- Lifecycle ---

export function buildCancelTrustlessContract(params: {
  contractId: string;
  characterId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget("cancel_contract"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.characterId),
    ],
  });
  return tx;
}

export function buildExpireTrustlessContract(params: {
  contractId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget("expire_contract"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.contractId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}
