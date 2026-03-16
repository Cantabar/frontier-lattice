#[test_only]
module trustless_contracts::trustless_contracts_tests;

use std::string::utf8;
use sui::{
    clock,
    coin::{Self, Coin},
    test_scenario as ts,
};
use world::{
    access::{OwnerCap, AdminACL},
    character::{Self, Character},
    energy::EnergyConfig,
    network_node::{Self, NetworkNode},
    object_registry::ObjectRegistry,
    storage_unit::{Self, StorageUnit},
    test_helpers::{Self, admin, tenant, user_a, user_b},
};
use corm_auth::corm_auth::CormAuth;
use trustless_contracts::trustless_contracts::{Self, Contract};

// === Test coin witnesses ===
public struct ESCROW has drop {}
public struct FILL has drop {}

// === Constants ===
const POSTER_GAME_ID: u32 = 1001;
const FILLER_GAME_ID: u32 = 1002;
const POSTER_TRIBE: u32 = 100;
const FILLER_TRIBE: u32 = 200;
const FAR_FUTURE_MS: u64 = 9_999_999_999_999;
const ESCROW_AMOUNT: u64 = 1000;
const WANTED_AMOUNT: u64 = 500;

// SSU test infrastructure constants
const LOCATION_HASH: vector<u8> =
    x"7a8f3b2e9c4d1a6f5e8b2d9c3f7a1e5b7a8f3b2e9c4d1a6f5e8b2d9c3f7a1e5b";
const SSU_MAX_CAPACITY: u64 = 100000;
const SSU_TYPE_ID: u64 = 5555;
const SSU_ITEM_ID: u64 = 90002;
const NWN_TYPE_ID: u64 = 111000;
const NWN_ITEM_ID: u64 = 5000;
const FUEL_MAX_CAPACITY: u64 = 1000;
const FUEL_BURN_RATE_MS: u64 = 3_600_000;
const MAX_PRODUCTION: u64 = 100;
const FUEL_TYPE_ID: u64 = 1;
const FUEL_VOLUME: u64 = 10;
const ITEM_TYPE_ID: u64 = 88069;
const ITEM_ITEM_ID: u64 = 1000004145107;
const ITEM_VOLUME: u64 = 100;
const ITEM_QUANTITY: u32 = 10;

// === Helpers ===

/// Sets up the world and creates two Characters (poster = user_a, filler = user_b).
fun setup_characters(ts: &mut ts::Scenario): (ID, ID) {
    test_helpers::setup_world(ts);

    // Create poster character (user_a, tribe 100)
    ts::next_tx(ts, admin());
    let poster_id = {
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let char = character::create_character(
            &mut registry,
            &admin_acl,
            POSTER_GAME_ID,
            tenant(),
            POSTER_TRIBE,
            user_a(),
            utf8(b"Poster"),
            ts::ctx(ts),
        );
        let id = object::id(&char);
        character::share_character(char, &admin_acl, ts::ctx(ts));
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        id
    };

    // Create filler character (user_b, tribe 200)
    ts::next_tx(ts, admin());
    let filler_id = {
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let char = character::create_character(
            &mut registry,
            &admin_acl,
            FILLER_GAME_ID,
            tenant(),
            FILLER_TRIBE,
            user_b(),
            utf8(b"Filler"),
            ts::ctx(ts),
        );
        let id = object::id(&char);
        character::share_character(char, &admin_acl, ts::ctx(ts));
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        id
    };

    (poster_id, filler_id)
}

// === SSU Test Infrastructure ===

/// Extended setup for SSU tests: world + energy config + server + characters.
fun setup_ssu_characters(ts: &mut ts::Scenario): (ID, ID) {
    test_helpers::setup_world(ts);
    test_helpers::configure_assembly_energy(ts);
    test_helpers::register_server_address(ts);

    ts::next_tx(ts, admin());
    let poster_id = {
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let char = character::create_character(
            &mut registry, &admin_acl, POSTER_GAME_ID, tenant(),
            POSTER_TRIBE, user_a(), utf8(b"Poster"), ts::ctx(ts),
        );
        let id = object::id(&char);
        character::share_character(char, &admin_acl, ts::ctx(ts));
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        id
    };

    ts::next_tx(ts, admin());
    let filler_id = {
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let char = character::create_character(
            &mut registry, &admin_acl, FILLER_GAME_ID, tenant(),
            FILLER_TRIBE, user_b(), utf8(b"Filler"), ts::ctx(ts),
        );
        let id = object::id(&char);
        character::share_character(char, &admin_acl, ts::ctx(ts));
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        id
    };

    (poster_id, filler_id)
}

