/// ItemForItem — trustless item-for-item exchange with SSU escrow.
///
/// Poster locks items at a source SSU, wants items deposited at a
/// destination SSU. Fillers deposit wanted items and receive proportional
/// offered items.
module trustless_contracts::item_for_item;

use sui::{
    clock::Clock,
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
const EItemTypeMismatch: u64 = 101;
const EDestinationSsuMismatch: u64 = 102;

// === Structs ===

public struct ItemForItemContract has key {
    id: UID,
    poster_id: ID,
    poster_address: address,
    offered_type_id: u64,
    offered_quantity: u32,
    source_ssu_id: ID,
    wanted_type_id: u64,
    wanted_quantity: u32,
    destination_ssu_id: ID,
    use_owner_inventory: bool,
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

public struct ItemForItemCreatedEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    offered_type_id: u64,
    offered_quantity: u32,
    source_ssu_id: ID,
    wanted_type_id: u64,
    wanted_quantity: u32,
    destination_ssu_id: ID,
    target_quantity: u64,
    deadline_ms: u64,
    allow_partial: bool,
    use_owner_inventory: bool,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
}

// === Public Functions ===

public fun create(
    character: &Character,
    source_ssu: &mut StorageUnit,
    item: inventory::Item,
    wanted_type_id: u64,
    wanted_quantity: u32,
    destination_ssu_id: ID,
    allow_partial: bool,
    use_owner_inventory: bool,
    deadline_ms: u64,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    contract_utils::assert_deadline_in_future(deadline_ms, clock.timestamp_ms());
    contract_utils::assert_nonzero_quantity((inventory::quantity(&item) as u64));
    contract_utils::assert_nonzero_quantity((wanted_quantity as u64));

    if (allow_partial) {
        contract_utils::assert_divisible(
            (inventory::quantity(&item) as u64),
            (wanted_quantity as u64),
        );
    };

    let poster_id = character.id();
    let poster_address = character.character_address();
    let source_ssu_id = object::id(source_ssu);
    let offered_type_id = inventory::type_id(&item);
    let offered_quantity = inventory::quantity(&item);

    // Deposit to open inventory (locked by CormAuth extension)
    source_ssu.deposit_to_open_inventory<CormAuth>(
        character,
        item,
        corm_auth::auth(),
        ctx,
    );

    let contract = ItemForItemContract {
        id: object::new(ctx),
        poster_id,
        poster_address,
        offered_type_id,
        offered_quantity,
        source_ssu_id,
        wanted_type_id,
        wanted_quantity,
        destination_ssu_id,
        use_owner_inventory,
        items_released: 0,
        target_quantity: (wanted_quantity as u64),
        filled_quantity: 0,
        allow_partial,
        fills: table::new(ctx),
        deadline_ms,
        status: contract_utils::status_open(),
        allowed_characters,
        allowed_tribes,
    };

    let contract_id = object::id(&contract);
    event::emit(ItemForItemCreatedEvent {
        contract_id,
        poster_id,
        offered_type_id,
        offered_quantity,
        source_ssu_id,
        wanted_type_id,
        wanted_quantity,
        destination_ssu_id,
        target_quantity: (wanted_quantity as u64),
        deadline_ms,
        allow_partial,
        use_owner_inventory,
        allowed_characters: contract.allowed_characters,
        allowed_tribes: contract.allowed_tribes,
    });

    transfer::share_object(contract);
}

/// Fill by depositing wanted items at the destination SSU. Filler receives
/// proportional offered items from the source SSU open inventory.
public fun fill(
    contract: &mut ItemForItemContract,
    source_ssu: &mut StorageUnit,
    destination_ssu: &mut StorageUnit,
    poster_character: &Character,
    filler_character: &Character,
    item: inventory::Item,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    contract_utils::assert_open(&contract.status);
    contract_utils::assert_not_expired(contract.deadline_ms, clock.timestamp_ms());

    let filler_id = filler_character.id();
    contract_utils::assert_not_self_fill(filler_id, contract.poster_id);
    contract_utils::verify_filler_access(
        &contract.allowed_characters,
        &contract.allowed_tribes,
        filler_character,
    );

    assert!(object::id(source_ssu) == contract.source_ssu_id, ESourceSsuMismatch);
    assert!(object::id(destination_ssu) == contract.destination_ssu_id, EDestinationSsuMismatch);
    assert!(inventory::type_id(&item) == contract.wanted_type_id, EItemTypeMismatch);

    let item_qty = (inventory::quantity(&item) as u64);
    contract_utils::assert_nonzero_quantity(item_qty);

    let remaining = contract.target_quantity - contract.filled_quantity;
    contract_utils::assert_not_full(remaining);

    let fill_amount = if (item_qty > remaining) { remaining } else { item_qty };
    contract_utils::assert_full_fill_if_required(
        contract.allow_partial, fill_amount, remaining,
    );

    // Deposit filler's items at destination SSU
    contract_utils::deposit_to_destination(
        destination_ssu, poster_character, item,
        contract.use_owner_inventory, ctx,
    );

    contract_utils::track_fill(&mut contract.fills, filler_id, fill_amount);
    contract.filled_quantity = contract.filled_quantity + fill_amount;

    // Calculate offered items to release
    let offered_per_wanted = (contract.offered_quantity as u64) / contract.target_quantity;
    let is_final = (contract.filled_quantity == contract.target_quantity);
    let items_to_release = if (is_final) {
        (contract.offered_quantity - contract.items_released)
    } else {
        (fill_amount * offered_per_wanted as u32)
    };

    let contract_id = object::id(contract);

    if (items_to_release > 0) {
        contract_utils::release_items_to_owned(
            source_ssu, filler_character,
            contract.offered_type_id, items_to_release, ctx,
        );
        contract.items_released = contract.items_released + items_to_release;
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
            contract.filled_quantity, 0,
        );
    };
}

