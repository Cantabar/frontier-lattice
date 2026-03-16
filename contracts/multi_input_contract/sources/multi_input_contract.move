/// Multi-Input Contract — trustless BOM-backed manufacturing order with escrow.
///
/// A `MultiInputContract<C>` is a shared object representing an active
/// production bounty. The poster escrows coins and specifies a set of material
/// slots (`type_id → required quantity`) computed by the off-chain BOM
/// optimizer at a chosen expansion depth.
///
/// Contributors fill any slot by delivering matching items to a destination
/// SSU; they receive proportional bounty (escrow / total_required × units
/// delivered) immediately on each fill. The final filler to complete the
/// contract also receives any remaining bounty dust.
///
/// The contract completes when `total_filled == total_required` (emits
/// `MultiInputContractCompletedEvent`). Incomplete contracts may be cancelled
/// by the poster or expired by anyone after the deadline.
///
/// Design principles:
/// - Generic over coin type C (phantom): deploy with C = EVE for EVE Frontier.
/// - Objects as live state, events as history. Contracts deleted on cancel/expire.
/// - Trustless: item delivery verified via SSU CormAuth extension.
/// - Standalone: depends on `world` contracts and `corm_auth`.
///
/// SSU setup: the poster's destination SSU must have `CormAuth`
/// authorised via `storage_unit::authorize_extension<CormAuth>()`.
module multi_input_contract::multi_input_contract;

use std::string::String;
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

// === Errors ===
const EDeadlineInPast: u64 = 0;
const EInsufficientEscrow: u64 = 1;
const ESlotLengthMismatch: u64 = 2;
const EEmptySlots: u64 = 3;
const EZeroQuantity: u64 = 4;
const EContractExpired: u64 = 5;
const EContractNotExpired: u64 = 6;
const EFillerNotAuthorized: u64 = 7;
const ESelfFill: u64 = 8;
const EUnknownSlot: u64 = 9;
const ESlotFull: u64 = 10;
const ENotPoster: u64 = 11;
const EContractComplete: u64 = 12;
const EDescriptionEmpty: u64 = 13;
const EDuplicateSlot: u64 = 14;

// === Structs ===

/// Per-material-type slot tracking required vs. filled quantities.
public struct SlotState has copy, drop, store {
    required: u64,
    filled: u64,
}

/// Active manufacturing order. Shared object — one per contract.
/// Holds escrowed bounty coins released proportionally to contributors.
/// Deleted when cancelled or expired (reclaims storage rebate).
/// Remains on-chain after completion (all bounty paid out).
public struct MultiInputContract<phantom C> has key {
    id: UID,
    poster_id: ID,
    poster_address: address,
    description: String,
    destination_ssu_id: ID,
    /// Ordered list of accepted type IDs (mirrors slots table for enumeration).
    slot_type_ids: vector<u64>,
    /// type_id → SlotState (required / filled quantities in base sub-units).
    slots: Table<u64, SlotState>,
    /// Sum of all slot required quantities.
    total_required: u64,
    /// Sum of all slot filled quantities.
    total_filled: u64,
    /// Escrowed bounty paid out proportionally on each fill.
    bounty: Balance<C>,
    /// Original bounty amount (immutable after creation, used for payout math).
    bounty_amount: u64,
    /// contributor Character ID → total sub-units contributed.
    fills: Table<ID, u64>,
    deadline_ms: u64,
    /// Access control: Character IDs permitted to fill (empty = open to all).
    allowed_characters: vector<ID>,
    /// Access control: in-game tribe IDs permitted to fill (empty = open to all).
    allowed_tribes: vector<u32>,
}

// === Events ===

public struct MultiInputContractCreatedEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    description: String,
    destination_ssu_id: ID,
    slot_type_ids: vector<u64>,
    slot_required_quantities: vector<u64>,
    total_required: u64,
    bounty_amount: u64,
    deadline_ms: u64,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
}

public struct SlotFilledEvent has copy, drop {
    contract_id: ID,
    filler_id: ID,
    type_id: u64,
    fill_quantity: u64,
    payout_amount: u64,
    slot_remaining: u64,
    total_remaining: u64,
}

public struct MultiInputContractCompletedEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    total_filled: u64,
    total_bounty_paid: u64,
}

public struct MultiInputContractCancelledEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    bounty_returned: u64,
}

public struct MultiInputContractExpiredEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    bounty_returned: u64,
}

// === Public Functions ===

