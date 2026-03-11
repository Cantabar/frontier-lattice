#[test_only]
module forge_planner::forge_planner_tests;

use std::string::utf8;
use sui::{
    coin,
    test_scenario as ts,
};
use world::{
    access::AdminACL,
    character::{Self, Character},
    object_registry::ObjectRegistry,
    test_helpers::{Self, admin, tenant, user_a, user_b},
};
use tribe::tribe::{Self, Tribe, TribeCap};
use forge_planner::forge_planner::{
    Self,
    RecipeRegistry,
    ManufacturingOrder,
};

// === Test coin — stand-in for EVE in unit tests ===
#[test_only]
public struct TESTCOIN has drop {}

// === Constants ===
const LEADER_GAME_ID: u32 = 2001;
const MEMBER_GAME_ID: u32 = 2002;
const VOTE_THRESHOLD_51: u64 = 51;
const TRIBE_NAME: vector<u8> = b"Forge Masters";
const BOUNTY_AMOUNT: u64 = 500;

// Recipe test data (modelled on EVE Frontier blueprint 1002:
//   3× type 89258 + 5× type 89259 → 1× type 84180, runTime 3)
const OUTPUT_TYPE_ID: u64 = 84180;
const OUTPUT_QUANTITY: u32 = 1;
const INPUT_A_TYPE: u64 = 89258;
const INPUT_A_QTY: u32 = 3;
const INPUT_B_TYPE: u64 = 89259;
const INPUT_B_QTY: u32 = 5;
const RUN_TIME: u64 = 3;

// === Helpers ===

/// Sets up the world, creates two characters, a tribe, and adds member.
/// Returns (leader_char_id, member_char_id).
fun setup_world_and_characters(ts: &mut ts::Scenario): (ID, ID) {
    test_helpers::setup_world(ts);

    // Create leader character
    ts::next_tx(ts, admin());
    let leader_id = {
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let char = character::create_character(
            &mut registry,
            &admin_acl,
            LEADER_GAME_ID,
            tenant(),
            100,
            user_a(),
            utf8(b"Forgemaster"),
            ts::ctx(ts),
        );
        let id = object::id(&char);
        character::share_character(char, &admin_acl, ts::ctx(ts));
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        id
    };

    // Create member character
    ts::next_tx(ts, admin());
    let member_id = {
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let char = character::create_character(
            &mut registry,
            &admin_acl,
            MEMBER_GAME_ID,
            tenant(),
            100,
            user_b(),
            utf8(b"Apprentice"),
            ts::ctx(ts),
        );
        let id = object::id(&char);
        character::share_character(char, &admin_acl, ts::ctx(ts));
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        id
    };

    (leader_id, member_id)
}

/// Creates a tribe and adds the member. Returns after both caps are transferred.
fun setup_tribe_with_member(ts: &mut ts::Scenario, leader_id: ID, member_id: ID) {
    // Create tribe
    ts::next_tx(ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(ts, leader_id);
        let cap = tribe::create_tribe<TESTCOIN>(
            &leader,
            utf8(TRIBE_NAME),
            VOTE_THRESHOLD_51,
            ts::ctx(ts),
        );
        transfer::public_transfer(cap, user_a());
        ts::return_shared(leader);
    };

    // Add member
    ts::next_tx(ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(ts);
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(ts);
        let member = ts::take_shared_by_id<Character>(ts, member_id);
        let member_cap = tribe::add_member(
            &mut tribe,
            &leader_cap,
            &member,
            tribe::role_member(),
            ts::ctx(ts),
        );
        transfer::public_transfer(member_cap, user_b());
        ts::return_to_sender(ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };
}

/// Creates a recipe registry for the tribe.
fun setup_registry(ts: &mut ts::Scenario) {
    ts::next_tx(ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(ts);
        forge_planner::create_registry<TESTCOIN>(&tribe, &leader_cap, ts::ctx(ts));
        ts::return_to_sender(ts, leader_cap);
        ts::return_shared(tribe);
    };
}

/// Builds the standard test inputs vector.
fun test_inputs(): vector<forge_planner::InputRequirement> {
    let mut inputs = vector::empty();
    inputs.push_back(forge_planner::new_input_requirement(INPUT_A_TYPE, INPUT_A_QTY));
    inputs.push_back(forge_planner::new_input_requirement(INPUT_B_TYPE, INPUT_B_QTY));
    inputs
}

// === Tests: RecipeRegistry ===

#[test]
fun create_registry_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);
    setup_registry(&mut ts);

    // Verify registry was shared with correct fields
    ts::next_tx(&mut ts, user_a());
    {
        let registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        assert!(forge_planner::registry_tribe_id(&registry) == object::id(&tribe));
        assert!(forge_planner::registry_recipe_count(&registry) == 0);
        ts::return_shared(registry);
        ts::return_shared(tribe);
    };

    ts::end(ts);
}

