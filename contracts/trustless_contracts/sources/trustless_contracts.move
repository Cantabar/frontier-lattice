/// Trustless Contracts — composable, trustless contracts with escrow, partial
/// fulfillment, SSU-based item verification, and filler access control.
///
/// Each `Contract<CE, CF>` is a shared object representing an active contract.
///   - CE (C_ESCROW): coin type the poster locks as escrow (their offer)
///   - CF (C_FILL):   coin type fillers pay in or couriers stake in
///   - In the common case (all EVE), both are the same type
///
/// Contract types:
///   - CoinForCoin:  poster offers coins, wants coins (different types)
///   - CoinForItem:  poster offers coins, wants items at an SSU
///   - ItemForCoin:  poster offers items at an SSU, wants coins
///   - ItemForItem:  poster offers items at an SSU, wants items at an SSU
///   - Transport:    poster offers coin payment, wants items delivered + courier stakes
///
/// Partial fulfillment: multiple fillers can contribute toward a target quantity.
/// Each fill releases proportional escrow. The contract auto-completes when fully filled.
///
/// Item escrow uses the SSU extension pattern: the shared `CormAuth` witness
/// (from the `corm_auth` package) is registered on SSUs, giving any Corm
/// contract module deposit/withdraw authority. Items are locked in open
/// inventory (contract-controlled, not owner-withdrawable).
///
/// Filler access control uses the world contract's in-game tribe designation
/// (`character.tribe(): u32`) and/or specific Character IDs.
///
/// Design principles:
/// - Generic over two coin types (phantom): deploy with CE = CF = EVE for common case.
/// - Objects as live state, events as history. Contracts deleted on terminal state.
/// - Trustless: verification via SSU extension, no poster confirmation needed.
/// - Standalone: no dependency on contract_board or tribe packages.
module trustless_contracts::trustless_contracts;

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
const EContractNotOpen: u64 = 2;
const EContractNotInProgress: u64 = 3;
const ENotPoster: u64 = 4;
const EContractExpired: u64 = 5;
const EContractNotExpired: u64 = 6;
const EFillerNotAuthorized: u64 = 7;
const ESelfFill: u64 = 8;
const EWrongContractType: u64 = 9;
const EInsufficientFill: u64 = 10;
const EInsufficientStake: u64 = 11;
const ECourierAlreadyAssigned: u64 = 12;
const ENotCourier: u64 = 13;
const EItemTypeMismatch: u64 = 14;
const EZeroQuantity: u64 = 15;
const EWantedAmountZero: u64 = 16;
const EContractFull: u64 = 17;
const ESourceSsuMismatch: u64 = 18;
const EItemContractRequiresItemCancel: u64 = 19;
const EContractNotCompleted: u64 = 20;

// === Enums ===

/// Describes the contract type and captures the type-specific parameters.
public enum ContractType has copy, drop, store {
    /// Poster offers coins (CE), wants coins (CF).
    CoinForCoin { offered_amount: u64, wanted_amount: u64 },
    /// Poster offers coins (CE), wants items deposited at an SSU.
    CoinForItem {
        offered_amount: u64,
        wanted_type_id: u64,
        wanted_quantity: u32,
        destination_ssu_id: ID,
    },
    /// Poster offers items locked at an SSU, wants coins (CF).
    ItemForCoin {
        offered_type_id: u64,
        offered_quantity: u32,
        source_ssu_id: ID,
        wanted_amount: u64,
    },
    /// Poster offers items at source SSU, wants items at destination SSU.
    ItemForItem {
        offered_type_id: u64,
        offered_quantity: u32,
        source_ssu_id: ID,
        wanted_type_id: u64,
        wanted_quantity: u32,
        destination_ssu_id: ID,
    },
    /// Poster offers coin payment, wants items delivered to destination SSU.
    /// Courier must stake collateral.
    Transport {
        item_type_id: u64,
        item_quantity: u32,
        source_ssu_id: ID,
        destination_ssu_id: ID,
        payment_amount: u64,
        required_stake: u64,
    },
}

/// Status of a contract.
/// Open / InProgress are live states. Completed is set when fully filled
/// but the object has not yet been garbage-collected via `cleanup_completed_contract`.
/// Terminal states (Cancelled / Expired) are recorded as events and the object is deleted.
public enum ContractStatus has copy, drop, store {
    Open,
    InProgress,
    Completed,
}

// === Structs ===

/// An active trustless contract. Shared object — one per contract.
/// CE is the escrow coin type (poster's offer), CF is the fill coin type
/// (filler's payment / courier's stake).
public struct Contract<phantom CE, phantom CF> has key {
    id: UID,
    poster_id: ID,
    poster_address: address,
    contract_type: ContractType,
    /// Poster's locked coins (zero for ItemForCoin / ItemForItem)
    escrow: Balance<CE>,
    /// Original escrow amount (immutable after creation, used for payout math)
    escrow_amount: u64,
    /// Accumulated filler payments (zero for CoinForItem)
    fill_pool: Balance<CF>,
    /// Courier's locked collateral (zero when no stake)
    courier_stake: Balance<CF>,
    courier_id: Option<ID>,
    courier_address: Option<address>,
    /// Total units wanted (coins or items depending on type)
    target_quantity: u64,
    /// Units fulfilled so far
    filled_quantity: u64,
    allow_partial: bool,
    require_stake: bool,
    stake_amount: u64,
    /// Filler Character ID → quantity contributed
    fills: Table<ID, u64>,
    deadline_ms: u64,
    status: ContractStatus,
    /// Access control: Character IDs permitted to fill (empty = open)
    allowed_characters: vector<ID>,
    /// Access control: in-game tribe IDs permitted to fill (empty = open)
    allowed_tribes: vector<u32>,
    /// Items withdrawn from open inventory so far (ItemForCoin / ItemForItem only)
    items_released: u32,
}

// === Events ===

public struct ContractCreatedEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    contract_type: ContractType,
    escrow_amount: u64,
    target_quantity: u64,
    deadline_ms: u64,
    allow_partial: bool,
    require_stake: bool,
    stake_amount: u64,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
}

public struct ContractFilledEvent has copy, drop {
    contract_id: ID,
    filler_id: ID,
    fill_quantity: u64,
    payout_amount: u64,
    remaining_quantity: u64,
}

public struct ContractCompletedEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    total_filled: u64,
    total_escrow_paid: u64,
}

public struct ContractCancelledEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    escrow_returned: u64,
    items_returned: u32,
}

public struct ContractExpiredEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    escrow_returned: u64,
    stake_forfeited: u64,
    fill_pool_returned: u64,
    items_returned: u32,
}

public struct TransportAcceptedEvent has copy, drop {
    contract_id: ID,
    courier_id: ID,
    stake_amount: u64,
}

public struct TransportDeliveredEvent has copy, drop {
    contract_id: ID,
    courier_id: ID,
    delivered_quantity: u64,
    payment_released: u64,
    stake_released: u64,
    remaining_quantity: u64,
}

// === ContractType Constructors ===

public fun type_coin_for_coin(offered_amount: u64, wanted_amount: u64): ContractType {
    ContractType::CoinForCoin { offered_amount, wanted_amount }
}

public fun type_coin_for_item(
    offered_amount: u64,
    wanted_type_id: u64,
    wanted_quantity: u32,
    destination_ssu_id: ID,
): ContractType {
    ContractType::CoinForItem { offered_amount, wanted_type_id, wanted_quantity, destination_ssu_id }
}

public fun type_item_for_coin(
    offered_type_id: u64,
    offered_quantity: u32,
    source_ssu_id: ID,
    wanted_amount: u64,
): ContractType {
    ContractType::ItemForCoin { offered_type_id, offered_quantity, source_ssu_id, wanted_amount }
}

public fun type_item_for_item(
    offered_type_id: u64,
    offered_quantity: u32,
    source_ssu_id: ID,
    wanted_type_id: u64,
    wanted_quantity: u32,
    destination_ssu_id: ID,
): ContractType {
    ContractType::ItemForItem {
        offered_type_id, offered_quantity, source_ssu_id,
        wanted_type_id, wanted_quantity, destination_ssu_id,
    }
}