/// Creates a network node and anchors an SSU. Returns (storage_id, nwn_id).
fun create_test_ssu(ts: &mut ts::Scenario, character_id: ID): (ID, ID) {
    ts::next_tx(ts, admin());
    let nwn_id = {
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let character = ts::take_shared_by_id<Character>(ts, character_id);
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let nwn = network_node::anchor(
            &mut registry, &character, &admin_acl,
            NWN_ITEM_ID, NWN_TYPE_ID, LOCATION_HASH,
            FUEL_MAX_CAPACITY, FUEL_BURN_RATE_MS, MAX_PRODUCTION,
            ts.ctx(),
        );
        let id = object::id(&nwn);
        nwn.share_network_node(&admin_acl, ts.ctx());
        ts::return_shared(character);
        ts::return_shared(admin_acl);
        ts::return_shared(registry);
        id
    };

    ts::next_tx(ts, admin());
    let storage_id = {
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let mut nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
        let character = ts::take_shared_by_id<Character>(ts, character_id);
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let ssu = storage_unit::anchor(
            &mut registry, &mut nwn, &character, &admin_acl,
            SSU_ITEM_ID, SSU_TYPE_ID, SSU_MAX_CAPACITY, LOCATION_HASH,
            ts.ctx(),
        );
        let id = object::id(&ssu);
        ssu.share_storage_unit(&admin_acl, ts.ctx());
        ts::return_shared(admin_acl);
        ts::return_shared(character);
        ts::return_shared(nwn);
        ts::return_shared(registry);
        id
    };

    (storage_id, nwn_id)
}

/// Fuels NWN and brings both NWN and SSU online.
fun online_test_ssu(
    ts: &mut ts::Scenario,
    user: address,
    character_id: ID,
    storage_id: ID,
    nwn_id: ID,
) {
    let clock = clock::create_for_testing(ts.ctx());

    ts::next_tx(ts, user);
    let mut character = ts::take_shared_by_id<Character>(ts, character_id);
    let (nwn_cap, nwn_receipt) = character.borrow_owner_cap<NetworkNode>(
        ts::most_recent_receiving_ticket<OwnerCap<NetworkNode>>(&character_id),
        ts.ctx(),
    );

    ts::next_tx(ts, user);
    {
        let mut nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
        nwn.deposit_fuel_test(&nwn_cap, FUEL_TYPE_ID, FUEL_VOLUME, 10, &clock);
        ts::return_shared(nwn);
    };

    ts::next_tx(ts, user);
    {
        let mut nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
        nwn.online(&nwn_cap, &clock);
        ts::return_shared(nwn);
    };
    character.return_owner_cap(nwn_cap, nwn_receipt);

    ts::next_tx(ts, user);
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(ts, storage_id);
        let mut nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
        let energy_config = ts::take_shared<EnergyConfig>(ts);
        let (ssu_cap, ssu_receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&character_id),
            ts.ctx(),
        );
        storage_unit.online(&mut nwn, &energy_config, &ssu_cap);
        character.return_owner_cap(ssu_cap, ssu_receipt);
        ts::return_shared(storage_unit);
        ts::return_shared(nwn);
        ts::return_shared(energy_config);
    };

    ts::return_shared(character);
    clock.destroy_for_testing();
}

/// Authorizes CormAuth on the SSU and mints items to poster's owned inventory.
fun authorize_and_mint(
    ts: &mut ts::Scenario,
    user: address,
    character_id: ID,
    storage_id: ID,
) {
    ts::next_tx(ts, user);
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(ts, character_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&character_id),
            ts.ctx(),
        );
        storage_unit.authorize_extension<CormAuth>(&owner_cap);
        character.return_owner_cap(owner_cap, receipt);
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    ts::next_tx(ts, user);
    {
        let mut character = ts::take_shared_by_id<Character>(ts, character_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&character_id),
            ts.ctx(),
        );
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(ts, storage_id);
        storage_unit.game_item_to_chain_inventory_test<StorageUnit>(
            &character, &owner_cap,
            ITEM_ITEM_ID, ITEM_TYPE_ID, ITEM_VOLUME, ITEM_QUANTITY,
            ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);
        ts::return_shared(character);
        ts::return_shared(storage_unit);
    };
}

