/// Forge Planner — on-chain recipe registry and manufacturing order system.
///
/// `RecipeRegistry<C>` is a shared object holding the tribe's recipe catalog.
/// Each recipe maps an output item (`type_id`, `quantity`) to its required
/// input materials. Tribe leaders/officers manage the registry.
///
/// `ManufacturingOrder<C>` is a shared object representing an active production
/// job. It holds escrowed tokens (bounty for fulfillment) and tracks resource
/// allocation status. Orders are deleted on completion or cancellation —
/// history lives exclusively in events.
///
/// Integration with Contract Board (Phase 2): the off-chain optimizer reads
/// recipes and inventory, then auto-generates `CompletionType::Delivery` jobs
/// on the Contract Board for missing resources. On-chain, the Forge Planner
/// only needs to know which recipe to use and track the order lifecycle.
///
/// Design principles (same as Phase 1/2):
/// - Generic over coin type C (phantom): deploy with C = EVE for EVE Frontier.
/// - Objects as live state, events as history. Orders deleted on terminal state.
/// - Per-tribe scoping: each tribe has its own recipe registry and orders.
/// - Admin-managed recipes via TribeCap (Leader/Officer).
module forge_planner::forge_planner;

use std::string::String;
use sui::{
    balance::Balance,
    coin::{Self, Coin},
    event,
    table::{Self, Table},
};
use world::character::Character;
use tribe::tribe::{Self, Tribe, TribeCap};

// === Errors ===
const ENotAuthorized: u64 = 0;
const ERecipeAlreadyExists: u64 = 1;
const ERecipeNotFound: u64 = 2;
const EEmptyInputs: u64 = 3;
const EZeroQuantity: u64 = 4;
const EOrderNotActive: u64 = 5;
const ENotOrderCreator: u64 = 6;
const ETribeMismatch: u64 = 7;
#[allow(unused_const)]
const EInsufficientEscrow: u64 = 8;
const ENotTribeMember: u64 = 9;
const EDescriptionEmpty: u64 = 10;
const ECharacterMismatch: u64 = 11;
const ERegistryMismatch: u64 = 12;

// === Structs ===

/// A single input material requirement for a recipe.
public struct InputRequirement has copy, drop, store {
    type_id: u64,
    quantity: u32,
}

/// A crafting recipe: output item and its required inputs.
/// Stored inside the RecipeRegistry's table, keyed by output type_id.
public struct Recipe has copy, drop, store {
    output_type_id: u64,
    output_quantity: u32,
    inputs: vector<InputRequirement>,
    /// Run time in abstract time units (matches EVE Frontier blueprint data).
    run_time: u64,
}

/// Shared per-tribe recipe catalog.
/// Maps output `type_id` → `Recipe` (inputs, quantities, run_time).
/// Only tribe Leaders/Officers can add or remove recipes.
public struct RecipeRegistry<phantom C> has key {
    id: UID,
    tribe_id: ID,
    /// output type_id → Recipe
    recipes: Table<u64, Recipe>,
    recipe_count: u64,
}

/// Status of a manufacturing order. Only Active exists on-chain.
/// Terminal states are recorded as events and the object is deleted.
public enum OrderStatus has copy, drop, store {
    Active,
    Fulfilled,
    Cancelled,
}

/// An active manufacturing order. Shared object — one per order.
/// Holds an optional bounty (escrowed tokens) released on fulfillment.
/// Deleted when the order reaches a terminal state (reclaims storage rebate).
public struct ManufacturingOrder<phantom C> has key {
    id: UID,
    tribe_id: ID,
    registry_id: ID,
    creator_id: ID,
    creator_address: address,
    description: String,
    /// What we're building
    output_type_id: u64,
    output_quantity: u32,
    /// How many runs of the recipe
    run_count: u64,
    /// Snapshot of required inputs (from recipe × run_count)
    required_inputs: vector<InputRequirement>,
    /// Bounty for whoever fulfills the order
    bounty: Balance<C>,
    bounty_amount: u64,
    status: OrderStatus,
}

// === Events ===

public struct RecipeRegistryCreatedEvent has copy, drop {
    registry_id: ID,
    tribe_id: ID,
}

