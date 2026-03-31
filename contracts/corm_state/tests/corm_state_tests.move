#[test_only]
module corm_state::corm_state_tests;

use sui::test_scenario::{Self as ts};
use corm_auth::corm_auth;
use corm_state::corm_state;
use corm_state::corm_coin;

const ADMIN: address = @0xAD;
const OTHER: address = @0xBB;
const BRAIN: address = @0xBE;
const PLAYER: address = @0xCC;

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
fun test_create_config() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        corm_state::create_config(&admin_cap, BRAIN, ctx);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Verify the CormConfig shared object was created with correct brain address
    scenario.next_tx(ADMIN);
    {
        let config = scenario.take_shared<corm_state::CormConfig>();
        assert!(corm_state::brain_address(&config) == BRAIN);
        ts::return_shared(config);
    };
    scenario.end();
}

#[test]
fun test_install_corm() {
    let mut scenario = ts::begin(ADMIN);
    {
        // Create config first
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        corm_state::create_config(&admin_cap, BRAIN, ctx);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Player installs a corm (permissionless)
    scenario.next_tx(PLAYER);
    {
        let config = scenario.take_shared<corm_state::CormConfig>();
        let network_node_id = object::id_from_address(@0x5678);
        corm_state::install(&config, network_node_id, scenario.ctx());
        ts::return_shared(config);
    };

    // Verify the CormState was created with brain as admin
    scenario.next_tx(BRAIN);
    {
        let state = scenario.take_shared<corm_state::CormState>();
        assert!(corm_state::phase(&state) == 0);
        assert!(corm_state::stability(&state) == 0);
        assert!(corm_state::corruption(&state) == 0);
        assert!(corm_state::admin(&state) == BRAIN);
        ts::return_shared(state);
    };

    // Verify the MintCap was transferred to the brain
    scenario.next_tx(BRAIN);
    {
        let mint_cap = scenario.take_from_address<corm_coin::MintCap>(BRAIN);
        assert!(corm_coin::mint_cap_total_minted(&mint_cap) == 0);
        ts::return_to_address(BRAIN, mint_cap);
    };
    scenario.end();
}

#[test]
fun test_set_brain_address() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        corm_state::create_config(&admin_cap, BRAIN, ctx);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Admin updates the brain address
    scenario.next_tx(ADMIN);
    {
        let mut config = scenario.take_shared<corm_state::CormConfig>();
        let admin_cap = corm_auth::create_admin_cap_for_testing(scenario.ctx());
        corm_state::set_brain_address(&mut config, &admin_cap, OTHER);
        assert!(corm_state::brain_address(&config) == OTHER);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
        ts::return_shared(config);
    };
    scenario.end();
}

#[test]
fun test_reset_state_allows_regression() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, ctx);
        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Advance to phase 2
    scenario.next_tx(ADMIN);
    {
        let mut state = scenario.take_shared<corm_state::CormState>();
        corm_state::update_state(&mut state, 2, 80, 30, scenario.ctx());
        assert!(corm_state::phase(&state) == 2);
        ts::return_shared(state);
    };

    // Reset back to phase 0 (regression) — should succeed
    scenario.next_tx(ADMIN);
    {
        let mut state = scenario.take_shared<corm_state::CormState>();
        corm_state::reset_state(&mut state, 0, 0, 0, scenario.ctx());
        assert!(corm_state::phase(&state) == 0);
        assert!(corm_state::stability(&state) == 0);
        assert!(corm_state::corruption(&state) == 0);
        ts::return_shared(state);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 0)] // ENotAdmin
fun test_reset_state_unauthorized() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, ctx);
        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // OTHER tries to reset — should fail
    scenario.next_tx(OTHER);
    {
        let mut state = scenario.take_shared<corm_state::CormState>();
        corm_state::reset_state(&mut state, 0, 0, 0, scenario.ctx());
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

#[test]
fun test_state_version_tracking() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, ctx);
        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Verify newly created objects have version 1
    scenario.next_tx(ADMIN);
    {
        let state = scenario.take_shared<corm_state::CormState>();
        assert!(corm_state::state_version(&state) == 1);
        ts::return_shared(state);
    };
    scenario.end();
}

#[test]
fun test_config_version_tracking() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        corm_state::create_config(&admin_cap, BRAIN, ctx);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Verify CormConfig has version 1
    scenario.next_tx(ADMIN);
    {
        let config = scenario.take_shared<corm_state::CormConfig>();
        assert!(corm_state::config_version(&config) == 1);
        ts::return_shared(config);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 4)] // EAlreadyMigrated
fun test_migrate_state_already_at_version() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, ctx);
        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Trying to migrate when already at current version should fail
    scenario.next_tx(ADMIN);
    {
        let mut state = scenario.take_shared<corm_state::CormState>();
        let admin_cap = corm_auth::create_admin_cap_for_testing(scenario.ctx());
        corm_state::migrate_state(&mut state, &admin_cap);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
        ts::return_shared(state);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 4)] // EAlreadyMigrated
fun test_migrate_config_already_at_version() {
    let mut scenario = ts::begin(ADMIN);
    {
        let ctx = scenario.ctx();
        let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
        corm_state::create_config(&admin_cap, BRAIN, ctx);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    scenario.next_tx(ADMIN);
    {
        let mut config = scenario.take_shared<corm_state::CormConfig>();
        let admin_cap = corm_auth::create_admin_cap_for_testing(scenario.ctx());
        corm_state::migrate_config(&mut config, &admin_cap);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
        ts::return_shared(config);
    };
    scenario.end();
}