/// Create a multi-input manufacturing order. Poster escrows a bounty coin
/// and specifies material slots via parallel vectors.
///
/// `type_ids[i]` is the item type ID for slot `i`;
/// `required_quantities[i]` is the total sub-units required for that slot.
///
/// All quantities are in base sub-units as computed by the off-chain BOM
/// optimizer. Contributors may fill any slot with any combination of items.
public fun create<C>(
    character: &Character,
    bounty_coin: Coin<C>,
    description: String,
    destination_ssu_id: ID,
    type_ids: vector<u64>,
    required_quantities: vector<u64>,
    deadline_ms: u64,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(deadline_ms > clock.timestamp_ms(), EDeadlineInPast);
    assert!(bounty_coin.value() > 0, EInsufficientEscrow);
    assert!(type_ids.length() > 0, EEmptySlots);
    assert!(type_ids.length() == required_quantities.length(), ESlotLengthMismatch);
    assert!(description.length() > 0, EDescriptionEmpty);

    let poster_id = character.id();
    let poster_address = character.character_address();
    let bounty_amount = bounty_coin.value();

    // Build the slots table and compute total_required.
    let mut slots = table::new<u64, SlotState>(ctx);
    let mut total_required: u64 = 0;
    let mut i = 0;
    while (i < type_ids.length()) {
        let type_id = type_ids[i];
        let required = required_quantities[i];
        assert!(required > 0, EZeroQuantity);
        assert!(!slots.contains(type_id), EDuplicateSlot);
        slots.add(type_id, SlotState { required, filled: 0 });
        total_required = total_required + required;
        i = i + 1;
    };

    let contract = MultiInputContract<C> {
        id: object::new(ctx),
        poster_id,
        poster_address,
        description,
        destination_ssu_id,
        slot_type_ids: type_ids,
        slots,
        total_required,
        total_filled: 0,
        bounty: bounty_coin.into_balance(),
        bounty_amount,
        fills: table::new(ctx),
        deadline_ms,
        allowed_characters,
        allowed_tribes,
    };

    let contract_id = object::id(&contract);

    event::emit(MultiInputContractCreatedEvent {
        contract_id,
        poster_id,
        description: contract.description,
        destination_ssu_id,
        slot_type_ids: contract.slot_type_ids,
        slot_required_quantities: required_quantities,
        total_required,
        bounty_amount,
        deadline_ms,
        allowed_characters: contract.allowed_characters,
        allowed_tribes: contract.allowed_tribes,
    });

    transfer::share_object(contract);
}

/// Fill a slot by delivering items to the poster's destination SSU.
///
/// The item's `type_id` determines which slot to fill. Items are deposited
/// to the poster's owned inventory at the destination SSU via the
/// `MultiInputAuth` extension. The filler receives a proportional bounty
/// payout immediately. If this fill completes the contract, any remaining
/// bounty dust also goes to the filler.
///
/// If the item quantity exceeds the slot's remaining requirement, only the
/// required portion is credited; the poster receives the full item (including
/// excess units). Fillers should deliver exactly the remaining quantity.
public fun fill_slot<C>(
    contract: &mut MultiInputContract<C>,
    destination_ssu: &mut StorageUnit,
    poster_character: &Character,
    filler_character: &Character,
    item: inventory::Item,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(clock.timestamp_ms() <= contract.deadline_ms, EContractExpired);
    assert!(contract.total_filled < contract.total_required, EContractComplete);

    let filler_id = filler_character.id();
    assert!(filler_id != contract.poster_id, ESelfFill);
    verify_filler_access(contract, filler_character);

    let type_id = inventory::type_id(&item);
    assert!(contract.slots.contains(type_id), EUnknownSlot);

    let slot = contract.slots.borrow(type_id);
    let slot_remaining = slot.required - slot.filled;
    assert!(slot_remaining > 0, ESlotFull);

    let item_qty = (inventory::quantity(&item) as u64);
    let fill_amount = if (item_qty > slot_remaining) { slot_remaining } else { item_qty };

    // Deposit item to poster's owned inventory at destination SSU.
    destination_ssu.deposit_to_owned<CormAuth>(
        poster_character,
        item,
        corm_auth::auth(),
        ctx,
    );

    // Update slot state.
    let slot_mut = contract.slots.borrow_mut(type_id);
    slot_mut.filled = slot_mut.filled + fill_amount;
    let new_slot_remaining = slot_mut.required - slot_mut.filled;

    // Update fill tracking.
    if (contract.fills.contains(filler_id)) {
        let existing = contract.fills.borrow_mut(filler_id);
        *existing = *existing + fill_amount;
    } else {
        contract.fills.add(filler_id, fill_amount);
    };

    contract.total_filled = contract.total_filled + fill_amount;

    // Calculate and release proportional bounty to filler.
    let payout_amount = (fill_amount * contract.bounty_amount) / contract.total_required;
    let filler_addr = filler_character.character_address();
    let contract_id = object::id(contract);

    if (payout_amount > 0 && contract.bounty.value() >= payout_amount) {
        let payout = coin::take(&mut contract.bounty, payout_amount, ctx);
        transfer::public_transfer(payout, filler_addr);
    };

    let total_remaining = contract.total_required - contract.total_filled;

    event::emit(SlotFilledEvent {
        contract_id,
        filler_id,
        type_id,
        fill_quantity: fill_amount,
        payout_amount,
        slot_remaining: new_slot_remaining,
        total_remaining,
    });

    // On completion: sweep remaining bounty dust to the final filler.
    if (contract.total_filled == contract.total_required) {
        let dust = contract.bounty.value();
        if (dust > 0) {
            let dust_coin = coin::take(&mut contract.bounty, dust, ctx);
            transfer::public_transfer(dust_coin, filler_addr);
        };
        event::emit(MultiInputContractCompletedEvent {
            contract_id,
            poster_id: contract.poster_id,
            total_filled: contract.total_filled,
            total_bounty_paid: contract.bounty_amount,
        });
    };
}