public struct RecipeAddedEvent has copy, drop {
    registry_id: ID,
    tribe_id: ID,
    output_type_id: u64,
    output_quantity: u32,
    input_count: u64,
    run_time: u64,
}

public struct RecipeRemovedEvent has copy, drop {
    registry_id: ID,
    tribe_id: ID,
    output_type_id: u64,
}

public struct OrderCreatedEvent has copy, drop {
    order_id: ID,
    tribe_id: ID,
    creator_id: ID,
    output_type_id: u64,
    output_quantity: u32,
    run_count: u64,
    bounty_amount: u64,
}

public struct OrderFulfilledEvent has copy, drop {
    order_id: ID,
    tribe_id: ID,
    creator_id: ID,
    fulfiller_id: ID,
    output_type_id: u64,
    output_quantity: u32,
    bounty_amount: u64,
}

public struct OrderCancelledEvent has copy, drop {
    order_id: ID,
    tribe_id: ID,
    creator_id: ID,
    output_type_id: u64,
    bounty_amount: u64,
}

// === InputRequirement Constructor ===
// Struct fields in Move 2024.beta cannot be constructed outside their
// defining module, so we expose public constructor functions.

public fun new_input_requirement(type_id: u64, quantity: u32): InputRequirement {
    InputRequirement { type_id, quantity }
}

// === OrderStatus Constructors ===

public fun status_active(): OrderStatus { OrderStatus::Active }
public fun status_fulfilled(): OrderStatus { OrderStatus::Fulfilled }
public fun status_cancelled(): OrderStatus { OrderStatus::Cancelled }

// === Public Functions: RecipeRegistry ===

/// Creates a new recipe registry for a tribe. Requires Leader/Officer TribeCap.
/// Each tribe should have one registry (not enforced — multiple are possible
/// for advanced use cases like guild specialization).
public fun create_registry<C>(
    tribe: &Tribe<C>,
    cap: &TribeCap,
    ctx: &mut TxContext,
) {
    let tribe_id = object::id(tribe);
    assert!(tribe::tribe_id(cap) == tribe_id, ETribeMismatch);
    assert!(tribe::is_member(tribe, tribe::cap_character_id(cap)), ENotTribeMember);
    assert!(is_leader_or_officer(cap), ENotAuthorized);

    let registry = RecipeRegistry<C> {
        id: object::new(ctx),
        tribe_id,
        recipes: table::new(ctx),
        recipe_count: 0,
    };

    let registry_id = object::id(&registry);
    event::emit(RecipeRegistryCreatedEvent { registry_id, tribe_id });

    transfer::share_object(registry);
}

/// Adds a recipe to the registry. Requires Leader/Officer TribeCap.
/// Only one recipe per output type_id is allowed (remove first to update).
public fun add_recipe<C>(
    registry: &mut RecipeRegistry<C>,
    tribe: &Tribe<C>,
    cap: &TribeCap,
    output_type_id: u64,
    output_quantity: u32,
    inputs: vector<InputRequirement>,
    run_time: u64,
) {
    let tribe_id = object::id(tribe);
    assert!(tribe::tribe_id(cap) == tribe_id, ETribeMismatch);
    assert!(registry.tribe_id == tribe_id, ERegistryMismatch);
    assert!(tribe::is_member(tribe, tribe::cap_character_id(cap)), ENotTribeMember);
    assert!(is_leader_or_officer(cap), ENotAuthorized);
    assert!(!registry.recipes.contains(output_type_id), ERecipeAlreadyExists);
    assert!(inputs.length() > 0, EEmptyInputs);
    assert!(output_quantity > 0, EZeroQuantity);

    let recipe = Recipe {
        output_type_id,
        output_quantity,
        inputs,
        run_time,
    };

    registry.recipes.add(output_type_id, recipe);
    registry.recipe_count = registry.recipe_count + 1;

    event::emit(RecipeAddedEvent {
        registry_id: object::id(registry),
        tribe_id,
        output_type_id,
        output_quantity,
        input_count: recipe.inputs.length(),
        run_time,
    });
}