#[test]
fun add_recipe_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);
    setup_registry(&mut ts);

    // Add recipe
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);

        forge_planner::add_recipe(
            &mut registry, &tribe, &leader_cap,
            OUTPUT_TYPE_ID, OUTPUT_QUANTITY, test_inputs(), RUN_TIME,
        );

        assert!(forge_planner::registry_recipe_count(&registry) == 1);
        assert!(forge_planner::has_recipe(&registry, OUTPUT_TYPE_ID));
        assert!(forge_planner::recipe_output_quantity(&registry, OUTPUT_TYPE_ID) == OUTPUT_QUANTITY);
        assert!(forge_planner::recipe_run_time(&registry, OUTPUT_TYPE_ID) == RUN_TIME);
        assert!(forge_planner::recipe_input_count(&registry, OUTPUT_TYPE_ID) == 2);

        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 1)] // ERecipeAlreadyExists
fun add_duplicate_recipe_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);
    setup_registry(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);

        forge_planner::add_recipe(
            &mut registry, &tribe, &leader_cap,
            OUTPUT_TYPE_ID, OUTPUT_QUANTITY, test_inputs(), RUN_TIME,
        );

        // Try to add same recipe again — should fail
        forge_planner::add_recipe(
            &mut registry, &tribe, &leader_cap,
            OUTPUT_TYPE_ID, OUTPUT_QUANTITY, test_inputs(), RUN_TIME,
        );

        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 0)] // ENotAuthorized
fun add_recipe_as_member_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);
    setup_registry(&mut ts);

    // Member (user_b) tries to add recipe
    ts::next_tx(&mut ts, user_b());
    {
        let member_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);

        forge_planner::add_recipe(
            &mut registry, &tribe, &member_cap,
            OUTPUT_TYPE_ID, OUTPUT_QUANTITY, test_inputs(), RUN_TIME,
        );

        ts::return_to_sender(&ts, member_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
    };

    ts::end(ts);
}

#[test]
fun remove_recipe_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);
    setup_registry(&mut ts);

    // Add then remove recipe
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);

        forge_planner::add_recipe(
            &mut registry, &tribe, &leader_cap,
            OUTPUT_TYPE_ID, OUTPUT_QUANTITY, test_inputs(), RUN_TIME,
        );
        assert!(forge_planner::registry_recipe_count(&registry) == 1);

        forge_planner::remove_recipe(&mut registry, &tribe, &leader_cap, OUTPUT_TYPE_ID);
        assert!(forge_planner::registry_recipe_count(&registry) == 0);
        assert!(!forge_planner::has_recipe(&registry, OUTPUT_TYPE_ID));

        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
    };

    ts::end(ts);
}

// === Tests: ManufacturingOrder ===

#[test]
fun create_order_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);
    setup_registry(&mut ts);

    // Add recipe
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);
        forge_planner::add_recipe(
            &mut registry, &tribe, &leader_cap,
            OUTPUT_TYPE_ID, OUTPUT_QUANTITY, test_inputs(), RUN_TIME,
        );
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
    };

    // Create order (2 runs)
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let bounty = coin::mint_for_testing<TESTCOIN>(BOUNTY_AMOUNT, ts::ctx(&mut ts));

        forge_planner::create_order(
            &registry, &tribe, &leader_cap, &leader,
            utf8(b"Build 2 Tritanium Bars"),
            OUTPUT_TYPE_ID,
            2, // 2 runs
            bounty,
            ts::ctx(&mut ts),
        );

        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
        ts::return_shared(leader);
    };

    // Verify order fields
    ts::next_tx(&mut ts, user_a());
    {
        let order = ts::take_shared<ManufacturingOrder<TESTCOIN>>(&ts);
        assert!(forge_planner::order_creator_id(&order) == leader_id);
        assert!(forge_planner::order_output_type_id(&order) == OUTPUT_TYPE_ID);
        // 2 runs × 1 output_quantity = 2
        assert!(forge_planner::order_output_quantity(&order) == 2);
        assert!(forge_planner::order_run_count(&order) == 2);
        assert!(forge_planner::order_bounty_amount(&order) == BOUNTY_AMOUNT);
        assert!(forge_planner::order_status(&order) == forge_planner::status_active());

        // Verify scaled inputs: 2 runs × (3, 5) = (6, 10)
        let inputs = forge_planner::order_required_inputs(&order);
        assert!(inputs.length() == 2);
        assert!(forge_planner::input_type_id(&inputs[0]) == INPUT_A_TYPE);
        assert!(forge_planner::input_quantity(&inputs[0]) == 6); // 3 × 2
        assert!(forge_planner::input_type_id(&inputs[1]) == INPUT_B_TYPE);
        assert!(forge_planner::input_quantity(&inputs[1]) == 10); // 5 × 2

        ts::return_shared(order);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 2)] // ERecipeNotFound