// =========================================================================
// CoinForCoin — Create
// =========================================================================

#[test]
fun test_create_coin_for_coin() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, true, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Verify contract fields
    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        assert!(trustless_contracts::contract_poster_id(&contract) == poster_id);
        assert!(trustless_contracts::contract_escrow_amount(&contract) == ESCROW_AMOUNT);
        assert!(trustless_contracts::contract_escrow_balance(&contract) == ESCROW_AMOUNT);
        assert!(trustless_contracts::contract_target_quantity(&contract) == WANTED_AMOUNT);
        assert!(trustless_contracts::contract_filled_quantity(&contract) == 0);
        assert!(trustless_contracts::contract_allow_partial(&contract) == true);
        assert!(trustless_contracts::contract_status(&contract) == trustless_contracts::status_open());
        assert!(trustless_contracts::contract_deadline_ms(&contract) == FAR_FUTURE_MS);
        ts::return_shared(contract);
    };

    ts::end(ts);
}

// =========================================================================
// CoinForCoin — Full Fill
// =========================================================================

#[test]
fun test_fill_coin_for_coin_full() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);

    // Create contract: 1000 ESCROW for 500 FILL, no partial
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, false, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Filler fills completely
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(WANTED_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::fill_with_coins(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(trustless_contracts::contract_filled_quantity(&contract) == WANTED_AMOUNT);
        assert!(trustless_contracts::contract_escrow_balance(&contract) == 0);
        assert!(trustless_contracts::contract_fill_pool_balance(&contract) == 0);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    // Verify filler received full escrow payout (ESCROW)
    ts::next_tx(&mut ts, user_b());
    {
        let payout = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(payout.value() == ESCROW_AMOUNT);
        ts::return_to_sender(&ts, payout);
    };

    // Verify poster received filler's payment (FILL)
    ts::next_tx(&mut ts, user_a());
    {
        let payment = ts::take_from_sender<Coin<FILL>>(&ts);
        assert!(payment.value() == WANTED_AMOUNT);
        ts::return_to_sender(&ts, payment);
    };

    ts::end(ts);
}

// =========================================================================
// CoinForCoin — Partial Fill
// =========================================================================

#[test]
fun test_fill_coin_for_coin_partial() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);

    // Create contract with partial fill allowed
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, true, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Partial fill: 200 of 500
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(200, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::fill_with_coins(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(trustless_contracts::contract_filled_quantity(&contract) == 200);
        // Payout: (200 * 1000) / 500 = 400 ESCROW released
        assert!(trustless_contracts::contract_escrow_balance(&contract) == 600);
        assert!(trustless_contracts::filler_contribution(&contract, filler_id) == 200);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    // Verify filler received partial payout
    ts::next_tx(&mut ts, user_b());
    {
        let payout = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(payout.value() == 400); // (200 * 1000) / 500
        ts::return_to_sender(&ts, payout);
    };

    ts::end(ts);
}

// =========================================================================
// CoinForCoin — Partial not allowed fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 10)] // EInsufficientFill
fun test_fill_partial_not_allowed() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, false, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Partial fill with no-partial contract — should abort
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(200, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::fill_with_coins(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// CoinForCoin — Overpay returns excess
// =========================================================================

#[test]
fun test_fill_overpay_returns_excess() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, false, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Filler sends 800 FILL but only 500 needed — excess 300 returned
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(800, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::fill_with_coins(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(trustless_contracts::contract_filled_quantity(&contract) == WANTED_AMOUNT);
        assert!(trustless_contracts::contract_escrow_balance(&contract) == 0);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    // Verify filler received: escrow payout (1000 ESCROW) + excess (300 FILL)
    ts::next_tx(&mut ts, user_b());
    {
        let escrow_payout = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(escrow_payout.value() == ESCROW_AMOUNT);
        ts::return_to_sender(&ts, escrow_payout);

        let excess = ts::take_from_sender<Coin<FILL>>(&ts);
        assert!(excess.value() == 300);
        ts::return_to_sender(&ts, excess);
    };

    ts::end(ts);
}

// =========================================================================
// Cancel Contract
// =========================================================================

#[test]
fun test_cancel_contract() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, true, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Poster cancels
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);

        trustless_contracts::cancel_contract(contract, &poster, ts::ctx(&mut ts));
        // contract consumed

        ts::return_shared(poster);
    };

    // Verify escrow returned to poster
    ts::next_tx(&mut ts, user_a());
    {
        let coin = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(coin.value() == ESCROW_AMOUNT);
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

// =========================================================================
// Cancel partially filled contract — remaining escrow returned
// =========================================================================

#[test]
fun test_cancel_partially_filled() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, true, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Partial fill: 200 of 500
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(200, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::fill_with_coins(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    // Poster cancels — remaining escrow (600) returned
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        trustless_contracts::cancel_contract(contract, &poster, ts::ctx(&mut ts));
        ts::return_shared(poster);
    };

    // Verify remaining escrow returned (1000 - 400 used = 600)
    ts::next_tx(&mut ts, user_a());
    {
        let coin = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(coin.value() == 600);
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

// =========================================================================
// Expire Contract
// =========================================================================

#[test]
fun test_expire_contract() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_characters(&mut ts);

    // Create with short deadline
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, true, 100,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Advance clock past deadline and expire (anyone can call)
    ts::next_tx(&mut ts, user_b());
    {
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(200);

        trustless_contracts::expire_contract(contract, &clock, ts::ctx(&mut ts));

        clock.destroy_for_testing();
    };

    // Verify escrow returned to poster
    ts::next_tx(&mut ts, user_a());
    {
        let coin = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(coin.value() == ESCROW_AMOUNT);
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

// =========================================================================
// Expire Transport — stake forfeited to poster
// =========================================================================

#[test]
fun test_expire_transport_forfeits_stake() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);
    let source_ssu_id = object::id_from_address(@0x41);
    let dest_ssu_id = object::id_from_address(@0x42);
    let stake_amount: u64 = 200;

    // Create transport
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_transport<ESCROW, FILL>(
            &poster, escrow, 42, 10, source_ssu_id, dest_ssu_id, stake_amount, 100,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Courier accepts
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let courier = ts::take_shared_by_id<Character>(&ts, filler_id);
        let stake = coin::mint_for_testing<FILL>(stake_amount, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::accept_transport(&mut contract, stake, &courier, &clock);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(courier);
    };

    // Expire — stake forfeited to poster
    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(200);

        trustless_contracts::expire_contract(contract, &clock, ts::ctx(&mut ts));

        clock.destroy_for_testing();
    };

    // Poster receives escrow (1000 ESCROW) + forfeited stake (200 FILL)
    ts::next_tx(&mut ts, user_a());
    {
        let escrow_back = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(escrow_back.value() == ESCROW_AMOUNT);
        ts::return_to_sender(&ts, escrow_back);

        let forfeited_stake = ts::take_from_sender<Coin<FILL>>(&ts);
        assert!(forfeited_stake.value() == stake_amount);
        ts::return_to_sender(&ts, forfeited_stake);
    };

    ts::end(ts);
}

// =========================================================================
// Access Control — Character restricted (allowed)
// =========================================================================

#[test]
fun test_access_control_character_allowed() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, false, FAR_FUTURE_MS,
            vector[filler_id], vector[],
            &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Filler (in allowlist) fills successfully
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(WANTED_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::fill_with_coins(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(trustless_contracts::contract_filled_quantity(&contract) == WANTED_AMOUNT);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Access Control — Tribe restricted (allowed)
// =========================================================================

#[test]
fun test_access_control_tribe_allowed() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, false, FAR_FUTURE_MS,
            vector[], vector[FILLER_TRIBE],
            &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Filler (tribe 200, in allowlist) fills successfully
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(WANTED_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::fill_with_coins(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(trustless_contracts::contract_filled_quantity(&contract) == WANTED_AMOUNT);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Access Control — Unauthorized filler rejected
// =========================================================================

#[test]
#[expected_failure(abort_code = 7)] // EFillerNotAuthorized
fun test_access_control_unauthorized() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);

    // Restrict to a different character ID
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let dummy_id = object::id_from_address(@0xDEAD);

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, false, FAR_FUTURE_MS,
            vector[dummy_id], vector[],
            &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Filler (not in allowlist) tries to fill — should abort
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(WANTED_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::fill_with_coins(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Self-fill rejected
// =========================================================================

#[test]
#[expected_failure(abort_code = 8)] // ESelfFill
fun test_self_fill_rejected() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, false, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Poster tries to fill own contract — should abort
    ts::next_tx(&mut ts, user_a());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let fill_coin = coin::mint_for_testing<FILL>(WANTED_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::fill_with_coins(
            &mut contract, fill_coin, &poster, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(poster);
    };

    ts::end(ts);
}

// =========================================================================
// Deadline in past — creation fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 0)] // EDeadlineInPast
fun test_deadline_in_past() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(1000);

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, true, 500, // 500 < 1000
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::end(ts);
}

// =========================================================================
// Fill after expiry — fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 5)] // EContractExpired
fun test_fill_after_expiry() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, true, 100,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Fill after deadline — should abort
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(WANTED_AMOUNT, ts::ctx(&mut ts));
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(200);

        trustless_contracts::fill_with_coins(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Expire before deadline — fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 6)] // EContractNotExpired
fun test_expire_before_deadline() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, true, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Try to expire before deadline — should abort
    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::expire_contract(contract, &clock, ts::ctx(&mut ts));

        clock.destroy_for_testing();
    };

    ts::end(ts);
}

// =========================================================================
// Cancel not poster — fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 4)] // ENotPoster
fun test_cancel_not_poster() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, true, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Non-poster tries to cancel — should abort
    ts::next_tx(&mut ts, user_b());
    {
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);

        trustless_contracts::cancel_contract(contract, &filler, ts::ctx(&mut ts));

        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Transport — Create and Accept
// =========================================================================

#[test]
fun test_transport_create_and_accept() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);
    let source_ssu_id = object::id_from_address(@0x41);
    let dest_ssu_id = object::id_from_address(@0x42);
    let stake_amount: u64 = 200;

    // Create transport
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_transport<ESCROW, FILL>(
            &poster, escrow, 42, 10, source_ssu_id, dest_ssu_id, stake_amount, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Verify transport contract fields
    ts::next_tx(&mut ts, user_b());
    {
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        assert!(trustless_contracts::contract_require_stake(&contract) == true);
        assert!(trustless_contracts::contract_stake_amount(&contract) == stake_amount);
        assert!(trustless_contracts::contract_target_quantity(&contract) == 10);
        assert!(trustless_contracts::contract_status(&contract) == trustless_contracts::status_open());
        ts::return_shared(contract);
    };

    // Courier accepts
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let courier = ts::take_shared_by_id<Character>(&ts, filler_id);
        let stake = coin::mint_for_testing<FILL>(stake_amount, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::accept_transport(&mut contract, stake, &courier, &clock);

        assert!(trustless_contracts::contract_status(&contract) == trustless_contracts::status_in_progress());
        assert!(trustless_contracts::contract_courier_stake_balance(&contract) == stake_amount);
        assert!(trustless_contracts::contract_courier_id(&contract) == option::some(filler_id));

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(courier);
    };

    ts::end(ts);
}

// =========================================================================
// Transport — Insufficient stake fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 11)] // EInsufficientStake
fun test_transport_insufficient_stake() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_characters(&mut ts);
    let source_ssu_id = object::id_from_address(@0x41);
    let dest_ssu_id = object::id_from_address(@0x42);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_transport<ESCROW, FILL>(
            &poster, escrow, 42, 10, source_ssu_id, dest_ssu_id, 200, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Courier stakes too little — should abort
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let courier = ts::take_shared_by_id<Character>(&ts, filler_id);
        let stake = coin::mint_for_testing<FILL>(100, ts::ctx(&mut ts)); // need 200
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::accept_transport(&mut contract, stake, &courier, &clock);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(courier);
    };

    ts::end(ts);
}

// =========================================================================
// CoinForItem — Create (no SSU needed for creation)
// =========================================================================

#[test]
fun test_create_coin_for_item() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_characters(&mut ts);
    let dest_ssu_id = object::id_from_address(@0x42);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_item<ESCROW, FILL>(
            &poster, escrow, 88069, 10, dest_ssu_id, true, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Verify contract fields
    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        assert!(trustless_contracts::contract_poster_id(&contract) == poster_id);
        assert!(trustless_contracts::contract_escrow_amount(&contract) == ESCROW_AMOUNT);
        assert!(trustless_contracts::contract_target_quantity(&contract) == 10);
        assert!(trustless_contracts::contract_allow_partial(&contract) == true);
        ts::return_shared(contract);
    };

    ts::end(ts);
}

// =========================================================================
// Zero escrow — creation succeeds
// =========================================================================

#[test]
fun test_zero_escrow_succeeds() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(0, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, WANTED_AMOUNT, true, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        assert!(trustless_contracts::contract_escrow_amount(&contract) == 0);
        assert!(trustless_contracts::contract_target_quantity(&contract) == WANTED_AMOUNT);
        ts::return_shared(contract);
    };

    ts::end(ts);
}

// =========================================================================
// Zero wanted amount (free giveaway) — creation succeeds, target = escrow
// =========================================================================

#[test]
fun test_zero_wanted_amount_succeeds() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(ESCROW_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, 0, true, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        assert!(trustless_contracts::contract_escrow_amount(&contract) == ESCROW_AMOUNT);
        // target_quantity equals offered_amount for free giveaways
        assert!(trustless_contracts::contract_target_quantity(&contract) == ESCROW_AMOUNT);
        ts::return_shared(contract);
    };

    ts::end(ts);
}