/// Removes a recipe from the registry. Requires Leader/Officer TribeCap.
public fun remove_recipe<C>(
    registry: &mut RecipeRegistry<C>,
    tribe: &Tribe<C>,
    cap: &TribeCap,
    output_type_id: u64,
) {
    let tribe_id = object::id(tribe);
    assert!(tribe::tribe_id(cap) == tribe_id, ETribeMismatch);
    assert!(registry.tribe_id == tribe_id, ERegistryMismatch);
    assert!(tribe::is_member(tribe, tribe::cap_character_id(cap)), ENotTribeMember);
    assert!(is_leader_or_officer(cap), ENotAuthorized);
    assert!(registry.recipes.contains(output_type_id), ERecipeNotFound);

    registry.recipes.remove(output_type_id);
    registry.recipe_count = registry.recipe_count - 1;

    event::emit(RecipeRemovedEvent {
        registry_id: object::id(registry),
        tribe_id,
        output_type_id,
    });
}

// === Public Functions: ManufacturingOrder ===

/// Creates a manufacturing order. The creator locks tokens as bounty.
/// Resolves the recipe from the registry and snapshots the required inputs
/// (scaled by `run_count`).
///
/// Requires a valid TribeCap matching the creator's Character.
/// The order is scoped to the tribe that owns the registry.
public fun create_order<C>(
    registry: &RecipeRegistry<C>,
    tribe: &Tribe<C>,
    cap: &TribeCap,
    character: &Character,
    description: String,
    output_type_id: u64,
    run_count: u64,
    bounty_coin: Coin<C>,
    ctx: &mut TxContext,
) {
    let tribe_id = object::id(tribe);
    let creator_id = tribe::cap_character_id(cap);
    assert!(tribe::tribe_id(cap) == tribe_id, ETribeMismatch);
    assert!(registry.tribe_id == tribe_id, ERegistryMismatch);
    assert!(tribe::is_member(tribe, creator_id), ENotTribeMember);
    assert!(character.id() == creator_id, ECharacterMismatch);
    assert!(description.length() > 0, EDescriptionEmpty);
    assert!(registry.recipes.contains(output_type_id), ERecipeNotFound);
    assert!(run_count > 0, EZeroQuantity);

    let recipe = registry.recipes.borrow(output_type_id);

    // Scale inputs by run_count
    let mut required_inputs = vector::empty<InputRequirement>();
    let mut i = 0;
    while (i < recipe.inputs.length()) {
        let input = &recipe.inputs[i];
        required_inputs.push_back(InputRequirement {
            type_id: input.type_id,
            quantity: ((input.quantity as u64) * run_count as u32),
        });
        i = i + 1;
    };

    let bounty_amount = bounty_coin.value();
    let creator_address = character.character_address();

    let order = ManufacturingOrder<C> {
        id: object::new(ctx),
        tribe_id,
        registry_id: object::id(registry),
        creator_id,
        creator_address,
        description,
        output_type_id,
        output_quantity: ((recipe.output_quantity as u64) * run_count as u32),
        run_count,
        required_inputs,
        bounty: bounty_coin.into_balance(),
        bounty_amount,
        status: OrderStatus::Active,
    };

    let order_id = object::id(&order);
    event::emit(OrderCreatedEvent {
        order_id,
        tribe_id,
        creator_id,
        output_type_id,
        output_quantity: order.output_quantity,
        run_count,
        bounty_amount,
    });

    transfer::share_object(order);
}

/// Creator confirms the order has been fulfilled. Releases bounty to the
/// fulfiller and deletes the order object (reclaims storage rebate).
/// The fulfiller is identified by their Character object.
public fun fulfill_order<C>(
    order: ManufacturingOrder<C>,
    creator_cap: &TribeCap,
    fulfiller_character: &Character,
    ctx: &mut TxContext,
) {
    assert!(order.status == OrderStatus::Active, EOrderNotActive);
    assert!(tribe::cap_character_id(creator_cap) == order.creator_id, ENotOrderCreator);

    let order_id = object::id(&order);
    let fulfiller_id = fulfiller_character.id();
    let fulfiller_addr = fulfiller_character.character_address();

    let ManufacturingOrder {
        id,
        tribe_id,
        creator_id,
        output_type_id,
        output_quantity,
        bounty,
        bounty_amount,
        ..
    } = order;

    let coin = coin::from_balance(bounty, ctx);
    transfer::public_transfer(coin, fulfiller_addr);

    event::emit(OrderFulfilledEvent {
        order_id,
        tribe_id,
        creator_id,
        fulfiller_id,
        output_type_id,
        output_quantity,
        bounty_amount,
    });

    id.delete();
}