public fun type_transport(
    item_type_id: u64,
    item_quantity: u32,
    source_ssu_id: ID,
    destination_ssu_id: ID,
    payment_amount: u64,
    required_stake: u64,
): ContractType {
    ContractType::Transport { item_type_id, item_quantity, source_ssu_id, destination_ssu_id, payment_amount, required_stake }
}

// === ContractStatus Constructors ===

public fun status_open(): ContractStatus { ContractStatus::Open }
public fun status_in_progress(): ContractStatus { ContractStatus::InProgress }
public fun status_completed(): ContractStatus { ContractStatus::Completed }

// === Creation Functions ===

/// Create a CoinForCoin contract. Poster locks Coin<CE>, wants Coin<CF>.
/// `target_quantity` is the wanted coin amount (in CF units).
public fun create_coin_for_coin<CE, CF>(
    character: &Character,
    escrow_coin: Coin<CE>,
    wanted_amount: u64,
    allow_partial: bool,
    deadline_ms: u64,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(deadline_ms > clock.timestamp_ms(), EDeadlineInPast);

    let offered_amount = escrow_coin.value();
    // At least one side must be non-zero; a 0/0 contract is meaningless.
    assert!(offered_amount > 0 || wanted_amount > 0, EWantedAmountZero);

    let poster_id = character.id();
    let poster_address = character.character_address();

    let contract_type = ContractType::CoinForCoin { offered_amount, wanted_amount };

    // When wanted_amount is 0 (free coin giveaway), track escrow distributed
    // instead of coins to collect so partial-fill math stays valid.
    let effective_target = if (wanted_amount == 0) {
        offered_amount
    } else {
        wanted_amount
    };

    let contract = Contract<CE, CF> {
        id: object::new(ctx),
        poster_id,
        poster_address,
        contract_type,
        escrow: escrow_coin.into_balance(),
        escrow_amount: offered_amount,
        fill_pool: balance::zero<CF>(),
        courier_stake: balance::zero<CF>(),
        courier_id: option::none(),
        courier_address: option::none(),
        target_quantity: effective_target,
        filled_quantity: 0,
        allow_partial,
        require_stake: false,
        stake_amount: 0,
        fills: table::new(ctx),
        deadline_ms,
        status: ContractStatus::Open,
        allowed_characters,
        allowed_tribes,
        items_released: 0,
    };

    let contract_id = object::id(&contract);
    event::emit(ContractCreatedEvent {
        contract_id,
        poster_id,
        contract_type,
        escrow_amount: offered_amount,
        target_quantity: effective_target,
        deadline_ms,
        allow_partial,
        require_stake: false,
        stake_amount: 0,
        allowed_characters: contract.allowed_characters,
        allowed_tribes: contract.allowed_tribes,
    });

    transfer::share_object(contract);
}

/// Create a CoinForItem contract. Poster locks Coin<CE>, wants items at an SSU.
/// `target_quantity` is the wanted item quantity (as u64 for partial fill math).
public fun create_coin_for_item<CE, CF>(
    character: &Character,
    escrow_coin: Coin<CE>,
    wanted_type_id: u64,
    wanted_quantity: u32,
    destination_ssu_id: ID,
    allow_partial: bool,
    deadline_ms: u64,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(deadline_ms > clock.timestamp_ms(), EDeadlineInPast);
    assert!(wanted_quantity > 0, EZeroQuantity);

    let offered_amount = escrow_coin.value();
    let poster_id = character.id();
    let poster_address = character.character_address();

    let contract_type = ContractType::CoinForItem {
        offered_amount,
        wanted_type_id,
        wanted_quantity,
        destination_ssu_id,
    };

    let contract = Contract<CE, CF> {
        id: object::new(ctx),
        poster_id,
        poster_address,
        contract_type,
        escrow: escrow_coin.into_balance(),
        escrow_amount: offered_amount,
        fill_pool: balance::zero<CF>(),
        courier_stake: balance::zero<CF>(),
        courier_id: option::none(),
        courier_address: option::none(),
        target_quantity: (wanted_quantity as u64),
        filled_quantity: 0,
        allow_partial,
        require_stake: false,
        stake_amount: 0,
        fills: table::new(ctx),
        deadline_ms,
        status: ContractStatus::Open,
        allowed_characters,
        allowed_tribes,
        items_released: 0,
    };

    let contract_id = object::id(&contract);
    event::emit(ContractCreatedEvent {
        contract_id,
        poster_id,
        contract_type,
        escrow_amount: offered_amount,
        target_quantity: (wanted_quantity as u64),
        deadline_ms,
        allow_partial,
        require_stake: false,
        stake_amount: 0,
        allowed_characters: contract.allowed_characters,
        allowed_tribes: contract.allowed_tribes,
    });

    transfer::share_object(contract);
}

/// Create an ItemForCoin
/// Items are moved to open inventory (contract-controlled) via our extension.
/// The SSU must have CormAuth registered as its extension.
///
/// The caller must pass in a transit `Item` that was withdrawn from the source SSU
/// in the same PTB (via `withdraw_by_owner`). Our module deposits it to open
/// inventory where it is locked until contract completion or cancellation.
public fun create_item_for_coin<CE, CF>(
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
    assert!(deadline_ms > clock.timestamp_ms(), EDeadlineInPast);
    assert!(inventory::quantity(&item) > 0, EZeroQuantity);

    let poster_id = character.id();
    let poster_address = character.character_address();
    let source_ssu_id = object::id(source_ssu);
    let offered_type_id = inventory::type_id(&item);
    let offered_quantity = inventory::quantity(&item);

    // Deposit to open inventory (locked by our extension)
    source_ssu.deposit_to_open_inventory<CormAuth>(
        character,
        item,
        corm_auth::auth(),
        ctx,
    );

    let contract_type = ContractType::ItemForCoin {
        offered_type_id,
        offered_quantity,
        source_ssu_id,
        wanted_amount,
    };

    // When wanted_amount is 0 (free distribution), track items available
    // instead of coins to collect so partial-fill math stays valid.
    let effective_target = if (wanted_amount == 0) {
        (offered_quantity as u64)
    } else {
        wanted_amount
    };

    let contract = Contract<CE, CF> {
        id: object::new(ctx),
        poster_id,
        poster_address,
        contract_type,
        escrow: balance::zero<CE>(),
        escrow_amount: 0,
        fill_pool: balance::zero<CF>(),
        courier_stake: balance::zero<CF>(),
        courier_id: option::none(),
        courier_address: option::none(),
        target_quantity: effective_target,
        filled_quantity: 0,
        allow_partial,
        require_stake: false,
        stake_amount: 0,
        fills: table::new(ctx),
        deadline_ms,
        status: ContractStatus::Open,
        allowed_characters,
        allowed_tribes,
        items_released: 0,
    };

    let contract_id = object::id(&contract);
    event::emit(ContractCreatedEvent {
        contract_id,
        poster_id,
        contract_type,
        escrow_amount: 0,
        target_quantity: effective_target,
        deadline_ms,
        allow_partial,
        require_stake: false,
        stake_amount: 0,
        allowed_characters: contract.allowed_characters,
        allowed_tribes: contract.allowed_tribes,
    });

    transfer::share_object(contract);
}

