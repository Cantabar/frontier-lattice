#[test_only]
module corm_state::corm_state_tests;

use sui::test_scenario::{Self as ts};
use corm_auth::corm_auth;
use corm_state::corm_state;
use corm_state::corm_coin;

const ADMIN: address = @0xAD;
const OTHER: address = @0xBB;

#[test]
fun test_create_corm_state() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, ctx);

        // MintCap starts with zero minted
        assert!(corm_coin::mint_cap_total_minted(&mint_cap) == 0);

        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Verify the CormState shared object was created
    scenario.next_tx(ADMIN);
    {
        let state = scenario.take_shared<corm_state::CormState>();
        assert!(corm_state::phase(&state) == 0);
        assert!(corm_state::stability(&state) == 0);
        assert!(corm_state::corruption(&state) == 0);
        ts::return_shared(state);
    };
    scenario.end();
}

#[test]
fun test_create_and_update() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, ctx);
        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Next transaction: update the shared CormState
    scenario.next_tx(ADMIN);
    {
        let mut state = scenario.take_shared<corm_state::CormState>();
        assert!(corm_state::phase(&state) == 0);
        assert!(corm_state::stability(&state) == 0);
        assert!(corm_state::corruption(&state) == 0);
        assert!(corm_state::admin(&state) == ADMIN);

        corm_state::update_state(&mut state, 1, 50, 25, scenario.ctx());

        assert!(corm_state::phase(&state) == 1);
        assert!(corm_state::stability(&state) == 50);
        assert!(corm_state::corruption(&state) == 25);

        ts::return_shared(state);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 0)] // ENotAdmin
fun test_update_unauthorized() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, ctx);
        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // OTHER tries to update — should fail
    scenario.next_tx(OTHER);
    {
        let mut state = scenario.take_shared<corm_state::CormState>();
        corm_state::update_state(&mut state, 1, 50, 25, scenario.ctx());
        ts::return_shared(state);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 1)] // EPhaseRegression
fun test_phase_regression_fails() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, ctx);
        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    scenario.next_tx(ADMIN);
    {
        let mut state = scenario.take_shared<corm_state::CormState>();
        // Advance to phase 2
        corm_state::update_state(&mut state, 2, 50, 10, scenario.ctx());
        ts::return_shared(state);
    };

    scenario.next_tx(ADMIN);
    {
        let mut state = scenario.take_shared<corm_state::CormState>();
        // Try to regress to phase 1 — should abort
        corm_state::update_state(&mut state, 1, 50, 10, scenario.ctx());
        ts::return_shared(state);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 2)] // EMeterOutOfRange
fun test_stability_out_of_range() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, ctx);
        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    scenario.next_tx(ADMIN);
    {
        let mut state = scenario.take_shared<corm_state::CormState>();
        corm_state::update_state(&mut state, 0, 101, 0, scenario.ctx());
        ts::return_shared(state);
    };
    scenario.end();
}

#[test]
fun test_transfer_admin() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, ctx);
        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Transfer admin to OTHER
    scenario.next_tx(ADMIN);
    {
        let mut state = scenario.take_shared<corm_state::CormState>();
        corm_state::transfer_admin(&mut state, OTHER, scenario.ctx());
        assert!(corm_state::admin(&state) == OTHER);
        ts::return_shared(state);
    };

    // OTHER can now update
    scenario.next_tx(OTHER);
    {
        let mut state = scenario.take_shared<corm_state::CormState>();
        corm_state::update_state(&mut state, 1, 80, 10, scenario.ctx());
        assert!(corm_state::phase(&state) == 1);
        ts::return_shared(state);
    };
    scenario.end();
}