fun create_order_missing_recipe_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);
    setup_registry(&mut ts);

    // Create order without adding recipe first
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let bounty = coin::mint_for_testing<TESTCOIN>(BOUNTY_AMOUNT, ts::ctx(&mut ts));

        forge_planner::create_order(
            &registry, &tribe, &leader_cap, &leader,
            utf8(b"Build something"),
            99999, // non-existent recipe
            1,
            bounty,
            ts::ctx(&mut ts),
        );

        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
        ts::return_shared(leader);
    };

    ts::end(ts);
}

#[test]
fun fulfill_order_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);
    setup_registry(&mut ts);

    // Add recipe
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);
        forge_planner::add_recipe(
            &mut registry, &tribe, &leader_cap,
            OUTPUT_TYPE_ID, OUTPUT_QUANTITY, test_inputs(), RUN_TIME,
        );
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
    };

    // Create order
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let bounty = coin::mint_for_testing<TESTCOIN>(BOUNTY_AMOUNT, ts::ctx(&mut ts));

        forge_planner::create_order(
            &registry, &tribe, &leader_cap, &leader,
            utf8(b"Build 1 Tritanium Bar"),
            OUTPUT_TYPE_ID, 1, bounty, ts::ctx(&mut ts),
        );

        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
        ts::return_shared(leader);
    };

    // Creator fulfills order, bounty goes to member (fulfiller)
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let order = ts::take_shared<ManufacturingOrder<TESTCOIN>>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);

        forge_planner::fulfill_order(order, &leader_cap, &member, ts::ctx(&mut ts));

        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(member);
    };

    // Verify bounty transferred to fulfiller (user_b)
    ts::next_tx(&mut ts, user_b());
    {
        let coin = ts::take_from_sender<coin::Coin<TESTCOIN>>(&ts);
        assert!(coin.value() == BOUNTY_AMOUNT);
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

#[test]
fun cancel_order_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);
    setup_registry(&mut ts);

    // Add recipe
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);
        forge_planner::add_recipe(
            &mut registry, &tribe, &leader_cap,
            OUTPUT_TYPE_ID, OUTPUT_QUANTITY, test_inputs(), RUN_TIME,
        );
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
    };

    // Create order
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let bounty = coin::mint_for_testing<TESTCOIN>(BOUNTY_AMOUNT, ts::ctx(&mut ts));

        forge_planner::create_order(
            &registry, &tribe, &leader_cap, &leader,
            utf8(b"Build 1 Tritanium Bar"),
            OUTPUT_TYPE_ID, 1, bounty, ts::ctx(&mut ts),
        );

        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
        ts::return_shared(leader);
    };

    // Cancel order — bounty returned to creator
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let order = ts::take_shared<ManufacturingOrder<TESTCOIN>>(&ts);

        forge_planner::cancel_order(order, &leader_cap, ts::ctx(&mut ts));

        ts::return_to_sender(&ts, leader_cap);
    };

    // Verify bounty returned to creator (user_a)
    ts::next_tx(&mut ts, user_a());
    {
        let coin = ts::take_from_sender<coin::Coin<TESTCOIN>>(&ts);
        assert!(coin.value() == BOUNTY_AMOUNT);
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 6)] // ENotOrderCreator
fun cancel_order_non_creator_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);
    setup_registry(&mut ts);

    // Add recipe
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);
        forge_planner::add_recipe(
            &mut registry, &tribe, &leader_cap,
            OUTPUT_TYPE_ID, OUTPUT_QUANTITY, test_inputs(), RUN_TIME,
        );
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
    };

    // Create order as leader
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let registry = ts::take_shared<RecipeRegistry<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let bounty = coin::mint_for_testing<TESTCOIN>(BOUNTY_AMOUNT, ts::ctx(&mut ts));

        forge_planner::create_order(
            &registry, &tribe, &leader_cap, &leader,
            utf8(b"Build 1 Tritanium Bar"),
            OUTPUT_TYPE_ID, 1, bounty, ts::ctx(&mut ts),
        );

        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(registry);
        ts::return_shared(leader);
    };

    // Member tries to cancel — should fail
    ts::next_tx(&mut ts, user_b());
    {
        let member_cap = ts::take_from_sender<TribeCap>(&ts);
        let order = ts::take_shared<ManufacturingOrder<TESTCOIN>>(&ts);

        forge_planner::cancel_order(order, &member_cap, ts::ctx(&mut ts));

        ts::return_to_sender(&ts, member_cap);
    };

    ts::end(ts);
}
