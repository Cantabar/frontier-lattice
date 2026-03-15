#[test_only]
module trustless_contracts::trustless_contracts_tests;

use std::string::utf8;
use sui::{
    clock,
    coin::{Self, Coin},
    test_scenario as ts,
};
use world::{
    access::AdminACL,
    character::{Self, Character},
    object_registry::ObjectRegistry,
    test_helpers::{Self, admin, tenant, user_a, user_b},
};
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
// Zero escrow — creation fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 1)] // EInsufficientEscrow
fun test_zero_escrow_fails() {
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

    ts::end(ts);
}

// =========================================================================
// Zero wanted amount — creation fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 16)] // EWantedAmountZero
fun test_zero_wanted_amount_fails() {
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

    ts::end(ts);
}