// =========================================================================
// Zero escrow AND zero wanted — creation rejected
// =========================================================================

#[test]
#[expected_failure(abort_code = trustless_contracts::EWantedAmountZero)]
fun test_zero_zero_fails() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(0, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        // Both escrow and wanted are 0 — should abort
        trustless_contracts::create_coin_for_coin<ESCROW, FILL>(
            &poster, escrow, 0, true, FAR_FUTURE_MS,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::end(ts);
}

// =========================================================================
// Item Escrow — Cancel ItemForCoin returns items to poster
// =========================================================================

#[test]
fun test_cancel_item_contract_returns_items() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = create_test_ssu(&mut ts, poster_id);
    online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);
    authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);

    // Withdraw items and create ItemForCoin contract
    ts::next_tx(&mut ts, user_a());
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(&ts, poster_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        let item = storage_unit.withdraw_by_owner(
            &character, &owner_cap, ITEM_TYPE_ID, ITEM_QUANTITY, ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);

        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        trustless_contracts::create_item_for_coin<ESCROW, FILL>(
            &character, &mut storage_unit, item, WANTED_AMOUNT, true,
            FAR_FUTURE_MS, vector[], vector[], &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    // Verify items are in open inventory
    ts::next_tx(&mut ts, user_a());
    {
        let storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let open_key = storage_unit.open_storage_key();
        assert!(storage_unit.item_quantity(open_key, ITEM_TYPE_ID) == ITEM_QUANTITY);
        ts::return_shared(storage_unit);
    };

    // Cancel — items should return to poster's owned inventory
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        trustless_contracts::cancel_item_contract(
            contract, &poster, &mut storage_unit, ts::ctx(&mut ts),
        );
        ts::return_shared(poster);
        ts::return_shared(storage_unit);
    };

    // Verify items back in poster's owned inventory
    ts::next_tx(&mut ts, user_a());
    {
        let storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let poster_char = ts::take_shared_by_id<Character>(&ts, poster_id);
        let cap_id = poster_char.owner_cap_id();
        assert!(storage_unit.item_quantity(cap_id, ITEM_TYPE_ID) == ITEM_QUANTITY);
        ts::return_shared(poster_char);
        ts::return_shared(storage_unit);
    };

    ts::end(ts);
}

