/**
 * Programmable Transaction Block (PTB) builders for Frontier Lattice contracts.
 *
 * Each function returns a Transaction object ready for useSignAndExecuteTransaction.
 * Type argument C (coin type) is taken from config.coinType.
 */

import { Transaction } from "@mysten/sui/transactions";
import { config } from "../config";
import type { Role } from "./types";

const { packages, coinType } = config;
const SUI_CLOCK = "0x6";

// ============================================================
// Tribe (Phase 1)
// ============================================================

export function buildCreateTribe(params: {
  characterId: string;
  name: string;
  voteThreshold: number;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.tribe}::tribe::create_tribe`,
    typeArguments: [coinType],
    arguments: [
      tx.object(params.characterId),
      tx.pure.string(params.name),
      tx.pure.u64(params.voteThreshold),
    ],
  });
  return tx;
}

export function buildAddMember(params: {
  tribeId: string;
  capId: string;
  newMemberCharacterId: string;
  role: Role;
}): Transaction {
  const tx = new Transaction();
  const roleTarget = `${packages.tribe}::tribe::role_${params.role.toLowerCase()}`;
  const [role] = tx.moveCall({ target: roleTarget });
  tx.moveCall({
    target: `${packages.tribe}::tribe::add_member`,
    typeArguments: [coinType],
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.object(params.newMemberCharacterId),
      role,
    ],
  });
  return tx;
}

export function buildRemoveMember(params: {
  tribeId: string;
  capId: string;
  characterId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.tribe}::tribe::remove_member`,
    typeArguments: [coinType],
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
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.tribe}::tribe::update_reputation`,
    typeArguments: [coinType],
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

export function buildDepositToTreasury(params: {
  tribeId: string;
  amount: number;
}): Transaction {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [params.amount]);
  tx.moveCall({
    target: `${packages.tribe}::tribe::deposit_to_treasury`,
    typeArguments: [coinType],
    arguments: [tx.object(params.tribeId), coin],
  });
  return tx;
}

export function buildProposeTreasurySpend(params: {
  tribeId: string;
  capId: string;
  amount: number;
  recipient: string;
  deadlineMs: number;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.tribe}::tribe::propose_treasury_spend`,
    typeArguments: [coinType],
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
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.tribe}::tribe::vote_on_proposal`,
    typeArguments: [coinType],
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
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.tribe}::tribe::execute_proposal`,
    typeArguments: [coinType],
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
    typeArguments: [coinType],
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
    typeArguments: [coinType],
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
    typeArguments: [coinType],
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
    typeArguments: [coinType],
    arguments: [tx.object(params.jobId), tx.object(params.capId)],
  });
  return tx;
}

export function buildExpireJob(params: { jobId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packages.contractBoard}::contract_board::expire_job`,
    typeArguments: [coinType],
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
    typeArguments: [coinType],
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
    typeArguments: [coinType],
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
    typeArguments: [coinType],
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
    typeArguments: [coinType],
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
    typeArguments: [coinType],
    arguments: [tx.object(params.orderId), tx.object(params.capId)],
  });
  return tx;
}
