/// ItemForCoin — trustless item-for-coin exchange with SSU escrow.
///
/// Poster locks items in SSU open inventory (CormAuth-controlled), wants
/// Coin<C> in return. Fillers pay coins and receive proportional items.
///
/// Special case: when `wanted_amount = 0`, items are free to claim.
/// `target_quantity` tracks items distributed instead.
module trustless_contracts::item_for_coin;

use sui::{
    balance::{Self, Balance},
    clock::Clock,
    coin::{Self, Coin},
    event,
    table::{Self, Table},
};
use corm_auth::corm_auth::{Self, CormAuth};
use world::character::Character;
use world::inventory;
use world::storage_unit::StorageUnit;
use trustless_contracts::contract_utils::{Self, ContractStatus};

// === Module-specific Errors ===
const ESourceSsuMismatch: u64 = 100;

// === Structs ===

public struct ItemForCoinContract<phantom C> has key {
    id: UID,
    poster_id: ID,
    poster_address: address,
    /// Accumulated filler payments forwarded to poster.
    fill_pool: Balance<C>,
    offered_type_id: u64,
    offered_quantity: u32,
    source_ssu_id: ID,
    wanted_amount: u64,
    items_released: u32,
    target_quantity: u64,
    filled_quantity: u64,
    allow_partial: bool,
    fills: Table<ID, u64>,
    deadline_ms: u64,
    status: ContractStatus,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
}

// === Events ===

public struct ItemForCoinCreatedEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    offered_type_id: u64,
    offered_quantity: u32,
    source_ssu_id: ID,
    wanted_amount: u64,
    target_quantity: u64,
    deadline_ms: u64,
    allow_partial: bool,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
}

// === Public Functions ===

/// Create an ItemForCoin contract. Items are moved to SSU open inventory
/// (CormAuth-controlled). Caller passes a transit Item withdrawn from the
/// source SSU in the same PTB.
public fun create<C>(
    character: &Character,
    source_ssu: &mut StorageUnit,
    item: inventory::Item,
    wanted_amount: u64,
    allow_partial: bool,
    deadline_ms: u64,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    contract_utils::assert_deadline_in_future(deadline_ms, clock.timestamp_ms());
    contract_utils::assert_nonzero_quantity((inventory::quantity(&item) as u64));

    let poster_id = character.id();
    let poster_address = character.character_address();
    let source_ssu_id = object::id(source_ssu);
    let offered_type_id = inventory::type_id(&item);
    let offered_quantity = inventory::quantity(&item);

    if (allow_partial && wanted_amount > 0) {
        contract_utils::assert_divisible(wanted_amount, (offered_quantity as u64));
    };

    // Deposit to open inventory (locked by CormAuth extension)
    source_ssu.deposit_to_open_inventory<CormAuth>(
        character,
        item,
        corm_auth::auth(),
        ctx,
    );

    let effective_target = if (wanted_amount == 0) {
        (offered_quantity as u64)
    } else {
        wanted_amount
    };

    let contract = ItemForCoinContract<C> {
        id: object::new(ctx),
        poster_id,
        poster_address,
        fill_pool: balance::zero<C>(),
        offered_type_id,
        offered_quantity,
        source_ssu_id,
        wanted_amount,
        items_released: 0,
        target_quantity: effective_target,
        filled_quantity: 0,
        allow_partial,
        fills: table::new(ctx),
        deadline_ms,
        status: contract_utils::status_open(),
        allowed_characters,
        allowed_tribes,
    };

    let contract_id = object::id(&contract);
    event::emit(ItemForCoinCreatedEvent {
        contract_id,
        poster_id,
        offered_type_id,
        offered_quantity,
        source_ssu_id,
        wanted_amount,
        target_quantity: effective_target,
        deadline_ms,
        allow_partial,
        allowed_characters: contract.allowed_characters,
        allowed_tribes: contract.allowed_tribes,
    });

    transfer::share_object(contract);
}