/// Cancel an active (incomplete) contract. Returns remaining escrow to poster.
/// Only the poster can cancel. Cannot cancel a completed contract.
public fun cancel<C>(
    contract: MultiInputContract<C>,
    poster_character: &Character,
    ctx: &mut TxContext,
) {
    assert!(poster_character.id() == contract.poster_id, ENotPoster);

    let contract_id = object::id(&contract);
    let bounty_returned = contract.bounty.value();

    let MultiInputContract {
        id,
        poster_id,
        poster_address,
        bounty,
        fills,
        slots,
        ..
    } = contract;

    if (bounty.value() > 0) {
        let coin = coin::from_balance(bounty, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        bounty.destroy_zero();
    };

    event::emit(MultiInputContractCancelledEvent {
        contract_id,
        poster_id,
        bounty_returned,
    });

    fills.drop();
    slots.drop();
    id.delete();
}

/// Expire a contract after its deadline. Anyone can call this.
/// Returns remaining bounty to the poster. Deletes the object.
public fun expire<C>(
    contract: MultiInputContract<C>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(clock.timestamp_ms() > contract.deadline_ms, EContractNotExpired);

    let contract_id = object::id(&contract);
    let bounty_returned = contract.bounty.value();

    let MultiInputContract {
        id,
        poster_id,
        poster_address,
        bounty,
        fills,
        slots,
        ..
    } = contract;

    if (bounty.value() > 0) {
        let coin = coin::from_balance(bounty, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        bounty.destroy_zero();
    };

    event::emit(MultiInputContractExpiredEvent {
        contract_id,
        poster_id,
        bounty_returned,
    });

    fills.drop();
    slots.drop();
    id.delete();
}

// === View Functions ===

public fun poster_id<C>(c: &MultiInputContract<C>): ID { c.poster_id }
public fun poster_address<C>(c: &MultiInputContract<C>): address { c.poster_address }
public fun description<C>(c: &MultiInputContract<C>): String { c.description }
public fun destination_ssu_id<C>(c: &MultiInputContract<C>): ID { c.destination_ssu_id }
public fun slot_type_ids<C>(c: &MultiInputContract<C>): vector<u64> { c.slot_type_ids }
public fun total_required<C>(c: &MultiInputContract<C>): u64 { c.total_required }
public fun total_filled<C>(c: &MultiInputContract<C>): u64 { c.total_filled }
public fun bounty_amount<C>(c: &MultiInputContract<C>): u64 { c.bounty_amount }
public fun bounty_balance<C>(c: &MultiInputContract<C>): u64 { c.bounty.value() }
public fun deadline_ms<C>(c: &MultiInputContract<C>): u64 { c.deadline_ms }
public fun allowed_characters<C>(c: &MultiInputContract<C>): vector<ID> { c.allowed_characters }
public fun allowed_tribes<C>(c: &MultiInputContract<C>): vector<u32> { c.allowed_tribes }
public fun is_complete<C>(c: &MultiInputContract<C>): bool {
    c.total_filled == c.total_required
}

public fun slot_required<C>(c: &MultiInputContract<C>, type_id: u64): u64 {
    assert!(c.slots.contains(type_id), EUnknownSlot);
    c.slots.borrow(type_id).required
}

public fun slot_filled<C>(c: &MultiInputContract<C>, type_id: u64): u64 {
    assert!(c.slots.contains(type_id), EUnknownSlot);
    c.slots.borrow(type_id).filled
}

public fun has_slot<C>(c: &MultiInputContract<C>, type_id: u64): bool {
    c.slots.contains(type_id)
}

public fun filler_contribution<C>(c: &MultiInputContract<C>, filler_id: ID): u64 {
    if (c.fills.contains(filler_id)) {
        *c.fills.borrow(filler_id)
    } else {
        0
    }
}

// === Private Helpers ===

fun verify_filler_access<C>(contract: &MultiInputContract<C>, character: &Character) {
    if (contract.allowed_characters.is_empty() && contract.allowed_tribes.is_empty()) {
        return
    };

    let character_id = character.id();
    let tribe_id = character.tribe();
    let mut authorized = false;

    let mut i = 0;
    while (i < contract.allowed_characters.length()) {
        if (contract.allowed_characters[i] == character_id) {
            authorized = true;
            break
        };
        i = i + 1;
    };

    if (!authorized) {
        let mut j = 0;
        while (j < contract.allowed_tribes.length()) {
            if (contract.allowed_tribes[j] == tribe_id) {
                authorized = true;
                break
            };
            j = j + 1;
        };
    };

    assert!(authorized, EFillerNotAuthorized);
}

// === Test-Only Helpers ===

/// Fill a slot without SSU interaction — for unit testing slot logic and
/// bounty math. Bypasses item delivery; directly credits quantity to the slot.
#[test_only]
public fun fill_slot_for_testing<C>(
    contract: &mut MultiInputContract<C>,
    filler_character: &Character,
    type_id: u64,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(clock.timestamp_ms() <= contract.deadline_ms, EContractExpired);
    assert!(contract.total_filled < contract.total_required, EContractComplete);

    let filler_id = filler_character.id();
    assert!(filler_id != contract.poster_id, ESelfFill);
    verify_filler_access(contract, filler_character);

    assert!(contract.slots.contains(type_id), EUnknownSlot);

    let slot = contract.slots.borrow(type_id);
    let slot_remaining = slot.required - slot.filled;
    assert!(slot_remaining > 0, ESlotFull);

    let fill_amount = if (quantity > slot_remaining) { slot_remaining } else { quantity };

    let slot_mut = contract.slots.borrow_mut(type_id);
    slot_mut.filled = slot_mut.filled + fill_amount;
    let new_slot_remaining = slot_mut.required - slot_mut.filled;

    if (contract.fills.contains(filler_id)) {
        let existing = contract.fills.borrow_mut(filler_id);
        *existing = *existing + fill_amount;
    } else {
        contract.fills.add(filler_id, fill_amount);
    };

    contract.total_filled = contract.total_filled + fill_amount;

    let payout_amount = (fill_amount * contract.bounty_amount) / contract.total_required;
    let filler_addr = filler_character.character_address();
    let contract_id = object::id(contract);

    if (payout_amount > 0 && contract.bounty.value() >= payout_amount) {
        let payout = coin::take(&mut contract.bounty, payout_amount, ctx);
        transfer::public_transfer(payout, filler_addr);
    };

    let total_remaining = contract.total_required - contract.total_filled;

    event::emit(SlotFilledEvent {
        contract_id,
        filler_id,
        type_id,
        fill_quantity: fill_amount,
        payout_amount,
        slot_remaining: new_slot_remaining,
        total_remaining,
    });

    if (contract.total_filled == contract.total_required) {
        let dust = contract.bounty.value();
        if (dust > 0) {
            let dust_coin = coin::take(&mut contract.bounty, dust, ctx);
            transfer::public_transfer(dust_coin, filler_addr);
        };
        event::emit(MultiInputContractCompletedEvent {
            contract_id,
            poster_id: contract.poster_id,
            total_filled: contract.total_filled,
            total_bounty_paid: contract.bounty_amount,
        });
    };
}

#[test_only]
public fun destroy_for_testing<C>(contract: MultiInputContract<C>) {
    let MultiInputContract { id, bounty, fills, slots, .. } = contract;
    bounty.destroy_for_testing();
    fills.drop();
    slots.drop();
    id.delete();
}
