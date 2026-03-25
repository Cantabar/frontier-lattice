#[test_only]
module corm_state::corm_coin_tests;

use sui::test_scenario::{Self as ts};
use sui::coin::Coin;
use corm_auth::corm_auth;
use corm_state::corm_state;
use corm_state::corm_coin::{Self, CoinAuthority, MintCap, CORM_COIN};

const ADMIN: address = @0xAD;
const PLAYER: address = @0xCC;

#[test]
fun test_mint_corm() {
    let mut scenario = ts::begin(ADMIN);

    // Init the CORM coin module
    {
        corm_coin::init_for_testing(scenario.ctx());
    };

    // Create a CormState (which produces a MintCap)
    scenario.next_tx(ADMIN);
    {
        let admin_cap = corm_auth::create_admin_cap_for_testing(scenario.ctx());
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, scenario.ctx());
        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Mint CORM to PLAYER
    scenario.next_tx(ADMIN);
    {
        let mut authority = scenario.take_shared<CoinAuthority>();
        let mut mint_cap = scenario.take_from_sender<MintCap>();
        let state = scenario.take_shared<corm_state::CormState>();
        let corm_state_id = object::id(&state);

        corm_coin::mint(
            &mut authority,
            &mut mint_cap,
            corm_state_id,
            100,
            PLAYER,
            scenario.ctx(),
        );

        assert!(corm_coin::mint_cap_total_minted(&mint_cap) == 100);

        ts::return_shared(authority);
        ts::return_shared(state);
        scenario.return_to_sender(mint_cap);
    };

    // Verify PLAYER received the coins
    scenario.next_tx(PLAYER);
    {
        let coin = scenario.take_from_sender<Coin<CORM_COIN>>();
        assert!(coin.value() == 100);
        scenario.return_to_sender(coin);
    };

    scenario.end();
}

#[test]
fun test_mint_multiple_accumulates() {
    let mut scenario = ts::begin(ADMIN);

    {
        corm_coin::init_for_testing(scenario.ctx());
    };

    scenario.next_tx(ADMIN);
    {
        let admin_cap = corm_auth::create_admin_cap_for_testing(scenario.ctx());
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, scenario.ctx());
        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Mint twice
    scenario.next_tx(ADMIN);
    {
        let mut authority = scenario.take_shared<CoinAuthority>();
        let mut mint_cap = scenario.take_from_sender<MintCap>();
        let state = scenario.take_shared<corm_state::CormState>();
        let corm_state_id = object::id(&state);

        corm_coin::mint(&mut authority, &mut mint_cap, corm_state_id, 50, PLAYER, scenario.ctx());
        corm_coin::mint(&mut authority, &mut mint_cap, corm_state_id, 75, PLAYER, scenario.ctx());

        assert!(corm_coin::mint_cap_total_minted(&mint_cap) == 125);

        ts::return_shared(authority);
        ts::return_shared(state);
        scenario.return_to_sender(mint_cap);
    };

    scenario.end();
}

#[test]
#[expected_failure(abort_code = 0)] // ECormStateMismatch
fun test_mint_wrong_corm_state() {
    let mut scenario = ts::begin(ADMIN);

    {
        corm_coin::init_for_testing(scenario.ctx());
    };

    scenario.next_tx(ADMIN);
    {
        let admin_cap = corm_auth::create_admin_cap_for_testing(scenario.ctx());
        let network_node_id = object::id_from_address(@0x1234);
        let mint_cap = corm_state::create(&admin_cap, network_node_id, scenario.ctx());
        transfer::public_transfer(mint_cap, ADMIN);
        corm_auth::destroy_admin_cap_for_testing(admin_cap);
    };

    // Try to mint with a mismatched corm_state_id
    scenario.next_tx(ADMIN);
    {
        let mut authority = scenario.take_shared<CoinAuthority>();
        let mut mint_cap = scenario.take_from_sender<MintCap>();
        let wrong_id = object::id_from_address(@0xDEAD);

        // This should abort with ECormStateMismatch
        corm_coin::mint(&mut authority, &mut mint_cap, wrong_id, 10, PLAYER, scenario.ctx());

        ts::return_shared(authority);
        scenario.return_to_sender(mint_cap);
    };

    scenario.end();
}
