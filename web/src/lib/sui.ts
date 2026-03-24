/**
 * Programmable Transaction Block (PTB) builders for Frontier Corm contracts.
 *
 * Each function returns a Transaction object ready for useSignAndExecuteTransaction.
 * Type argument C (coin type) defaults to config.coinType but can be overridden
 * per-call to support tribes with custom coin types.
 */

import { Transaction, Inputs } from "@mysten/sui/transactions";
import { config } from "../config";
import { isNativeSui } from "./coinUtils";
import type { Role, StructureMoveType } from "./types";

const { packages, coinType: defaultCoinType } = config;
const SUI_CLOCK = "0x6";

// ============================================================
// Shared types for SSU item withdrawal access modes
// ============================================================

/**
 * Discriminated union for how to withdraw items from an SSU.
 *
 * - `ssuOwner`: The filler owns the SSU. Uses OwnerCap<StorageUnit>.
 * - `character`: The filler has a player inventory on a non-owned SSU.
 *   Uses OwnerCap<Character> via withdraw_by_owner<Character>.
 */
export type ItemAccessMode =
  | {
      mode: "ssuOwner";
      ownerCapId: string;
      ownerCapVersion: string;
      ownerCapDigest: string;
    }
  | {
      mode: "character";
      ownerCapId: string;
      ownerCapVersion: string;
      ownerCapDigest: string;
    };

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
  sender: string;
}): Transaction {
  const tx = new Transaction();
  const [leaderCap] = tx.moveCall({
    target: `${packages.tribe}::tribe::create_tribe`,
    arguments: [
      tx.object(params.registryId),
      tx.object(params.characterId),
      tx.pure.string(params.name),
    ],
  });
  tx.transferObjects([leaderCap], tx.pure.address(params.sender));
  return tx;
}

export function buildSelfJoinTribe(params: {
  tribeId: string;
  characterId: string;
  sender: string;
}): Transaction {
  const tx = new Transaction();
  const [memberCap] = tx.moveCall({
    target: `${packages.tribe}::tribe::self_join`,
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.characterId),
    ],
  });
  tx.transferObjects([memberCap], tx.pure.address(params.sender));
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
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.pure.id(params.characterId),
    ],
  });
  return tx;
}

/**
 * Atomically change a member's role
 * in a single PTB. Leader-only (remove_member requires Leader cap).
 * The new TribeCap is transferred to the member's wallet.
 */
export function buildChangeRole(params: {
  tribeId: string;
  capId: string;
  characterId: string;
  newRole: Role;
  memberWalletAddress: string;
}): Transaction {
  const tx = new Transaction();

  // Step 1: Remove the member (invalidates their old TribeCap)
  tx.moveCall({
    target: `${packages.tribe}::tribe::remove_member`,
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.pure.id(params.characterId),
    ],
  });

  // Step 2: Re-add with the new role (Character is a shared object)
  const roleTarget = `${packages.tribe}::tribe::role_${params.newRole.toLowerCase()}`;
  const [role] = tx.moveCall({ target: roleTarget });
  const [newCap] = tx.moveCall({
    target: `${packages.tribe}::tribe::add_member`,
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.object(params.characterId),
      role,
    ],
  });

  // Step 3: Transfer the new TribeCap to the member's wallet
  tx.transferObjects([newCap], tx.pure.address(params.memberWalletAddress));
  return tx;
}

/**
 * Transfer leadership to another tribe member. Leader-only.
 * Calls transfer_leadership<C> which returns two caps:
 * - new_leader_cap → transferred to newLeaderWalletAddress
 * - old_leader_cap → transferred to the caller (current leader)
 */