// =========================================================================
// Item Escrow — Expire ItemForCoin returns items to poster
// =========================================================================

#[test]
fun test_expire_item_contract_returns_items() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = create_test_ssu(&mut ts, poster_id);
    online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);
    authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);

    // Create ItemForCoin contract with short deadline
    ts::next_tx(&mut ts, user_a());
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(&ts, poster_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        let item = storage_unit.withdraw_by_owner(
            &character, &owner_cap, ITEM_TYPE_ID, ITEM_QUANTITY, ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);

        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        trustless_contracts::create_item_for_coin<ESCROW, FILL>(
            &character, &mut storage_unit, item, WANTED_AMOUNT, true,
            100, vector[], vector[], &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    // Expire after deadline
    ts::next_tx(&mut ts, user_b());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(200);

        trustless_contracts::expire_item_contract(
            contract, &poster, &mut storage_unit, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
        ts::return_shared(storage_unit);
    };

    // Verify items returned to poster
    ts::next_tx(&mut ts, user_a());
    {
        let storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let poster_char = ts::take_shared_by_id<Character>(&ts, poster_id);
        let cap_id = poster_char.owner_cap_id();
        assert!(storage_unit.item_quantity(cap_id, ITEM_TYPE_ID) == ITEM_QUANTITY);
        ts::return_shared(poster_char);
        ts::return_shared(storage_unit);
    };

    ts::end(ts);
}

// =========================================================================
// Item Escrow — cancel_contract rejects item-bearing types
// =========================================================================

#[test]
#[expected_failure(abort_code = 19)] // EItemContractRequiresItemCancel
fun test_cancel_coin_only_rejects_item_contract() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = create_test_ssu(&mut ts, poster_id);
    online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);
    authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);

    // Create ItemForCoin contract
    ts::next_tx(&mut ts, user_a());
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(&ts, poster_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        let item = storage_unit.withdraw_by_owner(
            &character, &owner_cap, ITEM_TYPE_ID, ITEM_QUANTITY, ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);

        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        trustless_contracts::create_item_for_coin<ESCROW, FILL>(
            &character, &mut storage_unit, item, WANTED_AMOUNT, true,
            FAR_FUTURE_MS, vector[], vector[], &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    // Try coin-only cancel — should abort with EItemContractRequiresItemCancel
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        trustless_contracts::cancel_contract(contract, &poster, ts::ctx(&mut ts));
        ts::return_shared(poster);
    };

    ts::end(ts);
}