/// Create an ItemForItem contract. Poster locks items at a source SSU, wants
/// items deposited at a destination SSU. Like ItemForCoin, the caller must
/// pass a transit `Item` withdrawn from the source SSU in the same PTB.
public fun create_item_for_item<CE, CF>(
    character: &Character,
    source_ssu: &mut StorageUnit,
    item: inventory::Item,
    wanted_type_id: u64,
    wanted_quantity: u32,
    destination_ssu_id: ID,
    allow_partial: bool,
    deadline_ms: u64,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(deadline_ms > clock.timestamp_ms(), EDeadlineInPast);
    assert!(inventory::quantity(&item) > 0, EZeroQuantity);
    assert!(wanted_quantity > 0, EZeroQuantity);

    let poster_id = character.id();
    let poster_address = character.character_address();
    let source_ssu_id = object::id(source_ssu);
    let offered_type_id = inventory::type_id(&item);
    let offered_quantity = inventory::quantity(&item);

    // Deposit to open inventory (locked by our extension)
    source_ssu.deposit_to_open_inventory<CormAuth>(
        character,
        item,
        corm_auth::auth(),
        ctx,
    );

    let contract_type = ContractType::ItemForItem {
        offered_type_id,
        offered_quantity,
        source_ssu_id,
        wanted_type_id,
        wanted_quantity,
        destination_ssu_id,
    };

    let contract = Contract<CE, CF> {
        id: object::new(ctx),
        poster_id,
        poster_address,
        contract_type,
        escrow: balance::zero<CE>(),
        escrow_amount: 0,
        fill_pool: balance::zero<CF>(),
        courier_stake: balance::zero<CF>(),
        courier_id: option::none(),
        courier_address: option::none(),
        target_quantity: (wanted_quantity as u64),
        filled_quantity: 0,
        allow_partial,
        require_stake: false,
        stake_amount: 0,
        fills: table::new(ctx),
        deadline_ms,
        status: ContractStatus::Open,
        allowed_characters,
        allowed_tribes,
        items_released: 0,
    };

    let contract_id = object::id(&contract);
    event::emit(ContractCreatedEvent {
        contract_id,
        poster_id,
        contract_type,
        escrow_amount: 0,
        target_quantity: (wanted_quantity as u64),
        deadline_ms,
        allow_partial,
        require_stake: false,
        stake_amount: 0,
        allowed_characters: contract.allowed_characters,
        allowed_tribes: contract.allowed_tribes,
    });

    transfer::share_object(contract);
}

/// Create a Transport contract. Poster locks coin payment, wants items delivered
/// from a source SSU to a destination SSU. Courier must post a coin stake.
public fun create_transport<CE, CF>(
    character: &Character,
    escrow_coin: Coin<CE>,
    item_type_id: u64,
    item_quantity: u32,
    source_ssu_id: ID,
    destination_ssu_id: ID,
    required_stake: u64,
    deadline_ms: u64,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(deadline_ms > clock.timestamp_ms(), EDeadlineInPast);
    assert!(item_quantity > 0, EZeroQuantity);
    assert!(required_stake > 0, EInsufficientStake);

    let payment_amount = escrow_coin.value();
    let poster_id = character.id();
    let poster_address = character.character_address();

    let contract_type = ContractType::Transport {
        item_type_id,
        item_quantity,
        source_ssu_id,
        destination_ssu_id,
        payment_amount,
        required_stake,
    };

    let contract = Contract<CE, CF> {
        id: object::new(ctx),
        poster_id,
        poster_address,
        contract_type,
        escrow: escrow_coin.into_balance(),
        escrow_amount: payment_amount,
        fill_pool: balance::zero<CF>(),
        courier_stake: balance::zero<CF>(),
        courier_id: option::none(),
        courier_address: option::none(),
        target_quantity: (item_quantity as u64),
        filled_quantity: 0,
        allow_partial: true, // transport always supports partial delivery
        require_stake: true,
        stake_amount: required_stake,
        fills: table::new(ctx),
        deadline_ms,
        status: ContractStatus::Open,
        allowed_characters,
        allowed_tribes,
        items_released: 0,
    };

    let contract_id = object::id(&contract);
    event::emit(ContractCreatedEvent {
        contract_id,
        poster_id,
        contract_type,
        escrow_amount: payment_amount,
        target_quantity: (item_quantity as u64),
        deadline_ms,
        allow_partial: true,
        require_stake: true,
        stake_amount: required_stake,
        allowed_characters: contract.allowed_characters,
        allowed_tribes: contract.allowed_tribes,
    });

    transfer::share_object(contract);
}

// === Fill Functions ===

/// Fill a CoinForCoin contract. Filler pays Coin<CF>, receives proportional
/// Coin<CE> from escrow. Supports partial fill.
public fun fill_with_coins<CE, CF>(
    contract: &mut Contract<CE, CF>,
    mut fill_coin: Coin<CF>,
    filler_character: &Character,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(clock.timestamp_ms() <= contract.deadline_ms, EContractExpired);
    assert!(fill_coin.value() > 0, EInsufficientFill);

    let filler_id = filler_character.id();
    assert!(filler_id != contract.poster_id, ESelfFill);
    verify_filler_access(contract, filler_character);

    // Only valid for CoinForCoin and ItemForCoin
    assert!(
        is_coin_for_coin(&contract.contract_type) || is_item_for_coin(&contract.contract_type),
        EWrongContractType,
    );

    let remaining = contract.target_quantity - contract.filled_quantity;
    assert!(remaining > 0, EContractFull);

    // Cap fill to remaining (return excess)
    let fill_amount = if (fill_coin.value() > remaining) {
        remaining
    } else {
        fill_coin.value()
    };

    // If not partial, must fill completely
    if (!contract.allow_partial) {
        assert!(fill_amount == remaining, EInsufficientFill);
    };

    // Split excess back to filler if overpaid
    if (fill_coin.value() > fill_amount) {
        let excess_amount = fill_coin.value() - fill_amount;
        let excess = fill_coin.split(excess_amount, ctx);
        transfer::public_transfer(excess, filler_character.character_address());
    };

    // Add to fill pool
    contract.fill_pool.join(fill_coin.into_balance());

    // Track fill
    if (contract.fills.contains(filler_id)) {
        let existing = contract.fills.borrow_mut(filler_id);
        *existing = *existing + fill_amount;
    } else {
        contract.fills.add(filler_id, fill_amount);
    };

    contract.filled_quantity = contract.filled_quantity + fill_amount;

    // Calculate proportional escrow payout
    let payout_amount = (fill_amount * contract.escrow_amount) / contract.target_quantity;

    let contract_id = object::id(contract);

    // For CoinForCoin: release proportional escrow to filler
    if (is_coin_for_coin(&contract.contract_type) && payout_amount > 0) {
        let payout = coin::take(&mut contract.escrow, payout_amount, ctx);
        transfer::public_transfer(payout, filler_character.character_address());
    };

    // For CoinForCoin: release filler's payment to poster
    if (is_coin_for_coin(&contract.contract_type) && fill_amount > 0) {
        let poster_payout = coin::take(&mut contract.fill_pool, fill_amount, ctx);
        transfer::public_transfer(poster_payout, contract.poster_address);
    };

    // For ItemForCoin: release proportional items handled separately via fill_item_for_coin

    event::emit(ContractFilledEvent {
        contract_id,
        filler_id,
        fill_quantity: fill_amount,
        payout_amount,
        remaining_quantity: contract.target_quantity - contract.filled_quantity,
    });

    // Auto-complete if fully filled
    if (contract.filled_quantity == contract.target_quantity) {
        contract.status = ContractStatus::Completed;
        event::emit(ContractCompletedEvent {
            contract_id,
            poster_id: contract.poster_id,
            total_filled: contract.filled_quantity,
            total_escrow_paid: contract.escrow_amount,
        });
    };
}