/// Fill with coins. Filler pays Coin<C>, receives proportional items
/// from the source SSU open inventory.
public fun fill<C>(
    contract: &mut ItemForCoinContract<C>,
    source_ssu: &mut StorageUnit,
    _poster_character: &Character,
    filler_character: &Character,
    mut fill_coin: Coin<C>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    contract_utils::assert_open(&contract.status);
    contract_utils::assert_not_expired(contract.deadline_ms, clock.timestamp_ms());
    contract_utils::assert_nonzero_escrow(fill_coin.value());
    assert!(object::id(source_ssu) == contract.source_ssu_id, ESourceSsuMismatch);

    let filler_id = filler_character.id();
    contract_utils::assert_not_self_fill(filler_id, contract.poster_id);
    contract_utils::verify_filler_access(
        &contract.allowed_characters,
        &contract.allowed_tribes,
        filler_character,
    );

    let remaining = contract.target_quantity - contract.filled_quantity;
    contract_utils::assert_not_full(remaining);

    let fill_amount = if (fill_coin.value() > remaining) {
        remaining
    } else {
        fill_coin.value()
    };

    contract_utils::assert_full_fill_if_required(
        contract.allow_partial, fill_amount, remaining,
    );

    // Return excess to filler
    if (fill_coin.value() > fill_amount) {
        let excess_amount = fill_coin.value() - fill_amount;
        let excess = fill_coin.split(excess_amount, ctx);
        transfer::public_transfer(excess, filler_character.character_address());
    };

    contract.fill_pool.join(fill_coin.into_balance());
    contract_utils::track_fill(&mut contract.fills, filler_id, fill_amount);
    contract.filled_quantity = contract.filled_quantity + fill_amount;

    // Calculate item release
    let coins_per_item = contract.target_quantity / (contract.offered_quantity as u64);
    if (contract.allow_partial) {
        contract_utils::assert_fill_multiple(fill_amount, coins_per_item);
    };

    let is_final = (contract.filled_quantity == contract.target_quantity);
    let items_to_release = if (is_final) {
        (contract.offered_quantity - contract.items_released)
    } else {
        (fill_amount / coins_per_item as u32)
    };

    let contract_id = object::id(contract);

    // Release items to filler
    if (items_to_release > 0) {
        contract_utils::release_items_to_owned(
            source_ssu, filler_character,
            contract.offered_type_id, items_to_release, ctx,
        );
        contract.items_released = contract.items_released + items_to_release;
    };

    // Release fill_pool coins to poster
    if (fill_amount > 0) {
        let payout = coin::take(&mut contract.fill_pool, fill_amount, ctx);
        transfer::public_transfer(payout, contract.poster_address);
    };

    contract_utils::emit_filled(
        contract_id, filler_id, fill_amount,
        (items_to_release as u64),
        contract.target_quantity - contract.filled_quantity,
    );

    if (is_final) {
        contract.status = contract_utils::status_completed();
        contract_utils::emit_completed(
            contract_id, contract.poster_id,
            contract.filled_quantity, contract.target_quantity,
        );
    };
}

/// Claim items from a free ItemForCoin contract (wanted_amount = 0).
/// No coins required.
public fun claim_free<C>(
    contract: &mut ItemForCoinContract<C>,
    source_ssu: &mut StorageUnit,
    filler_character: &Character,
    quantity: u32,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    contract_utils::assert_open(&contract.status);
    contract_utils::assert_not_expired(contract.deadline_ms, clock.timestamp_ms());
    assert!(contract.wanted_amount == 0, ESourceSsuMismatch); // reuse error for simplicity
    contract_utils::assert_nonzero_quantity((quantity as u64));

    let filler_id = filler_character.id();
    contract_utils::assert_not_self_fill(filler_id, contract.poster_id);
    contract_utils::verify_filler_access(
        &contract.allowed_characters,
        &contract.allowed_tribes,
        filler_character,
    );

    assert!(object::id(source_ssu) == contract.source_ssu_id, ESourceSsuMismatch);

    let remaining = contract.target_quantity - contract.filled_quantity;
    contract_utils::assert_not_full(remaining);

    let claim_amount = if ((quantity as u64) > remaining) {
        (remaining as u32)
    } else {
        quantity
    };

    contract_utils::assert_full_fill_if_required(
        contract.allow_partial, (claim_amount as u64), remaining,
    );

    let fill_amount = (claim_amount as u64);
    contract_utils::track_fill(&mut contract.fills, filler_id, fill_amount);
    contract.filled_quantity = contract.filled_quantity + fill_amount;

    // Release items from open inventory to filler
    contract_utils::release_items_to_owned(
        source_ssu, filler_character,
        contract.offered_type_id, claim_amount, ctx,
    );
    contract.items_released = contract.items_released + claim_amount;

    let contract_id = object::id(contract);

    contract_utils::emit_filled(
        contract_id, filler_id, fill_amount, 0,
        contract.target_quantity - contract.filled_quantity,
    );

    if (contract.filled_quantity == contract.target_quantity) {
        contract.status = contract_utils::status_completed();
        contract_utils::emit_completed(
            contract_id, contract.poster_id,
            contract.filled_quantity, 0,
        );
    };
}