/// Variant for when source SSU == destination SSU. SUI forbids two &mut
/// references to the same object, so this accepts a single &mut StorageUnit.
public fun fill_same_ssu(
    contract: &mut ItemForItemContract,
    ssu: &mut StorageUnit,
    poster_character: &Character,
    filler_character: &Character,
    item: inventory::Item,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    contract_utils::assert_open(&contract.status);
    contract_utils::assert_not_expired(contract.deadline_ms, clock.timestamp_ms());

    let filler_id = filler_character.id();
    contract_utils::assert_not_self_fill(filler_id, contract.poster_id);
    contract_utils::verify_filler_access(
        &contract.allowed_characters,
        &contract.allowed_tribes,
        filler_character,
    );

    assert!(object::id(ssu) == contract.source_ssu_id, ESourceSsuMismatch);
    assert!(object::id(ssu) == contract.destination_ssu_id, EDestinationSsuMismatch);
    assert!(inventory::type_id(&item) == contract.wanted_type_id, EItemTypeMismatch);

    let item_qty = (inventory::quantity(&item) as u64);
    contract_utils::assert_nonzero_quantity(item_qty);

    let remaining = contract.target_quantity - contract.filled_quantity;
    contract_utils::assert_not_full(remaining);

    let fill_amount = if (item_qty > remaining) { remaining } else { item_qty };
    contract_utils::assert_full_fill_if_required(
        contract.allow_partial, fill_amount, remaining,
    );

    // Deposit filler's items
    contract_utils::deposit_to_destination(
        ssu, poster_character, item,
        contract.use_owner_inventory, ctx,
    );

    contract_utils::track_fill(&mut contract.fills, filler_id, fill_amount);
    contract.filled_quantity = contract.filled_quantity + fill_amount;

    let offered_per_wanted = (contract.offered_quantity as u64) / contract.target_quantity;
    let is_final = (contract.filled_quantity == contract.target_quantity);
    let items_to_release = if (is_final) {
        (contract.offered_quantity - contract.items_released)
    } else {
        (fill_amount * offered_per_wanted as u32)
    };

    let contract_id = object::id(contract);

    if (items_to_release > 0) {
        contract_utils::release_items_to_owned(
            ssu, filler_character,
            contract.offered_type_id, items_to_release, ctx,
        );
        contract.items_released = contract.items_released + items_to_release;
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
            contract.filled_quantity, 0,
        );
    };
}