/// Fill a CoinForItem contract with items.
/// destination SSU via our extension, receives proportional coin escrow.
/// The Item must have been withdrawn from the destination SSU (parent_id match).
public fun fill_with_items<CE, CF>(
    contract: &mut Contract<CE, CF>,
    destination_ssu: &mut StorageUnit,
    poster_character: &Character,
    filler_character: &Character,
    item: inventory::Item,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(clock.timestamp_ms() <= contract.deadline_ms, EContractExpired);

    let filler_id = filler_character.id();
    assert!(filler_id != contract.poster_id, ESelfFill);
    verify_filler_access(contract, filler_character);

    // Valid for CoinForItem only; ItemForItem uses fill_item_for_item
    assert!(
        is_coin_for_item(&contract.contract_type),
        EWrongContractType,
    );

    // Verify item matches what the contract wants
    let wanted_type_id = get_wanted_type_id(&contract.contract_type);
    assert!(inventory::type_id(&item) == wanted_type_id, EItemTypeMismatch);

    let item_qty = (inventory::quantity(&item) as u64);
    assert!(item_qty > 0, EZeroQuantity);

    let remaining = contract.target_quantity - contract.filled_quantity;
    assert!(remaining > 0, EContractFull);

    // Cap to remaining
    let fill_amount = if (item_qty > remaining) { remaining } else { item_qty };

    // If not partial, must fill completely
    if (!contract.allow_partial) {
        assert!(fill_amount == remaining, EInsufficientFill);
    };

    // Deposit item to poster's owned inventory at destination SSU
    destination_ssu.deposit_to_owned<CormAuth>(
        poster_character,
        item,
        corm_auth::auth(),
        ctx,
    );

    // Track fill
    if (contract.fills.contains(filler_id)) {
        let existing = contract.fills.borrow_mut(filler_id);
        *existing = *existing + fill_amount;
    } else {
        contract.fills.add(filler_id, fill_amount);
    };

    contract.filled_quantity = contract.filled_quantity + fill_amount;

    // Calculate proportional escrow payout to filler
    let payout_amount = (fill_amount * contract.escrow_amount) / contract.target_quantity;

    let contract_id = object::id(contract);

    // Release proportional escrow coins to filler
    if (payout_amount > 0 && contract.escrow.value() > 0) {
        let actual_payout = if (payout_amount > contract.escrow.value()) {
            contract.escrow.value()
        } else {
            payout_amount
        };
        let payout = coin::take(&mut contract.escrow, actual_payout, ctx);
        transfer::public_transfer(payout, filler_character.character_address());
    };

    event::emit(ContractFilledEvent {
        contract_id,
        filler_id,
        fill_quantity: fill_amount,
        payout_amount,
        remaining_quantity: contract.target_quantity - contract.filled_quantity,
    });

    // Auto-complete if fully filled
    if (contract.filled_quantity == contract.target_quantity) {
        contract.status = ContractStatus::Completed;
        event::emit(ContractCompletedEvent {
            contract_id,
            poster_id: contract.poster_id,
            total_filled: contract.filled_quantity,
            total_escrow_paid: contract.escrow_amount,
        });
    };
}

/// Fill an ItemForCoin contract with coins.
/// proportional items from the source SSU open inventory.
public fun fill_item_for_coin<CE, CF>(
    contract: &mut Contract<CE, CF>,
    source_ssu: &mut StorageUnit,
    poster_character: &Character,
    filler_character: &Character,
    mut fill_coin: Coin<CF>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(clock.timestamp_ms() <= contract.deadline_ms, EContractExpired);
    assert!(fill_coin.value() > 0, EInsufficientFill);

    let filler_id = filler_character.id();
    assert!(filler_id != contract.poster_id, ESelfFill);
    verify_filler_access(contract, filler_character);

    assert!(is_item_for_coin(&contract.contract_type), EWrongContractType);

    let remaining = contract.target_quantity - contract.filled_quantity;
    assert!(remaining > 0, EContractFull);

    // Cap fill to remaining
    let fill_amount = if (fill_coin.value() > remaining) {
        remaining
    } else {
        fill_coin.value()
    };

    if (!contract.allow_partial) {
        assert!(fill_amount == remaining, EInsufficientFill);
    };

    // Return excess to filler
    if (fill_coin.value() > fill_amount) {
        let excess_amount = fill_coin.value() - fill_amount;
        let excess = fill_coin.split(excess_amount, ctx);
        transfer::public_transfer(excess, filler_character.character_address());
    };

    // Add filler's coins to fill_pool (goes to poster on completion)
    contract.fill_pool.join(fill_coin.into_balance());

    // Track fill
    if (contract.fills.contains(filler_id)) {
        let existing = contract.fills.borrow_mut(filler_id);
        *existing = *existing + fill_amount;
    } else {
        contract.fills.add(filler_id, fill_amount);
    };

    contract.filled_quantity = contract.filled_quantity + fill_amount;

    // Calculate proportional item release
    let (offered_type_id, offered_quantity) = get_offered_item_info(&contract.contract_type);
    let items_to_release = ((fill_amount * (offered_quantity as u64)) / contract.target_quantity as u32);

    let contract_id = object::id(contract);

    // Release proportional items to filler from open inventory
    if (items_to_release > 0) {
        let released_item = source_ssu.withdraw_from_open_inventory<CormAuth>(
            filler_character,
            corm_auth::auth(),
            offered_type_id,
            items_to_release,
            ctx,
        );
        source_ssu.deposit_to_owned<CormAuth>(
            filler_character,
            released_item,
            corm_auth::auth(),
            ctx,
        );
        contract.items_released = contract.items_released + items_to_release;
    };

    // Release fill_pool coins to poster proportionally
    let poster_payout = fill_amount;
    if (poster_payout > 0) {
        let payout = coin::take(&mut contract.fill_pool, poster_payout, ctx);
        transfer::public_transfer(payout, contract.poster_address);
    };

    event::emit(ContractFilledEvent {
        contract_id,
        filler_id,
        fill_quantity: fill_amount,
        payout_amount: (items_to_release as u64),
        remaining_quantity: contract.target_quantity - contract.filled_quantity,
    });

    if (contract.filled_quantity == contract.target_quantity) {
        // Return any rounding dust items to poster
        let dust_items = offered_quantity - contract.items_released;
        if (dust_items > 0) {
            let dust = source_ssu.withdraw_from_open_inventory<CormAuth>(
                poster_character,
                corm_auth::auth(),
                offered_type_id,
                dust_items,
                ctx,
            );
            source_ssu.deposit_to_owned<CormAuth>(
                poster_character,
                dust,
                corm_auth::auth(),
                ctx,
            );
            contract.items_released = contract.items_released + dust_items;
        };

        contract.status = ContractStatus::Completed;
        event::emit(ContractCompletedEvent {
            contract_id,
            poster_id: contract.poster_id,
            total_filled: contract.filled_quantity,
            total_escrow_paid: contract.target_quantity,
        });
    };
}

/// Claim items from a free ItemForCoin contract (wanted_amount = 0).
/// No coins required. Filler specifies how many items to claim.
public fun claim_free_items<CE, CF>(
    contract: &mut Contract<CE, CF>,
    source_ssu: &mut StorageUnit,
    filler_character: &Character,
    quantity: u32,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(clock.timestamp_ms() <= contract.deadline_ms, EContractExpired);
    assert!(is_item_for_coin(&contract.contract_type), EWrongContractType);
    assert!(get_wanted_coin_amount(&contract.contract_type) == 0, EWrongContractType);
    assert!(quantity > 0, EZeroQuantity);

    let filler_id = filler_character.id();
    assert!(filler_id != contract.poster_id, ESelfFill);
    verify_filler_access(contract, filler_character);

    // Verify source SSU matches
    let source_ssu_id = get_source_ssu_id(&contract.contract_type);
    assert!(object::id(source_ssu) == source_ssu_id, ESourceSsuMismatch);

    let remaining = contract.target_quantity - contract.filled_quantity;
    assert!(remaining > 0, EContractFull);

    // Cap to remaining
    let claim_amount = if ((quantity as u64) > remaining) {
        (remaining as u32)
    } else {
        quantity
    };

    if (!contract.allow_partial) {
        assert!((claim_amount as u64) == remaining, EInsufficientFill);
    };

    // Track fill (by items, since target_quantity == offered_quantity for free contracts)
    let fill_amount = (claim_amount as u64);
    if (contract.fills.contains(filler_id)) {
        let existing = contract.fills.borrow_mut(filler_id);
        *existing = *existing + fill_amount;
    } else {
        contract.fills.add(filler_id, fill_amount);
    };

    contract.filled_quantity = contract.filled_quantity + fill_amount;

    // Release items from open inventory to filler's owned inventory
    let (offered_type_id, _) = get_offered_item_info(&contract.contract_type);
    let released_item = source_ssu.withdraw_from_open_inventory<CormAuth>(
        filler_character,
        corm_auth::auth(),
        offered_type_id,
        claim_amount,
        ctx,
    );
    source_ssu.deposit_to_owned<CormAuth>(
        filler_character,
        released_item,
        corm_auth::auth(),
        ctx,
    );
    contract.items_released = contract.items_released + claim_amount;

    let contract_id = object::id(contract);

    event::emit(ContractFilledEvent {
        contract_id,
        filler_id,
        fill_quantity: fill_amount,
        payout_amount: 0,
        remaining_quantity: contract.target_quantity - contract.filled_quantity,
    });

    if (contract.filled_quantity == contract.target_quantity) {
        contract.status = ContractStatus::Completed;
        event::emit(ContractCompletedEvent {
            contract_id,
            poster_id: contract.poster_id,
            total_filled: contract.filled_quantity,
            total_escrow_paid: 0,
        });
    };
}