/// Cancel. Returns remaining items from SSU open inventory to poster.
public fun cancel<C>(
    contract: ItemForCoinContract<C>,
    poster_character: &Character,
    source_ssu: &mut StorageUnit,
    ctx: &mut TxContext,
) {
    contract_utils::assert_open(&contract.status);
    contract_utils::assert_is_poster(poster_character.id(), contract.poster_id);
    assert!(object::id(source_ssu) == contract.source_ssu_id, ESourceSsuMismatch);

    let contract_id = object::id(&contract);
    let items_remaining = contract.offered_quantity - contract.items_released;
    let offered_type_id = contract.offered_type_id;

    let ItemForCoinContract {
        id, poster_id, poster_address, fill_pool, fills, ..
    } = contract;

    if (items_remaining > 0) {
        contract_utils::release_items_to_owned(
            source_ssu, poster_character,
            offered_type_id, items_remaining, ctx,
        );
    };

    contract_utils::return_or_destroy_balance(fill_pool, poster_address, ctx);
    contract_utils::emit_cancelled(contract_id, poster_id, 0, items_remaining);

    fills.drop();
    id.delete();
}

/// Expire after deadline. Returns remaining items to poster.
public fun expire<C>(
    contract: ItemForCoinContract<C>,
    poster_character: &Character,
    source_ssu: &mut StorageUnit,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    contract_utils::assert_expired(contract.deadline_ms, clock.timestamp_ms());
    assert!(object::id(source_ssu) == contract.source_ssu_id, ESourceSsuMismatch);

    let contract_id = object::id(&contract);
    let fill_pool_returned = contract.fill_pool.value();
    let items_remaining = contract.offered_quantity - contract.items_released;
    let offered_type_id = contract.offered_type_id;

    let ItemForCoinContract {
        id, poster_id, poster_address, fill_pool, fills, ..
    } = contract;

    if (items_remaining > 0) {
        contract_utils::release_items_to_owned(
            source_ssu, poster_character,
            offered_type_id, items_remaining, ctx,
        );
    };

    contract_utils::return_or_destroy_balance(fill_pool, poster_address, ctx);
    contract_utils::emit_expired(
        contract_id, poster_id, 0, 0, fill_pool_returned, items_remaining,
    );

    fills.drop();
    id.delete();
}

/// Garbage-collect a completed contract. Returns any remaining items.
public fun cleanup<C>(
    contract: ItemForCoinContract<C>,
    poster_character: &Character,
    source_ssu: &mut StorageUnit,
    ctx: &mut TxContext,
) {
    contract_utils::assert_completed(&contract.status);
    assert!(object::id(source_ssu) == contract.source_ssu_id, ESourceSsuMismatch);

    let items_remaining = contract.offered_quantity - contract.items_released;
    let offered_type_id = contract.offered_type_id;

    let ItemForCoinContract {
        id, poster_address, fill_pool, fills, ..
    } = contract;

    if (items_remaining > 0) {
        contract_utils::release_items_to_owned(
            source_ssu, poster_character,
            offered_type_id, items_remaining, ctx,
        );
    };

    contract_utils::return_or_destroy_balance(fill_pool, poster_address, ctx);
    fills.drop();
    id.delete();
}

// === View Functions ===

public fun poster_id<C>(c: &ItemForCoinContract<C>): ID { c.poster_id }
public fun poster_address<C>(c: &ItemForCoinContract<C>): address { c.poster_address }
public fun fill_pool_balance<C>(c: &ItemForCoinContract<C>): u64 { c.fill_pool.value() }
public fun offered_type_id<C>(c: &ItemForCoinContract<C>): u64 { c.offered_type_id }
public fun offered_quantity<C>(c: &ItemForCoinContract<C>): u32 { c.offered_quantity }
public fun source_ssu_id<C>(c: &ItemForCoinContract<C>): ID { c.source_ssu_id }
public fun wanted_amount<C>(c: &ItemForCoinContract<C>): u64 { c.wanted_amount }
public fun items_released<C>(c: &ItemForCoinContract<C>): u32 { c.items_released }
public fun target_quantity<C>(c: &ItemForCoinContract<C>): u64 { c.target_quantity }
public fun filled_quantity<C>(c: &ItemForCoinContract<C>): u64 { c.filled_quantity }
public fun allow_partial<C>(c: &ItemForCoinContract<C>): bool { c.allow_partial }
public fun deadline_ms<C>(c: &ItemForCoinContract<C>): u64 { c.deadline_ms }
public fun status<C>(c: &ItemForCoinContract<C>): ContractStatus { c.status }
public fun allowed_characters<C>(c: &ItemForCoinContract<C>): vector<ID> { c.allowed_characters }
public fun allowed_tribes<C>(c: &ItemForCoinContract<C>): vector<u32> { c.allowed_tribes }

public fun filler_contribution<C>(c: &ItemForCoinContract<C>, filler_id: ID): u64 {
    contract_utils::filler_contribution(&c.fills, filler_id)
}

// === Test-only Helpers ===

#[test_only]
public fun destroy_for_testing<C>(contract: ItemForCoinContract<C>) {
    let ItemForCoinContract { id, fill_pool, fills, .. } = contract;
    fill_pool.destroy_for_testing();
    fills.drop();
    id.delete();
}