/// Cancel. Returns remaining items from SSU open inventory to poster.
public fun cancel(
    contract: ItemForItemContract,
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

    let ItemForItemContract {
        id, poster_id, fills, ..
    } = contract;

    if (items_remaining > 0) {
        contract_utils::release_items_to_owned(
            source_ssu, poster_character,
            offered_type_id, items_remaining, ctx,
        );
    };

    contract_utils::emit_cancelled(contract_id, poster_id, 0, items_remaining);

    fills.drop();
    id.delete();
}

/// Expire after deadline. Returns remaining items to poster.
public fun expire(
    contract: ItemForItemContract,
    poster_character: &Character,
    source_ssu: &mut StorageUnit,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    contract_utils::assert_expired(contract.deadline_ms, clock.timestamp_ms());
    assert!(object::id(source_ssu) == contract.source_ssu_id, ESourceSsuMismatch);

    let contract_id = object::id(&contract);
    let items_remaining = contract.offered_quantity - contract.items_released;
    let offered_type_id = contract.offered_type_id;

    let ItemForItemContract {
        id, poster_id, fills, ..
    } = contract;

    if (items_remaining > 0) {
        contract_utils::release_items_to_owned(
            source_ssu, poster_character,
            offered_type_id, items_remaining, ctx,
        );
    };

    contract_utils::emit_expired(
        contract_id, poster_id, 0, 0, 0, items_remaining,
    );

    fills.drop();
    id.delete();
}

/// Garbage-collect a completed contract.
public fun cleanup(
    contract: ItemForItemContract,
    poster_character: &Character,
    source_ssu: &mut StorageUnit,
    ctx: &mut TxContext,
) {
    contract_utils::assert_completed(&contract.status);
    assert!(object::id(source_ssu) == contract.source_ssu_id, ESourceSsuMismatch);

    let items_remaining = contract.offered_quantity - contract.items_released;
    let offered_type_id = contract.offered_type_id;

    let ItemForItemContract { id, fills, .. } = contract;

    if (items_remaining > 0) {
        contract_utils::release_items_to_owned(
            source_ssu, poster_character,
            offered_type_id, items_remaining, ctx,
        );
    };

    fills.drop();
    id.delete();
}

// === View Functions ===

public fun poster_id(c: &ItemForItemContract): ID { c.poster_id }
public fun poster_address(c: &ItemForItemContract): address { c.poster_address }
public fun offered_type_id(c: &ItemForItemContract): u64 { c.offered_type_id }
public fun offered_quantity(c: &ItemForItemContract): u32 { c.offered_quantity }
public fun source_ssu_id(c: &ItemForItemContract): ID { c.source_ssu_id }
public fun wanted_type_id(c: &ItemForItemContract): u64 { c.wanted_type_id }
public fun wanted_quantity(c: &ItemForItemContract): u32 { c.wanted_quantity }
public fun destination_ssu_id(c: &ItemForItemContract): ID { c.destination_ssu_id }
public fun use_owner_inventory(c: &ItemForItemContract): bool { c.use_owner_inventory }
public fun items_released(c: &ItemForItemContract): u32 { c.items_released }
public fun target_quantity(c: &ItemForItemContract): u64 { c.target_quantity }
public fun filled_quantity(c: &ItemForItemContract): u64 { c.filled_quantity }
public fun allow_partial(c: &ItemForItemContract): bool { c.allow_partial }
public fun deadline_ms(c: &ItemForItemContract): u64 { c.deadline_ms }
public fun status(c: &ItemForItemContract): ContractStatus { c.status }
public fun allowed_characters(c: &ItemForItemContract): vector<ID> { c.allowed_characters }
public fun allowed_tribes(c: &ItemForItemContract): vector<u32> { c.allowed_tribes }

public fun filler_contribution(c: &ItemForItemContract, filler_id: ID): u64 {
    contract_utils::filler_contribution(&c.fills, filler_id)
}

// === Test-only Helpers ===

#[test_only]
public fun destroy_for_testing(contract: ItemForItemContract) {
    let ItemForItemContract { id, fills, .. } = contract;
    fills.drop();
    id.delete();
}
