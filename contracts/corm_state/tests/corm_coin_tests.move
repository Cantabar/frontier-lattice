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

    // Mint 100 CORM (= 1_000_000 base units at 4 decimals) to PLAYER
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
            1_000_000,  // 100 CORM
            PLAYER,
            scenario.ctx(),
        );

        assert!(corm_coin::mint_cap_total_minted(&mint_cap) == 1_000_000);

        ts::return_shared(authority);
        ts::return_shared(state);
        scenario.return_to_sender(mint_cap);
    };

    // Verify PLAYER received 100 CORM (1_000_000 base units)
    scenario.next_tx(PLAYER);
    {
        let coin = scenario.take_from_sender<Coin<CORM_COIN>>();
        assert!(coin.value() == 1_000_000);
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

    // Mint 50 CORM + 75 CORM = 125 CORM total
    scenario.next_tx(ADMIN);
    {
        let mut authority = scenario.take_shared<CoinAuthority>();
        let mut mint_cap = scenario.take_from_sender<MintCap>();
        let state = scenario.take_shared<corm_state::CormState>();
        let corm_state_id = object::id(&state);

        corm_coin::mint(&mut authority, &mut mint_cap, corm_state_id, 500_000, PLAYER, scenario.ctx());  // 50 CORM
        corm_coin::mint(&mut authority, &mut mint_cap, corm_state_id, 750_000, PLAYER, scenario.ctx());  // 75 CORM

        assert!(corm_coin::mint_cap_total_minted(&mint_cap) == 1_250_000);  // 125 CORM

        ts::return_shared(authority);
        ts::return_shared(state);
        scenario.return_to_sender(mint_cap);
    };

    scenario.end();
}

#[test]
fun test_total_supply_after_mint() {
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

    scenario.next_tx(ADMIN);
    {
        let mut authority = scenario.take_shared<CoinAuthority>();
        let mut mint_cap = scenario.take_from_sender<MintCap>();
        let state = scenario.take_shared<corm_state::CormState>();
        let corm_state_id = object::id(&state);

        corm_coin::mint(&mut authority, &mut mint_cap, corm_state_id, 2_000_000, PLAYER, scenario.ctx());  // 200 CORM

        assert!(corm_coin::total_supply(&authority) == 2_000_000);

        ts::return_shared(authority);
        ts::return_shared(state);
        scenario.return_to_sender(mint_cap);
    };

    scenario.end();
}

#[test]
fun test_burn_reduces_supply() {
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

    // Mint 100 CORM (1_000_000 base units) to PLAYER
    scenario.next_tx(ADMIN);
    {
        let mut authority = scenario.take_shared<CoinAuthority>();
        let mut mint_cap = scenario.take_from_sender<MintCap>();
        let state = scenario.take_shared<corm_state::CormState>();
        let corm_state_id = object::id(&state);

        corm_coin::mint(&mut authority, &mut mint_cap, corm_state_id, 1_000_000, PLAYER, scenario.ctx());  // 100 CORM

        ts::return_shared(authority);
        ts::return_shared(state);
        scenario.return_to_sender(mint_cap);
    };

    // PLAYER burns 40 CORM (400_000 base units)
    scenario.next_tx(PLAYER);
    {
        let mut authority = scenario.take_shared<CoinAuthority>();
        let mut coin = scenario.take_from_sender<Coin<CORM_COIN>>();
        let burn_coin = coin.split(400_000, scenario.ctx());  // 40 CORM
        corm_coin::burn(&mut authority, burn_coin, scenario.ctx());

        assert!(corm_coin::total_supply(&authority) == 600_000);  // 60 CORM remaining

        ts::return_shared(authority);
        scenario.return_to_sender(coin);
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
        corm_coin::mint(&mut authority, &mut mint_cap, wrong_id, 100_000, PLAYER, scenario.ctx());  // 10 CORM

        ts::return_shared(authority);
        scenario.return_to_sender(mint_cap);
    };

    scenario.end();
}