export function buildTransferLeadership(params: {
  tribeId: string;
  capId: string;
  newLeaderCharacterId: string;
  newLeaderWalletAddress: string;
  callerAddress: string;
}): Transaction {
  const tx = new Transaction();
  const [newLeaderCap, oldLeaderCap] = tx.moveCall({
    target: `${packages.tribe}::tribe::transfer_leadership`,
    arguments: [
      tx.object(params.tribeId),
      tx.object(params.capId),
      tx.pure.id(params.newLeaderCharacterId),
    ],
  });
  tx.transferObjects([newLeaderCap], tx.pure.address(params.newLeaderWalletAddress));
  tx.transferObjects([oldLeaderCap], tx.pure.address(params.callerAddress));
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
// Multi-Input Contract
// ============================================================

const micPkg = () => packages.trustlessContracts;
const micTarget = (fn: string) => `${micPkg()}::multi_input::${fn}`;

/**
 * Create a multi-input manufacturing order. Poster escrows a bounty split from
 * gas and specifies material slots computed by the off-chain BOM optimizer.
 */
export function buildCreateMultiInputContract(params: {
  characterId: string;
  bountyAmount: number;
  description: string;
  destinationSsuId: string;
  typeIds: number[];
  quantities: number[];
  deadlineMs: number;
  allowedCharacters: string[];
  allowedTribes: number[];
  coinType?: string;
}): Transaction {
  const tx = new Transaction();
  const [bounty] = tx.splitCoins(tx.gas, [params.bountyAmount]);
  tx.moveCall({
    target: micTarget("create"),
    typeArguments: [ct(params.coinType)],
    arguments: [
      tx.object(params.characterId),
      bounty,
      tx.pure.string(params.description),
      tx.pure.id(params.destinationSsuId),
      tx.pure("vector<u64>", params.typeIds),
      tx.pure("vector<u64>", params.quantities),
      tx.pure.u64(params.deadlineMs),
      tx.pure("vector<address>", params.allowedCharacters),
      tx.pure("vector<u32>", params.allowedTribes),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

/**
 * Fill a slot by withdrawing an item from the filler's SSU and delivering it
 * to the poster's destination SSU via the CormAuth extension.
 *
 * Supports both owned SSUs (OwnerCap<StorageUnit>) and non-owned SSUs
 * (OwnerCap<Character>) via the `access` parameter.
 */
export function buildFillMultiInputSlot(params: {
  contractId: string;
  destinationSsuId: string;
  posterCharId: string;
  fillerCharId: string;
  fillerSsuId: string;
  access: ItemAccessMode;
  typeId: number;
  quantity: number;
  coinType?: string;
}): Transaction {
  const tx = new Transaction();

  const item = appendBorrowWithdrawReturn(
    tx,
    params.access,
    params.fillerCharId,
    params.fillerSsuId,
    params.typeId,
    params.quantity,
  );

  // Fill the slot (deposits item to poster's destination SSU, pays bounty)
  tx.moveCall({
    target: micTarget("fill_slot"),
    typeArguments: [ct(params.coinType)],
    arguments: [
      tx.object(params.contractId),
      tx.object(params.destinationSsuId),
      tx.object(params.posterCharId),
      tx.object(params.fillerCharId),
      item,
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/** Cancel an active (incomplete) multi-input contract. Poster only. */
export function buildCancelMultiInputContract(params: {
  contractId: string;
  characterId: string;
  coinType?: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: micTarget("cancel"),
    typeArguments: [ct(params.coinType)],
    arguments: [
      tx.object(params.contractId),
      tx.object(params.characterId),
    ],
  });
  return tx;
}

/** Expire a multi-input contract after its deadline. Anyone can call. */
export function buildExpireMultiInputContract(params: {
  contractId: string;
  coinType?: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: micTarget("expire"),
    typeArguments: [ct(params.coinType)],
    arguments: [
      tx.object(params.contractId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

// ============================================================
// Trustless Contracts
// ============================================================

const { fillCoinType } = config;
const tcPkg = () => packages.trustlessContracts;
const tcTarget = (mod: string, fn: string) => `${tcPkg()}::${mod}::${fn}`;

/**
 * Return the correct type arguments for a given trustless-contract module.
 *
 * Move phantom type params per module:
 *   coin_for_coin<CE, CF>  → 2 types
 *   transport<CE, CF>      → 2 types
 *   coin_for_item<C>       → 1 type (escrow coin = defaultCoinType)
 *   item_for_coin<C>       → 1 type (fill coin   = fillCoinType)
 *   item_for_item           → 0 types
 */
function tcModuleTypes(mod: string): string[] {
  switch (mod) {
    case "coin_for_coin":
    case "transport":
      return [defaultCoinType, fillCoinType];
    case "coin_for_item":
      return [defaultCoinType];
    case "item_for_coin":
      return [fillCoinType];
    case "item_for_item":
      return [];
    default:
      return [defaultCoinType, fillCoinType];
  }
}

/** Two-type shorthand kept for coin_for_coin & transport callers. */
const tcTypes = () => [defaultCoinType, fillCoinType];

/** Map contract variant to its on-chain Move module name. */
const VARIANT_MODULE: Record<string, string> = {
  CoinForCoin: "coin_for_coin",
  CoinForItem: "coin_for_item",
  ItemForCoin: "item_for_coin",
  ItemForItem: "item_for_item",
  Transport: "transport",
};

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
    target: tcTarget("coin_for_coin", "create"),
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
  useOwnerInventory: boolean;
  deadlineMs: number;
  allowedCharacters: string[];
  allowedTribes: number[];
}): Transaction {
  const tx = new Transaction();
  const [escrow] = tx.splitCoins(tx.gas, [params.escrowAmount]);
  tx.moveCall({
    target: tcTarget("coin_for_item", "create"),
    typeArguments: tcModuleTypes("coin_for_item"),
    arguments: [
      tx.object(params.characterId),
      escrow,
      tx.pure.u64(params.wantedTypeId),
      tx.pure.u32(params.wantedQuantity),
      tx.pure.id(params.destinationSsuId),
      tx.pure.bool(params.allowPartial),
      tx.pure.bool(params.useOwnerInventory),
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
  typeId: number;
  quantity: number;
  access: ItemAccessMode;
  wantedAmount: number;
  allowPartial: boolean;
  deadlineMs: number;
  allowedCharacters: string[];
  allowedTribes: number[];
}): Transaction {
  const tx = new Transaction();

  // 1. Borrow OwnerCap → withdraw item → return OwnerCap
  const item = appendBorrowWithdrawReturn(
    tx,
    params.access,
    params.characterId,
    params.sourceSsuId,
    params.typeId,
    params.quantity,
  );

  // 2. Create the contract (consumes the transit Item)
  tx.moveCall({
    target: tcTarget("item_for_coin", "create"),
    typeArguments: tcModuleTypes("item_for_coin"),
    arguments: [
      tx.object(params.characterId),
      tx.object(params.sourceSsuId),
      item,
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

/**
 * Build a single PTB that creates multiple ItemForCoin contracts.
 *
 * Borrows the OwnerCap<StorageUnit> once, performs N withdraw + create pairs,
 * then returns the cap — minimising commands vs N separate transactions.
 */
export function buildCreateItemForCoinBatch(params: {
  characterId: string;
  sourceSsuId: string;
  access: ItemAccessMode;
  items: {
    typeId: number;
    quantity: number;
    wantedAmount: number;
  }[];
  allowPartial: boolean;
  deadlineMs: number;
  allowedCharacters: string[];
  allowedTribes: number[];
}): Transaction {
  const tx = new Transaction();
  const pkg = worldPkg();
  const typeArg =
    params.access.mode === "ssuOwner"
      ? `${pkg}::storage_unit::StorageUnit`
      : `${pkg}::character::Character`;

  // 1. Borrow OwnerCap<T> from Character (once)
  const [ownerCap, receipt] = tx.moveCall({
    target: `${pkg}::character::borrow_owner_cap`,
    typeArguments: [typeArg],
    arguments: [
      tx.object(params.characterId),
      tx.object(
        Inputs.ReceivingRef({
          objectId: params.access.ownerCapId,
          version: params.access.ownerCapVersion,
          digest: params.access.ownerCapDigest,
        }),
      ),
    ],
  });

  // 2. For each item: withdraw from SSU + create contract
  for (const entry of params.items) {
    const [item] = tx.moveCall({
      target: `${pkg}::storage_unit::withdraw_by_owner`,
      typeArguments: [typeArg],
      arguments: [
        tx.object(params.sourceSsuId),
        tx.object(params.characterId),
        ownerCap,
        tx.pure.u64(entry.typeId),
        tx.pure.u32(entry.quantity),
      ],
    });

    tx.moveCall({
      target: tcTarget("item_for_coin", "create"),
      typeArguments: tcModuleTypes("item_for_coin"),
      arguments: [
        tx.object(params.characterId),
        tx.object(params.sourceSsuId),
        item,
        tx.pure.u64(entry.wantedAmount),
        tx.pure.bool(params.allowPartial),
        tx.pure.u64(params.deadlineMs),
        tx.pure("vector<address>", params.allowedCharacters),
        tx.pure("vector<u32>", params.allowedTribes),
        tx.object(SUI_CLOCK),
      ],
    });
  }

  // 3. Return OwnerCap<T> to Character (once)
  tx.moveCall({
    target: `${pkg}::character::return_owner_cap`,
    typeArguments: [typeArg],
    arguments: [
      tx.object(params.characterId),
      ownerCap,
      receipt,
    ],
  });

  return tx;
}

export function buildCreateItemForItem(params: {
  characterId: string;
  sourceSsuId: string;
  typeId: number;
  quantity: number;
  access: ItemAccessMode;
  wantedTypeId: number;
  wantedQuantity: number;
  destinationSsuId: string;
  allowPartial: boolean;
  useOwnerInventory: boolean;
  deadlineMs: number;
  allowedCharacters: string[];
  allowedTribes: number[];
}): Transaction {
  const tx = new Transaction();

  // 1. Borrow OwnerCap → withdraw item → return OwnerCap
  const item = appendBorrowWithdrawReturn(
    tx,
    params.access,
    params.characterId,
    params.sourceSsuId,
    params.typeId,
    params.quantity,
  );

  // 2. Create the contract (consumes the transit Item)
  tx.moveCall({
    target: tcTarget("item_for_item", "create"),
    typeArguments: tcModuleTypes("item_for_item"),
    arguments: [
      tx.object(params.characterId),
      tx.object(params.sourceSsuId),
      item,
      tx.pure.u64(params.wantedTypeId),
      tx.pure.u32(params.wantedQuantity),
      tx.pure.id(params.destinationSsuId),
      tx.pure.bool(params.allowPartial),
      tx.pure.bool(params.useOwnerInventory),
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
  sourceSsuId: string;
  typeId: number;
  quantity: number;
  access: ItemAccessMode;
  escrowAmount: number;
  destinationSsuId: string;
  requiredStake: number;
  useOwnerInventory: boolean;
  deadlineMs: number;
  allowedCharacters: string[];
  allowedTribes: number[];
}): Transaction {
  const tx = new Transaction();

  // 1. Borrow OwnerCap → withdraw item → return OwnerCap
  const item = appendBorrowWithdrawReturn(
    tx,
    params.access,
    params.characterId,
    params.sourceSsuId,
    params.typeId,
    params.quantity,
  );

  // 2. Split escrow coins
  const [escrow] = tx.splitCoins(tx.gas, [params.escrowAmount]);

  // 3. Create the transport contract (consumes transit Item, locks in open inventory)
  tx.moveCall({
    target: tcTarget("transport", "create"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.characterId),
      escrow,
      tx.object(params.sourceSsuId),
      item,
      tx.pure.id(params.destinationSsuId),
      tx.pure.u64(params.requiredStake),
      tx.pure.bool(params.useOwnerInventory),
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
    target: tcTarget("coin_for_coin", "fill"),
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
    target: tcTarget("coin_for_item", "fill"),
    typeArguments: tcModuleTypes("coin_for_item"),
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

/**
 * Composite PTB: withdraw an item from the filler's SSU and fill a CoinForItem
 * contract in one transaction.
 *
 * Supports both owned SSUs (OwnerCap<StorageUnit>) and non-owned SSUs
 * (OwnerCap<Character>) via the `access` parameter.
 */
export function buildFillCoinForItemComposite(params: {
  contractId: string;
  destinationSsuId: string;
  posterCharacterId: string;
  fillerCharacterId: string;
  fillerSsuId: string;
  access: ItemAccessMode;
  typeId: number;
  quantity: number;
}): Transaction {
  const tx = new Transaction();

  const item = appendBorrowWithdrawReturn(
    tx,
    params.access,
    params.fillerCharacterId,
    params.fillerSsuId,
    params.typeId,
    params.quantity,
  );

  // Fill the contract (deposits item to poster's destination SSU)
  tx.moveCall({
    target: tcTarget("coin_for_item", "fill"),
    typeArguments: tcModuleTypes("coin_for_item"),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.destinationSsuId),
      tx.object(params.posterCharacterId),
      tx.object(params.fillerCharacterId),
      item,
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Composite PTB: withdraw an item from the filler's SSU and fill an ItemForItem
 * contract in one transaction.
 *
 * Supports both owned SSUs (OwnerCap<StorageUnit>) and non-owned SSUs
 * (OwnerCap<Character>) via the `access` parameter.
 */
export function buildFillItemForItemComposite(params: {
  contractId: string;
  sourceSsuId: string;
  destinationSsuId: string;
  posterCharacterId: string;
  fillerCharacterId: string;
  fillerSsuId: string;
  access: ItemAccessMode;
  typeId: number;
  quantity: number;
}): Transaction {
  const tx = new Transaction();

  const item = appendBorrowWithdrawReturn(
    tx,
    params.access,
    params.fillerCharacterId,
    params.fillerSsuId,
    params.typeId,
    params.quantity,
  );

  // Fill the contract (deposits wanted items at destination, releases offered from source)
  tx.moveCall({
    target: tcTarget("item_for_item", "fill"),
    typeArguments: tcModuleTypes("item_for_item"),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.sourceSsuId),
      tx.object(params.destinationSsuId),
      tx.object(params.posterCharacterId),
      tx.object(params.fillerCharacterId),
      item,
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Variant of buildFillItemForItemComposite for contracts where source SSU ==
 * destination SSU. SUI forbids two &mut refs to the same object in one call,
 * so this calls `fill_item_for_item_same_ssu` which takes a single SSU param.
 */
export function buildFillItemForItemSameSsuComposite(params: {
  contractId: string;
  ssuId: string;
  posterCharacterId: string;
  fillerCharacterId: string;
  fillerSsuId: string;
  access: ItemAccessMode;
  typeId: number;
  quantity: number;
}): Transaction {
  const tx = new Transaction();

  const item = appendBorrowWithdrawReturn(
    tx,
    params.access,
    params.fillerCharacterId,
    params.fillerSsuId,
    params.typeId,
    params.quantity,
  );

  tx.moveCall({
    target: tcTarget("item_for_item", "fill_same_ssu"),
    typeArguments: tcModuleTypes("item_for_item"),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.ssuId),
      tx.object(params.posterCharacterId),
      tx.object(params.fillerCharacterId),
      item,
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

export function buildFillItemForCoin(params: {
  contractId: string;
  sourceSsuId: string;
  fillerCharacterId: string;
  fillAmount: number;
}): Transaction {
  const tx = new Transaction();
  const [fill] = tx.splitCoins(tx.gas, [params.fillAmount]);
  tx.moveCall({
    target: tcTarget("item_for_coin", "fill"),
    typeArguments: tcModuleTypes("item_for_coin"),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.sourceSsuId),
      tx.object(params.fillerCharacterId),
      fill,
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildClaimFreeItems(params: {
  contractId: string;
  sourceSsuId: string;
  fillerCharacterId: string;
  quantity: number;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget("item_for_coin", "claim_free"),
    typeArguments: tcModuleTypes("item_for_coin"),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.sourceSsuId),
      tx.object(params.fillerCharacterId),
      tx.pure.u32(params.quantity),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildClaimFreeCoins(params: {
  contractId: string;
  fillerCharacterId: string;
  claimAmount: number;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget("coin_for_coin", "claim_free"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.fillerCharacterId),
      tx.pure.u64(params.claimAmount),
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
  sourceSsuId: string;
}): Transaction {
  const tx = new Transaction();
  const [stake] = tx.splitCoins(tx.gas, [params.stakeAmount]);
  tx.moveCall({
    target: tcTarget("transport", "accept"),
    typeArguments: tcTypes(),
    arguments: [
      tx.object(params.contractId),
      stake,
      tx.object(params.characterId),
      tx.object(params.sourceSsuId),
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
    target: tcTarget("transport", "deliver"),
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
  contractVariant: string;
}): Transaction {
  const mod = VARIANT_MODULE[params.contractVariant] ?? "coin_for_coin";
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget(mod, "cancel"),
    typeArguments: tcModuleTypes(mod),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.characterId),
    ],
  });
  return tx;
}

export function buildExpireTrustlessContract(params: {
  contractId: string;
  contractVariant: string;
}): Transaction {
  const mod = VARIANT_MODULE[params.contractVariant] ?? "coin_for_coin";
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget(mod, "expire"),
    typeArguments: tcModuleTypes(mod),
    arguments: [
      tx.object(params.contractId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildCancelItemContract(params: {
  contractId: string;
  posterCharacterId: string;
  sourceSsuId: string;
  contractVariant: string;
}): Transaction {
  const mod = VARIANT_MODULE[params.contractVariant] ?? "item_for_coin";
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget(mod, "cancel"),
    typeArguments: tcModuleTypes(mod),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.posterCharacterId),
      tx.object(params.sourceSsuId),
    ],
  });
  return tx;
}

export function buildExpireItemContract(params: {
  contractId: string;
  posterCharacterId: string;
  sourceSsuId: string;
  contractVariant: string;
}): Transaction {
  const mod = VARIANT_MODULE[params.contractVariant] ?? "item_for_coin";
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget(mod, "expire"),
    typeArguments: tcModuleTypes(mod),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.posterCharacterId),
      tx.object(params.sourceSsuId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

// --- Cleanup ---

export function buildCleanupCompletedContract(params: {
  contractId: string;
  contractVariant: string;
}): Transaction {
  const mod = VARIANT_MODULE[params.contractVariant] ?? "coin_for_coin";
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget(mod, "cleanup"),
    typeArguments: tcModuleTypes(mod),
    arguments: [
      tx.object(params.contractId),
    ],
  });
  return tx;
}

export function buildCleanupCompletedItemContract(params: {
  contractId: string;
  posterCharacterId: string;
  sourceSsuId: string;
  contractVariant: string;
}): Transaction {
  const mod = VARIANT_MODULE[params.contractVariant] ?? "item_for_coin";
  const tx = new Transaction();
  tx.moveCall({
    target: tcTarget(mod, "cleanup"),
    typeArguments: tcModuleTypes(mod),
    arguments: [
      tx.object(params.contractId),
      tx.object(params.posterCharacterId),
      tx.object(params.sourceSsuId),
    ],
  });
  return tx;
}

// ============================================================
// SSU Extension Authorization
// ============================================================
/** Construct the dApp delivery URL for a specific SSU. */
function getDappUrl(ssuId: string): string {
  return `${config.webUiHost}/dapp/deliver/${ssuId}`;
}

/**
 * Authorize the CormAuth extension on a StorageUnit so Corm contract
 * packages can deposit/withdraw items, then set the SSU metadata URL
 * to the dApp delivery route.
 *
 * Follows the same borrow/return OwnerCap pattern as online/offline.
 */
export function buildAuthorizeExtension(params: {
  characterId: string;
  structureId: string;
  ownerCapId: string;
  ownerCapVersion: string;
  ownerCapDigest: string;
}): Transaction {
  const tx = new Transaction();
  const pkg = worldPkg();
  const suTypeArg = `${pkg}::storage_unit::StorageUnit`;
  const authTypeArg = `${packages.cormAuth}::corm_auth::CormAuth`;

  // 1. Borrow OwnerCap<StorageUnit> from Character
  const [ownerCap, receipt] = tx.moveCall({
    target: `${pkg}::character::borrow_owner_cap`,
    typeArguments: [suTypeArg],
    arguments: [
      tx.object(params.characterId),
      tx.object(
        Inputs.ReceivingRef({
          objectId: params.ownerCapId,
          version: params.ownerCapVersion,
          digest: params.ownerCapDigest,
        }),
      ),
    ],
  });

  // 2. Authorize extension
  tx.moveCall({
    target: `${pkg}::storage_unit::authorize_extension`,
    typeArguments: [authTypeArg],
    arguments: [
      tx.object(params.structureId),
      ownerCap,
    ],
  });
  // 3. Update SSU metadata URL to the web dApp route
  tx.moveCall({
    target: `${pkg}::storage_unit::update_metadata_url`,
    arguments: [
      tx.object(params.structureId),
      ownerCap,
      tx.pure.string(getDappUrl(params.structureId)),
    ],
  });

  // 4. Return OwnerCap to Character
  tx.moveCall({
    target: `${pkg}::character::return_owner_cap`,
    typeArguments: [suTypeArg],
    arguments: [
      tx.object(params.characterId),
      ownerCap,
      receipt,
    ],
  });

  return tx;
}

// ============================================================
// Smart Assembly Actions (Online / Offline)
// ============================================================

const worldPkg = () => packages.world;

/**
 * Shared helper: borrow OwnerCap → withdraw item → return OwnerCap.
 *
 * Supports both OwnerCap<StorageUnit> (SSU owner) and OwnerCap<Character>
 * (player inventory on non-owned SSU) via the `access` discriminant.
 *
 * Returns the transit Item result from withdraw_by_owner.
 */
function appendBorrowWithdrawReturn(
  tx: Transaction,
  access: ItemAccessMode,
  characterId: string,
  ssuId: string,
  typeId: number,
  quantity: number,
) {
  const pkg = worldPkg();
  const typeArg =
    access.mode === "ssuOwner"
      ? `${pkg}::storage_unit::StorageUnit`
      : `${pkg}::character::Character`;

  // 1. Borrow OwnerCap<T> from Character
  const [ownerCap, receipt] = tx.moveCall({
    target: `${pkg}::character::borrow_owner_cap`,
    typeArguments: [typeArg],
    arguments: [
      tx.object(characterId),
      tx.object(
        Inputs.ReceivingRef({
          objectId: access.ownerCapId,
          version: access.ownerCapVersion,
          digest: access.ownerCapDigest,
        }),
      ),
    ],
  });

  // 2. Withdraw item from SSU (returns transit Item)
  const [item] = tx.moveCall({
    target: `${pkg}::storage_unit::withdraw_by_owner`,
    typeArguments: [typeArg],
    arguments: [
      tx.object(ssuId),
      tx.object(characterId),
      ownerCap,
      tx.pure.u64(typeId),
      tx.pure.u32(quantity),
    ],
  });

  // 3. Return OwnerCap<T> to Character
  tx.moveCall({
    target: `${pkg}::character::return_owner_cap`,
    typeArguments: [typeArg],
    arguments: [
      tx.object(characterId),
      ownerCap,
      receipt,
    ],
  });

  return item;
}

/** Maps StructureMoveType → { module name, full type argument }. */
function structureMoveInfo(moveType: StructureMoveType) {
  const pkg = worldPkg();
  const map: Record<StructureMoveType, { module: string; typeArg: string }> = {
    Assembly:    { module: "assembly",      typeArg: `${pkg}::assembly::Assembly` },
    StorageUnit: { module: "storage_unit",  typeArg: `${pkg}::storage_unit::StorageUnit` },
    Gate:        { module: "gate",          typeArg: `${pkg}::gate::Gate` },
    Turret:      { module: "turret",        typeArg: `${pkg}::turret::Turret` },
    NetworkNode: { module: "network_node",  typeArg: `${pkg}::network_node::NetworkNode` },
  };
  return map[moveType];
}

export interface StructureActionParams {
  characterId: string;
  structureId: string;
  ownerCapId: string;
  ownerCapVersion: string;
  ownerCapDigest: string;
  networkNodeId: string;
  energyConfigId: string;
  moveType: StructureMoveType;
}

/**
 * Build a PTB that brings a structure online.
 *
 * Steps:
 * 1. Borrow OwnerCap<T> from Character via character::borrow_owner_cap
 * 2. Call [module]::online(structure, network_node, energy_config, owner_cap)
 * 3. Return OwnerCap<T> to Character via character::return_owner_cap
 */
export function buildOnlineStructure(params: StructureActionParams): Transaction {
  return buildStructureToggle(params, "online");
}

/**
 * Build a PTB that takes a structure offline. Same borrow/return pattern.
 */
export function buildOfflineStructure(params: StructureActionParams): Transaction {
  return buildStructureToggle(params, "offline");
}

function buildStructureToggle(
  params: StructureActionParams,
  action: "online" | "offline",
): Transaction {
  const tx = new Transaction();
  const pkg = worldPkg();
  const { module: mod, typeArg } = structureMoveInfo(params.moveType);

  // 1. Borrow OwnerCap from Character (Receiving<OwnerCap<T>>)
  const [ownerCap, receipt] = tx.moveCall({
    target: `${pkg}::character::borrow_owner_cap`,
    typeArguments: [typeArg],
    arguments: [
      tx.object(params.characterId),
      tx.object(
        Inputs.ReceivingRef({
          objectId: params.ownerCapId,
          version: params.ownerCapVersion,
          digest: params.ownerCapDigest,
        }),
      ),
    ],
  });

  // 2. Call online/offline on the appropriate module
  tx.moveCall({
    target: `${pkg}::${mod}::${action}`,
    arguments: [
      tx.object(params.structureId),
      tx.object(params.networkNodeId),
      tx.object(params.energyConfigId),
      ownerCap,
    ],
  });

  // 3. Return OwnerCap to Character
  tx.moveCall({
    target: `${pkg}::character::return_owner_cap`,
    typeArguments: [typeArg],
    arguments: [
      tx.object(params.characterId),
      ownerCap,
      receipt,
    ],
  });

  return tx;
}