/// Claim coins from a free CoinForCoin contract (wanted_amount = 0).
/// No fill coin required. Filler specifies how many escrow units to claim.
public fun claim_free_coins<CE, CF>(
    contract: &mut Contract<CE, CF>,
    filler_character: &Character,
    amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(clock.timestamp_ms() <= contract.deadline_ms, EContractExpired);
    assert!(is_coin_for_coin(&contract.contract_type), EWrongContractType);
    assert!(get_c4c_wanted_amount(&contract.contract_type) == 0, EWrongContractType);
    assert!(amount > 0, EZeroQuantity);

    let filler_id = filler_character.id();
    assert!(filler_id != contract.poster_id, ESelfFill);
    verify_filler_access(contract, filler_character);

    let remaining = contract.target_quantity - contract.filled_quantity;
    assert!(remaining > 0, EContractFull);

    // Cap to remaining
    let claim_amount = if (amount > remaining) { remaining } else { amount };

    if (!contract.allow_partial) {
        assert!(claim_amount == remaining, EInsufficientFill);
    };

    // Track fill
    if (contract.fills.contains(filler_id)) {
        let existing = contract.fills.borrow_mut(filler_id);
        *existing = *existing + claim_amount;
    } else {
        contract.fills.add(filler_id, claim_amount);
    };

    contract.filled_quantity = contract.filled_quantity + claim_amount;

    // Release proportional escrow to filler
    let payout = if (claim_amount > contract.escrow.value()) {
        contract.escrow.value()
    } else {
        claim_amount
    };
    if (payout > 0) {
        let coin = coin::take(&mut contract.escrow, payout, ctx);
        transfer::public_transfer(coin, filler_character.character_address());
    };

    let contract_id = object::id(contract);

    event::emit(ContractFilledEvent {
        contract_id,
        filler_id,
        fill_quantity: claim_amount,
        payout_amount: payout,
        remaining_quantity: contract.target_quantity - contract.filled_quantity,
    });

    if (contract.filled_quantity == contract.target_quantity) {
        // Release any rounding dust to poster
        let dust = contract.escrow.value();
        if (dust > 0) {
            let dust_coin = coin::take(&mut contract.escrow, dust, ctx);
            transfer::public_transfer(dust_coin, contract.poster_address);
        };

        contract.status = ContractStatus::Completed;
        event::emit(ContractCompletedEvent {
            contract_id,
            poster_id: contract.poster_id,
            total_filled: contract.filled_quantity,
            total_escrow_paid: contract.escrow_amount,
        });
    };
}

/// Fill an ItemForItem contract. Filler deposits wanted items at the destination SSU,
/// receives proportional offered items from the source SSU open inventory.
public fun fill_item_for_item<CE, CF>(
    contract: &mut Contract<CE, CF>,
    source_ssu: &mut StorageUnit,
    destination_ssu: &mut StorageUnit,
    poster_character: &Character,
    filler_character: &Character,
    item: inventory::Item,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(clock.timestamp_ms() <= contract.deadline_ms, EContractExpired);
    assert!(is_item_for_item(&contract.contract_type), EWrongContractType);

    let filler_id = filler_character.id();
    assert!(filler_id != contract.poster_id, ESelfFill);
    verify_filler_access(contract, filler_character);

    // Verify source SSU matches
    let source_ssu_id = get_source_ssu_id(&contract.contract_type);
    assert!(object::id(source_ssu) == source_ssu_id, ESourceSsuMismatch);

    // Verify item matches what the contract wants
    let wanted_type_id = get_wanted_type_id(&contract.contract_type);
    assert!(inventory::type_id(&item) == wanted_type_id, EItemTypeMismatch);

    let item_qty = (inventory::quantity(&item) as u64);
    assert!(item_qty > 0, EZeroQuantity);

    let remaining = contract.target_quantity - contract.filled_quantity;
    assert!(remaining > 0, EContractFull);

    let fill_amount = if (item_qty > remaining) { remaining } else { item_qty };

    if (!contract.allow_partial) {
        assert!(fill_amount == remaining, EInsufficientFill);
    };

    // Deposit filler's items to poster's owned inventory at destination SSU
    destination_ssu.deposit_to_owned<CormAuth>(
        poster_character,
        item,
        corm_auth::auth(),
        ctx,
    );

    // Track fill
    if (contract.fills.contains(filler_id)) {
        let existing = contract.fills.borrow_mut(filler_id);
        *existing = *existing + fill_amount;
    } else {
        contract.fills.add(filler_id, fill_amount);
    };

    contract.filled_quantity = contract.filled_quantity + fill_amount;

    // Calculate proportional offered items to release to filler
    let (offered_type_id, offered_quantity) = get_offered_item_info(&contract.contract_type);
    let items_to_release = ((fill_amount * (offered_quantity as u64)) / contract.target_quantity as u32);

    let contract_id = object::id(contract);

    // Release proportional offered items from source open inventory to filler
    if (items_to_release > 0) {
        let released_item = source_ssu.withdraw_from_open_inventory<CormAuth>(
            filler_character,
            corm_auth::auth(),
            offered_type_id,
            items_to_release,
            ctx,
        );
        source_ssu.deposit_to_owned<CormAuth>(
            filler_character,
            released_item,
            corm_auth::auth(),
            ctx,
        );
        contract.items_released = contract.items_released + items_to_release;
    };

    event::emit(ContractFilledEvent {
        contract_id,
        filler_id,
        fill_quantity: fill_amount,
        payout_amount: (items_to_release as u64),
        remaining_quantity: contract.target_quantity - contract.filled_quantity,
    });

    // Auto-complete if fully filled
    if (contract.filled_quantity == contract.target_quantity) {
        // Return any rounding dust items to poster
        let dust_items = offered_quantity - contract.items_released;
        if (dust_items > 0) {
            let dust = source_ssu.withdraw_from_open_inventory<CormAuth>(
                poster_character,
                corm_auth::auth(),
                offered_type_id,
                dust_items,
                ctx,
            );
            source_ssu.deposit_to_owned<CormAuth>(
                poster_character,
                dust,
                corm_auth::auth(),
                ctx,
            );
            contract.items_released = contract.items_released + dust_items;
        };

        contract.status = ContractStatus::Completed;
        event::emit(ContractCompletedEvent {
            contract_id,
            poster_id: contract.poster_id,
            total_filled: contract.filled_quantity,
            total_escrow_paid: 0,
        });
    };
}