/// Cancel an active manufacturing order. Returns bounty to the creator.
/// Only the creator can cancel.
public fun cancel_order<C>(
    order: ManufacturingOrder<C>,
    cap: &TribeCap,
    ctx: &mut TxContext,
) {
    assert!(order.status == OrderStatus::Active, EOrderNotActive);
    assert!(tribe::cap_character_id(cap) == order.creator_id, ENotOrderCreator);

    let order_id = object::id(&order);

    let ManufacturingOrder {
        id,
        tribe_id,
        creator_id,
        creator_address,
        output_type_id,
        bounty,
        bounty_amount,
        ..
    } = order;

    let coin = coin::from_balance(bounty, ctx);
    transfer::public_transfer(coin, creator_address);

    event::emit(OrderCancelledEvent {
        order_id,
        tribe_id,
        creator_id,
        output_type_id,
        bounty_amount,
    });

    id.delete();
}

// === View Functions: RecipeRegistry ===

public fun registry_tribe_id<C>(registry: &RecipeRegistry<C>): ID { registry.tribe_id }
public fun registry_recipe_count<C>(registry: &RecipeRegistry<C>): u64 { registry.recipe_count }

public fun has_recipe<C>(registry: &RecipeRegistry<C>, output_type_id: u64): bool {
    registry.recipes.contains(output_type_id)
}

public fun recipe_output_quantity<C>(registry: &RecipeRegistry<C>, output_type_id: u64): u32 {
    assert!(registry.recipes.contains(output_type_id), ERecipeNotFound);
    registry.recipes.borrow(output_type_id).output_quantity
}

public fun recipe_run_time<C>(registry: &RecipeRegistry<C>, output_type_id: u64): u64 {
    assert!(registry.recipes.contains(output_type_id), ERecipeNotFound);
    registry.recipes.borrow(output_type_id).run_time
}

public fun recipe_input_count<C>(registry: &RecipeRegistry<C>, output_type_id: u64): u64 {
    assert!(registry.recipes.contains(output_type_id), ERecipeNotFound);
    registry.recipes.borrow(output_type_id).inputs.length()
}

// === View Functions: InputRequirement ===

public fun input_type_id(input: &InputRequirement): u64 { input.type_id }
public fun input_quantity(input: &InputRequirement): u32 { input.quantity }

// === View Functions: ManufacturingOrder ===

public fun order_tribe_id<C>(order: &ManufacturingOrder<C>): ID { order.tribe_id }
public fun order_creator_id<C>(order: &ManufacturingOrder<C>): ID { order.creator_id }
public fun order_output_type_id<C>(order: &ManufacturingOrder<C>): u64 { order.output_type_id }
public fun order_output_quantity<C>(order: &ManufacturingOrder<C>): u32 { order.output_quantity }
public fun order_run_count<C>(order: &ManufacturingOrder<C>): u64 { order.run_count }
public fun order_bounty_amount<C>(order: &ManufacturingOrder<C>): u64 { order.bounty_amount }
public fun order_status<C>(order: &ManufacturingOrder<C>): OrderStatus { order.status }
public fun order_required_inputs<C>(order: &ManufacturingOrder<C>): vector<InputRequirement> { order.required_inputs }

// === Private Helpers ===

fun is_leader_or_officer(cap: &TribeCap): bool {
    tribe::cap_role(cap) == tribe::role_leader() || tribe::cap_role(cap) == tribe::role_officer()
}

// === Test-only Helpers ===

#[test_only]
public fun destroy_order_for_testing<C>(order: ManufacturingOrder<C>) {
    let ManufacturingOrder { id, bounty, .. } = order;
    bounty.destroy_for_testing();
    id.delete();
}

#[test_only]
public fun destroy_registry_for_testing<C>(registry: RecipeRegistry<C>) {
    let RecipeRegistry { id, recipes, .. } = registry;
    recipes.drop();
    id.delete();
}