// =========================================================================
// Item Escrow — expire_contract rejects item-bearing types
// =========================================================================

#[test]
#[expected_failure(abort_code = 19)] // EItemContractRequiresItemCancel
fun test_expire_coin_only_rejects_item_contract() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = create_test_ssu(&mut ts, poster_id);
    online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);
    authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);

    // Create ItemForCoin contract with short deadline
    ts::next_tx(&mut ts, user_a());
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(&ts, poster_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        let item = storage_unit.withdraw_by_owner(
            &character, &owner_cap, ITEM_TYPE_ID, ITEM_QUANTITY, ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);

        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        trustless_contracts::create_item_for_coin<ESCROW, FILL>(
            &character, &mut storage_unit, item, WANTED_AMOUNT, true,
            100, vector[], vector[], &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    // Try coin-only expire — should abort
    ts::next_tx(&mut ts, user_b());
    {
        let contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(200);
        trustless_contracts::expire_contract(contract, &clock, ts::ctx(&mut ts));
        clock.destroy_for_testing();
    };

    ts::end(ts);
}

// =========================================================================
// Item Escrow — fill ItemForCoin releases items to filler
// =========================================================================

#[test]
fun test_fill_item_for_coin_full() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = create_test_ssu(&mut ts, poster_id);
    online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);
    authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);

    // Create ItemForCoin: poster offers 10 items, wants 500 coins
    ts::next_tx(&mut ts, user_a());
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(&ts, poster_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        let item = storage_unit.withdraw_by_owner(
            &character, &owner_cap, ITEM_TYPE_ID, ITEM_QUANTITY, ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);

        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        trustless_contracts::create_item_for_coin<ESCROW, FILL>(
            &character, &mut storage_unit, item, WANTED_AMOUNT, false,
            FAR_FUTURE_MS, vector[], vector[], &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    // Filler fills with 500 FILL coins
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<Contract<ESCROW, FILL>>(&ts);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(WANTED_AMOUNT, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        trustless_contracts::fill_item_for_coin(
            &mut contract, &mut storage_unit, &poster, &filler,
            fill_coin, &clock, ts::ctx(&mut ts),
        );

        assert!(trustless_contracts::contract_filled_quantity(&contract) == WANTED_AMOUNT);
        assert!(trustless_contracts::contract_items_released(&contract) == ITEM_QUANTITY);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(storage_unit);
        ts::return_shared(poster);
        ts::return_shared(filler);
    };

    // Verify filler received items in owned inventory
    ts::next_tx(&mut ts, user_a());
    {
        let storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let filler_char = ts::take_shared_by_id<Character>(&ts, filler_id);
        let filler_cap_id = filler_char.owner_cap_id();
        assert!(storage_unit.item_quantity(filler_cap_id, ITEM_TYPE_ID) == ITEM_QUANTITY);
        ts::return_shared(filler_char);
        ts::return_shared(storage_unit);
    };

    // Verify poster received fill coins
    ts::next_tx(&mut ts, user_a());
    {
        let payment = ts::take_from_sender<Coin<FILL>>(&ts);
        assert!(payment.value() == WANTED_AMOUNT);
        ts::return_to_sender(&ts, payment);
    };

    ts::end(ts);
}