/// Variant of `fill_item_for_item` for contracts where source SSU == destination SSU.
/// SUI forbids two `&mut` references to the same object in a single call, so this
/// function accepts a single `&mut StorageUnit` used for both deposit and withdrawal.
public fun fill_item_for_item_same_ssu<CE, CF>(
    contract: &mut Contract<CE, CF>,
    ssu: &mut StorageUnit,
    poster_character: &Character,
    filler_character: &Character,
    item: inventory::Item,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(clock.timestamp_ms() <= contract.deadline_ms, EContractExpired);
    assert!(is_item_for_item(&contract.contract_type), EWrongContractType);

    let filler_id = filler_character.id();
    assert!(filler_id != contract.poster_id, ESelfFill);
    verify_filler_access(contract, filler_character);

    // Verify SSU matches both source and destination
    let source_ssu_id = get_source_ssu_id(&contract.contract_type);
    assert!(object::id(ssu) == source_ssu_id, ESourceSsuMismatch);

    // Verify item matches what the contract wants
    let wanted_type_id = get_wanted_type_id(&contract.contract_type);
    assert!(inventory::type_id(&item) == wanted_type_id, EItemTypeMismatch);

    let item_qty = (inventory::quantity(&item) as u64);
    assert!(item_qty > 0, EZeroQuantity);

    let remaining = contract.target_quantity - contract.filled_quantity;
    assert!(remaining > 0, EContractFull);

    let fill_amount = if (item_qty > remaining) { remaining } else { item_qty };

    if (!contract.allow_partial) {
        assert!(fill_amount == remaining, EInsufficientFill);
    };

    // Deposit filler's items to poster's owned inventory at the SSU
    ssu.deposit_to_owned<CormAuth>(
        poster_character,
        item,
        corm_auth::auth(),
        ctx,
    );

    // Track fill
    if (contract.fills.contains(filler_id)) {
        let existing = contract.fills.borrow_mut(filler_id);
        *existing = *existing + fill_amount;
    } else {
        contract.fills.add(filler_id, fill_amount);
    };

    contract.filled_quantity = contract.filled_quantity + fill_amount;

    // Calculate proportional offered items to release to filler
    let (offered_type_id, offered_quantity) = get_offered_item_info(&contract.contract_type);
    let items_to_release = ((fill_amount * (offered_quantity as u64)) / contract.target_quantity as u32);

    let contract_id = object::id(contract);

    // Release proportional offered items from source open inventory to filler
    if (items_to_release > 0) {
        let released_item = ssu.withdraw_from_open_inventory<CormAuth>(
            filler_character,
            corm_auth::auth(),
            offered_type_id,
            items_to_release,
            ctx,
        );
        ssu.deposit_to_owned<CormAuth>(
            filler_character,
            released_item,
            corm_auth::auth(),
            ctx,
        );
        contract.items_released = contract.items_released + items_to_release;
    };

    event::emit(ContractFilledEvent {
        contract_id,
        filler_id,
        fill_quantity: fill_amount,
        payout_amount: (items_to_release as u64),
        remaining_quantity: contract.target_quantity - contract.filled_quantity,
    });

    // Auto-complete if fully filled
    if (contract.filled_quantity == contract.target_quantity) {
        // Return any rounding dust items to poster
        let dust_items = offered_quantity - contract.items_released;
        if (dust_items > 0) {
            let dust = ssu.withdraw_from_open_inventory<CormAuth>(
                poster_character,
                corm_auth::auth(),
                offered_type_id,
                dust_items,
                ctx,
            );
            ssu.deposit_to_owned<CormAuth>(
                poster_character,
                dust,
                corm_auth::auth(),
                ctx,
            );
            contract.items_released = contract.items_released + dust_items;
        };

        contract.status = ContractStatus::Completed;
        event::emit(ContractCompletedEvent {
            contract_id,
            poster_id: contract.poster_id,
            total_filled: contract.filled_quantity,
            total_escrow_paid: 0,
        });
    };
}

// === Transport Functions ===

/// Courier accepts a transport contract by locking a coin stake.
public fun accept_transport<CE, CF>(
    contract: &mut Contract<CE, CF>,
    stake_coin: Coin<CF>,
    courier_character: &Character,
    clock: &Clock,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(clock.timestamp_ms() <= contract.deadline_ms, EContractExpired);
    assert!(is_transport(&contract.contract_type), EWrongContractType);
    assert!(contract.courier_id.is_none(), ECourierAlreadyAssigned);

    let courier_id = courier_character.id();
    assert!(courier_id != contract.poster_id, ESelfFill);
    verify_filler_access(contract, courier_character);

    assert!(stake_coin.value() >= contract.stake_amount, EInsufficientStake);

    contract.courier_stake.join(stake_coin.into_balance());
    contract.courier_id = option::some(courier_id);
    contract.courier_address = option::some(courier_character.character_address());
    contract.status = ContractStatus::InProgress;

    event::emit(TransportAcceptedEvent {
        contract_id: object::id(contract),
        courier_id,
        stake_amount: contract.courier_stake.value(),
    });
}

/// Courier delivers items to the destination SSU. The courier must have
/// already withdrawn the Item from their owned inventory in the same PTB.
/// Module verifies the Item, deposits to poster's owned inventory, and
/// releases proportional payment + stake.
public fun deliver_transport<CE, CF>(
    contract: &mut Contract<CE, CF>,
    destination_ssu: &mut StorageUnit,
    courier_character: &Character,
    poster_character: &Character,
    item: inventory::Item,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::InProgress, EContractNotInProgress);
    assert!(clock.timestamp_ms() <= contract.deadline_ms, EContractExpired);
    assert!(is_transport(&contract.contract_type), EWrongContractType);

    let courier_id = courier_character.id();
    assert!(contract.courier_id.contains(&courier_id), ENotCourier);

    // Verify item matches contract
    let (wanted_type_id, _) = get_transport_item_info(&contract.contract_type);
    assert!(inventory::type_id(&item) == wanted_type_id, EItemTypeMismatch);

    let item_qty = (inventory::quantity(&item) as u64);
    assert!(item_qty > 0, EZeroQuantity);

    let remaining = contract.target_quantity - contract.filled_quantity;
    assert!(remaining > 0, EContractFull);

    let fill_amount = if (item_qty > remaining) { remaining } else { item_qty };

    // Deposit item to poster's owned inventory at destination SSU
    destination_ssu.deposit_to_owned<CormAuth>(
        poster_character,
        item,
        corm_auth::auth(),
        ctx,
    );

    // Track fill
    if (contract.fills.contains(courier_id)) {
        let existing = contract.fills.borrow_mut(courier_id);
        *existing = *existing + fill_amount;
    } else {
        contract.fills.add(courier_id, fill_amount);
    };

    contract.filled_quantity = contract.filled_quantity + fill_amount;

    // Proportional payment from escrow
    let payment = (fill_amount * contract.escrow_amount) / contract.target_quantity;
    // Proportional stake return
    let stake_return = (fill_amount * contract.stake_amount) / contract.target_quantity;

    let contract_id = object::id(contract);
    let courier_addr = courier_character.character_address();

    if (payment > 0 && contract.escrow.value() >= payment) {
        let payout = coin::take(&mut contract.escrow, payment, ctx);
        transfer::public_transfer(payout, courier_addr);
    };

    if (stake_return > 0 && contract.courier_stake.value() >= stake_return) {
        let returned = coin::take(&mut contract.courier_stake, stake_return, ctx);
        transfer::public_transfer(returned, courier_addr);
    };

    event::emit(TransportDeliveredEvent {
        contract_id,
        courier_id,
        delivered_quantity: fill_amount,
        payment_released: payment,
        stake_released: stake_return,
        remaining_quantity: contract.target_quantity - contract.filled_quantity,
    });

    if (contract.filled_quantity == contract.target_quantity) {
        // Release any remaining escrow dust and stake dust to courier
        let escrow_dust = contract.escrow.value();
        if (escrow_dust > 0) {
            let dust = coin::take(&mut contract.escrow, escrow_dust, ctx);
            transfer::public_transfer(dust, courier_addr);
        };
        let stake_dust = contract.courier_stake.value();
        if (stake_dust > 0) {
            let dust = coin::take(&mut contract.courier_stake, stake_dust, ctx);
            transfer::public_transfer(dust, courier_addr);
        };

        contract.status = ContractStatus::Completed;
        event::emit(ContractCompletedEvent {
            contract_id,
            poster_id: contract.poster_id,
            total_filled: contract.filled_quantity,
            total_escrow_paid: contract.escrow_amount,
        });
    };
}

// === Lifecycle Functions ===

/// Cancel an open coin-only contract (CoinForCoin, CoinForItem, Transport).
/// Item-bearing contracts (ItemForCoin, ItemForItem) must use cancel_item_contract.
/// Only the poster can cancel. Cannot cancel InProgress transport (courier has stake).
public fun cancel_contract<CE, CF>(
    contract: Contract<CE, CF>,
    poster_character: &Character,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(poster_character.id() == contract.poster_id, ENotPoster);
    // Item-bearing contracts must use cancel_item_contract
    assert!(
        !is_item_for_coin(&contract.contract_type) && !is_item_for_item(&contract.contract_type),
        EItemContractRequiresItemCancel,
    );

    let contract_id = object::id(&contract);
    let escrow_returned = contract.escrow.value();

    let Contract {
        id,
        poster_id,
        poster_address,
        escrow,
        fill_pool,
        courier_stake,
        fills,
        ..
    } = contract;

    // Return remaining escrow to poster
    if (escrow.value() > 0) {
        let coin = coin::from_balance(escrow, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        escrow.destroy_zero();
    };

    // Return any fill_pool to poster
    if (fill_pool.value() > 0) {
        let coin = coin::from_balance(fill_pool, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        fill_pool.destroy_zero();
    };

    courier_stake.destroy_zero(); // No stake on open contracts

    event::emit(ContractCancelledEvent {
        contract_id,
        poster_id,
        escrow_returned,
        items_returned: 0,
    });

    fills.drop();
    id.delete();
}

/// Cancel an item-bearing contract (ItemForCoin or ItemForItem).
/// Returns remaining escrowed items from SSU open inventory to poster's owned inventory.
/// Only the poster can cancel. Contract must be Open.
public fun cancel_item_contract<CE, CF>(
    contract: Contract<CE, CF>,
    poster_character: &Character,
    source_ssu: &mut StorageUnit,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(poster_character.id() == contract.poster_id, ENotPoster);
    assert!(
        is_item_for_coin(&contract.contract_type) || is_item_for_item(&contract.contract_type),
        EWrongContractType,
    );

    // Verify source SSU matches
    let source_ssu_id = get_source_ssu_id(&contract.contract_type);
    assert!(object::id(source_ssu) == source_ssu_id, ESourceSsuMismatch);

    let contract_id = object::id(&contract);
    let escrow_returned = contract.escrow.value();

    // Calculate remaining items in open inventory
    let (offered_type_id, offered_quantity) = get_offered_item_info(&contract.contract_type);
    let items_remaining = offered_quantity - contract.items_released;

    let Contract {
        id,
        poster_id,
        poster_address,
        escrow,
        fill_pool,
        courier_stake,
        fills,
        ..
    } = contract;

    // Return remaining items from open inventory to poster
    if (items_remaining > 0) {
        let returned_item = source_ssu.withdraw_from_open_inventory<CormAuth>(
            poster_character,
            corm_auth::auth(),
            offered_type_id,
            items_remaining,
            ctx,
        );
        source_ssu.deposit_to_owned<CormAuth>(
            poster_character,
            returned_item,
            corm_auth::auth(),
            ctx,
        );
    };

    // Return remaining escrow to poster (zero for item-escrow, but handle generically)
    if (escrow.value() > 0) {
        let coin = coin::from_balance(escrow, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        escrow.destroy_zero();
    };

    // Return any fill_pool to poster
    if (fill_pool.value() > 0) {
        let coin = coin::from_balance(fill_pool, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        fill_pool.destroy_zero();
    };

    courier_stake.destroy_zero();

    event::emit(ContractCancelledEvent {
        contract_id,
        poster_id,
        escrow_returned,
        items_returned: items_remaining,
    });

    fills.drop();
    id.delete();
}

/// Expire a coin-only contract after its deadline. Anyone can call this.
/// Item-bearing contracts must use expire_item_contract.
/// Escrow → poster. Stake → poster (forfeited). Fill pool → poster.
public fun expire_contract<CE, CF>(
    contract: Contract<CE, CF>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(clock.timestamp_ms() > contract.deadline_ms, EContractNotExpired);
    // Item-bearing contracts must use expire_item_contract
    assert!(
        !is_item_for_coin(&contract.contract_type) && !is_item_for_item(&contract.contract_type),
        EItemContractRequiresItemCancel,
    );

    let contract_id = object::id(&contract);
    let escrow_returned = contract.escrow.value();
    let stake_forfeited = contract.courier_stake.value();
    let fill_pool_returned = contract.fill_pool.value();

    let Contract {
        id,
        poster_id,
        poster_address,
        escrow,
        fill_pool,
        courier_stake,
        fills,
        ..
    } = contract;

    // Return remaining escrow to poster
    if (escrow.value() > 0) {
        let coin = coin::from_balance(escrow, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        escrow.destroy_zero();
    };

    // Forfeit courier stake to poster
    if (courier_stake.value() > 0) {
        let coin = coin::from_balance(courier_stake, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        courier_stake.destroy_zero();
    };

    // Return fill pool to poster
    if (fill_pool.value() > 0) {
        let coin = coin::from_balance(fill_pool, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        fill_pool.destroy_zero();
    };

    event::emit(ContractExpiredEvent {
        contract_id,
        poster_id,
        escrow_returned,
        stake_forfeited,
        fill_pool_returned,
        items_returned: 0,
    });

    fills.drop();
    id.delete();
}

/// Expire an item-bearing contract (ItemForCoin or ItemForItem) after deadline.
/// Returns remaining escrowed items to poster's owned inventory.
/// Anyone can call this (poster_character is a shared object needed for deposit).
public fun expire_item_contract<CE, CF>(
    contract: Contract<CE, CF>,
    poster_character: &Character,
    source_ssu: &mut StorageUnit,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(clock.timestamp_ms() > contract.deadline_ms, EContractNotExpired);
    assert!(
        is_item_for_coin(&contract.contract_type) || is_item_for_item(&contract.contract_type),
        EWrongContractType,
    );

    let source_ssu_id = get_source_ssu_id(&contract.contract_type);
    assert!(object::id(source_ssu) == source_ssu_id, ESourceSsuMismatch);

    let contract_id = object::id(&contract);
    let escrow_returned = contract.escrow.value();
    let stake_forfeited = contract.courier_stake.value();
    let fill_pool_returned = contract.fill_pool.value();

    let (offered_type_id, offered_quantity) = get_offered_item_info(&contract.contract_type);
    let items_remaining = offered_quantity - contract.items_released;

    let Contract {
        id,
        poster_id,
        poster_address,
        escrow,
        fill_pool,
        courier_stake,
        fills,
        ..
    } = contract;

    // Return remaining items from open inventory to poster
    if (items_remaining > 0) {
        let returned_item = source_ssu.withdraw_from_open_inventory<CormAuth>(
            poster_character,
            corm_auth::auth(),
            offered_type_id,
            items_remaining,
            ctx,
        );
        source_ssu.deposit_to_owned<CormAuth>(
            poster_character,
            returned_item,
            corm_auth::auth(),
            ctx,
        );
    };

    // Return remaining escrow to poster
    if (escrow.value() > 0) {
        let coin = coin::from_balance(escrow, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        escrow.destroy_zero();
    };

    // Forfeit courier stake to poster
    if (courier_stake.value() > 0) {
        let coin = coin::from_balance(courier_stake, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        courier_stake.destroy_zero();
    };

    // Return fill pool to poster
    if (fill_pool.value() > 0) {
        let coin = coin::from_balance(fill_pool, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        fill_pool.destroy_zero();
    };

    event::emit(ContractExpiredEvent {
        contract_id,
        poster_id,
        escrow_returned,
        stake_forfeited,
        fill_pool_returned,
        items_returned: items_remaining,
    });

    fills.drop();
    id.delete();
}

// === Cleanup Functions ===

/// Garbage-collect a completed coin-only contract (CoinForCoin, CoinForItem, Transport).
/// Anyone can call this. The object is destroyed and storage rebate is returned.
public fun cleanup_completed_contract<CE, CF>(
    contract: Contract<CE, CF>,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Completed, EContractNotCompleted);
    assert!(
        !is_item_for_coin(&contract.contract_type) && !is_item_for_item(&contract.contract_type),
        EItemContractRequiresItemCancel,
    );

    let Contract {
        id,
        poster_address,
        escrow,
        fill_pool,
        courier_stake,
        fills,
        ..
    } = contract;

    // Return any dust balances to poster
    if (escrow.value() > 0) {
        let coin = coin::from_balance(escrow, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        escrow.destroy_zero();
    };
    if (fill_pool.value() > 0) {
        let coin = coin::from_balance(fill_pool, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        fill_pool.destroy_zero();
    };
    if (courier_stake.value() > 0) {
        let coin = coin::from_balance(courier_stake, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        courier_stake.destroy_zero();
    };

    fills.drop();
    id.delete();
}

/// Garbage-collect a completed item-bearing contract (ItemForCoin, ItemForItem).
/// All items should already have been released during fills; this is a safety
/// valve in case rounding dust remains.
public fun cleanup_completed_item_contract<CE, CF>(
    contract: Contract<CE, CF>,
    poster_character: &Character,
    source_ssu: &mut StorageUnit,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Completed, EContractNotCompleted);
    assert!(
        is_item_for_coin(&contract.contract_type) || is_item_for_item(&contract.contract_type),
        EWrongContractType,
    );

    let source_ssu_id = get_source_ssu_id(&contract.contract_type);
    assert!(object::id(source_ssu) == source_ssu_id, ESourceSsuMismatch);

    let (offered_type_id, offered_quantity) = get_offered_item_info(&contract.contract_type);
    let items_remaining = offered_quantity - contract.items_released;

    let Contract {
        id,
        poster_address,
        escrow,
        fill_pool,
        courier_stake,
        fills,
        ..
    } = contract;

    // Return any remaining items from open inventory to poster
    if (items_remaining > 0) {
        let returned_item = source_ssu.withdraw_from_open_inventory<CormAuth>(
            poster_character,
            corm_auth::auth(),
            offered_type_id,
            items_remaining,
            ctx,
        );
        source_ssu.deposit_to_owned<CormAuth>(
            poster_character,
            returned_item,
            corm_auth::auth(),
            ctx,
        );
    };

    // Return any dust balances to poster
    if (escrow.value() > 0) {
        let coin = coin::from_balance(escrow, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        escrow.destroy_zero();
    };
    if (fill_pool.value() > 0) {
        let coin = coin::from_balance(fill_pool, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        fill_pool.destroy_zero();
    };
    if (courier_stake.value() > 0) {
        let coin = coin::from_balance(courier_stake, ctx);
        transfer::public_transfer(coin, poster_address);
    } else {
        courier_stake.destroy_zero();
    };

    fills.drop();
    id.delete();
}

// === View Functions ===

public fun contract_poster_id<CE, CF>(c: &Contract<CE, CF>): ID { c.poster_id }
public fun contract_poster_address<CE, CF>(c: &Contract<CE, CF>): address { c.poster_address }
public fun contract_type<CE, CF>(c: &Contract<CE, CF>): ContractType { c.contract_type }
public fun contract_escrow_amount<CE, CF>(c: &Contract<CE, CF>): u64 { c.escrow_amount }
public fun contract_escrow_balance<CE, CF>(c: &Contract<CE, CF>): u64 { c.escrow.value() }
public fun contract_fill_pool_balance<CE, CF>(c: &Contract<CE, CF>): u64 { c.fill_pool.value() }
public fun contract_courier_stake_balance<CE, CF>(c: &Contract<CE, CF>): u64 { c.courier_stake.value() }
public fun contract_target_quantity<CE, CF>(c: &Contract<CE, CF>): u64 { c.target_quantity }
public fun contract_filled_quantity<CE, CF>(c: &Contract<CE, CF>): u64 { c.filled_quantity }
public fun contract_allow_partial<CE, CF>(c: &Contract<CE, CF>): bool { c.allow_partial }
public fun contract_require_stake<CE, CF>(c: &Contract<CE, CF>): bool { c.require_stake }
public fun contract_stake_amount<CE, CF>(c: &Contract<CE, CF>): u64 { c.stake_amount }
public fun contract_deadline_ms<CE, CF>(c: &Contract<CE, CF>): u64 { c.deadline_ms }
public fun contract_status<CE, CF>(c: &Contract<CE, CF>): ContractStatus { c.status }
public fun contract_courier_id<CE, CF>(c: &Contract<CE, CF>): Option<ID> { c.courier_id }
public fun contract_allowed_characters<CE, CF>(c: &Contract<CE, CF>): vector<ID> { c.allowed_characters }
public fun contract_allowed_tribes<CE, CF>(c: &Contract<CE, CF>): vector<u32> { c.allowed_tribes }
public fun contract_items_released<CE, CF>(c: &Contract<CE, CF>): u32 { c.items_released }

public fun filler_contribution<CE, CF>(c: &Contract<CE, CF>, filler_id: ID): u64 {
    if (c.fills.contains(filler_id)) {
        *c.fills.borrow(filler_id)
    } else {
        0
    }
}

// === Private Helpers ===

/// Verify that a filler is authorized to interact with this contract.
/// OR logic: authorized if both lists empty, or character in allowed_characters,
/// or character's in-game tribe in allowed_tribes.
fun verify_filler_access<CE, CF>(contract: &Contract<CE, CF>, character: &Character) {
    if (contract.allowed_characters.is_empty() && contract.allowed_tribes.is_empty()) {
        return
    };

    let character_id = character.id();
    let tribe_id = character.tribe();

    let mut authorized = false;

    // Check character allowlist
    let mut i = 0;
    while (i < contract.allowed_characters.length()) {
        if (contract.allowed_characters[i] == character_id) {
            authorized = true;
            break
        };
        i = i + 1;
    };

    // Check tribe allowlist
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

fun is_coin_for_coin(ct: &ContractType): bool {
    match (ct) {
        ContractType::CoinForCoin { .. } => true,
        _ => false,
    }
}

fun is_coin_for_item(ct: &ContractType): bool {
    match (ct) {
        ContractType::CoinForItem { .. } => true,
        _ => false,
    }
}

fun is_item_for_coin(ct: &ContractType): bool {
    match (ct) {
        ContractType::ItemForCoin { .. } => true,
        _ => false,
    }
}

fun is_item_for_item(ct: &ContractType): bool {
    match (ct) {
        ContractType::ItemForItem { .. } => true,
        _ => false,
    }
}

fun is_transport(ct: &ContractType): bool {
    match (ct) {
        ContractType::Transport { .. } => true,
        _ => false,
    }
}

fun get_wanted_type_id(ct: &ContractType): u64 {
    match (ct) {
        ContractType::CoinForItem { wanted_type_id, .. } => *wanted_type_id,
        ContractType::ItemForItem { wanted_type_id, .. } => *wanted_type_id,
        _ => abort EWrongContractType,
    }
}

fun get_offered_item_info(ct: &ContractType): (u64, u32) {
    match (ct) {
        ContractType::ItemForCoin { offered_type_id, offered_quantity, .. } => (*offered_type_id, *offered_quantity),
        ContractType::ItemForItem { offered_type_id, offered_quantity, .. } => (*offered_type_id, *offered_quantity),
        _ => abort EWrongContractType,
    }
}

fun get_transport_item_info(ct: &ContractType): (u64, u32) {
    match (ct) {
        ContractType::Transport { item_type_id, item_quantity, .. } => (*item_type_id, *item_quantity),
        _ => abort EWrongContractType,
    }
}

fun get_source_ssu_id(ct: &ContractType): ID {
    match (ct) {
        ContractType::ItemForCoin { source_ssu_id, .. } => *source_ssu_id,
        ContractType::ItemForItem { source_ssu_id, .. } => *source_ssu_id,
        _ => abort EWrongContractType,
    }
}

fun get_wanted_coin_amount(ct: &ContractType): u64 {
    match (ct) {
        ContractType::ItemForCoin { wanted_amount, .. } => *wanted_amount,
        _ => abort EWrongContractType,
    }
}

fun get_c4c_wanted_amount(ct: &ContractType): u64 {
    match (ct) {
        ContractType::CoinForCoin { wanted_amount, .. } => *wanted_amount,
        _ => abort EWrongContractType,
    }
}

fun has_item_escrow(ct: &ContractType): bool {
    is_item_for_coin(ct) || is_item_for_item(ct)
}

// === Test-only Helpers ===

#[test_only]
public fun destroy_contract_for_testing<CE, CF>(contract: Contract<CE, CF>) {
    let Contract { id, escrow, fill_pool, courier_stake, fills, .. } = contract;
    escrow.destroy_for_testing();
    fill_pool.destroy_for_testing();
    courier_stake.destroy_for_testing();
    fills.drop();
    id.delete();
}
