#[test_only]
module trustless_contracts::coin_for_coin_tests;

use sui::{
    clock,
    coin::{Self, Coin},
    test_scenario as ts,
};
use world::{
    character::Character,
    test_helpers::{user_a, user_b},
};
use trustless_contracts::test_helpers::{Self, ESCROW, FILL};
use trustless_contracts::coin_for_coin::{Self, CoinForCoinContract};
use trustless_contracts::contract_utils;

// =========================================================================
// Create
// =========================================================================

#[test]
fun test_create_coin_for_coin() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), true, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        assert!(coin_for_coin::poster_id(&contract) == poster_id);
        assert!(coin_for_coin::escrow_amount(&contract) == test_helpers::escrow_amount());
        assert!(coin_for_coin::escrow_balance(&contract) == test_helpers::escrow_amount());
        assert!(coin_for_coin::target_quantity(&contract) == test_helpers::wanted_amount());
        assert!(coin_for_coin::filled_quantity(&contract) == 0);
        assert!(coin_for_coin::allow_partial(&contract) == true);
        assert!(coin_for_coin::status(&contract) == contract_utils::status_open());
        assert!(coin_for_coin::deadline_ms(&contract) == test_helpers::far_future_ms());
        ts::return_shared(contract);
    };

    ts::end(ts);
}

// =========================================================================
// Full Fill
// =========================================================================

#[test]
fun test_fill_coin_for_coin_full() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(test_helpers::wanted_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(coin_for_coin::filled_quantity(&contract) == test_helpers::wanted_amount());
        assert!(coin_for_coin::escrow_balance(&contract) == 0);
        assert!(coin_for_coin::fill_pool_balance(&contract) == 0);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    // Verify filler received full escrow payout
    ts::next_tx(&mut ts, user_b());
    {
        let payout = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(payout.value() == test_helpers::escrow_amount());
        ts::return_to_sender(&ts, payout);
    };

    // Verify poster received filler's payment
    ts::next_tx(&mut ts, user_a());
    {
        let payment = ts::take_from_sender<Coin<FILL>>(&ts);
        assert!(payment.value() == test_helpers::wanted_amount());
        ts::return_to_sender(&ts, payment);
    };

    ts::end(ts);
}

// =========================================================================
// Partial Fill
// =========================================================================

#[test]
fun test_fill_coin_for_coin_partial() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), true, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Partial fill: 200 of 500
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(200, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(coin_for_coin::filled_quantity(&contract) == 200);
        // Payout: (200 * 1000) / 500 = 400 ESCROW released
        assert!(coin_for_coin::escrow_balance(&contract) == 600);
        assert!(coin_for_coin::filler_contribution(&contract, filler_id) == 200);

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
// Partial not allowed fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 9)] // EInsufficientFill
fun test_fill_partial_not_allowed() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(200, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Overpay returns excess
// =========================================================================

#[test]
fun test_fill_overpay_returns_excess() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Filler sends 800 FILL but only 500 needed — excess 300 returned
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(800, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(coin_for_coin::filled_quantity(&contract) == test_helpers::wanted_amount());
        assert!(coin_for_coin::escrow_balance(&contract) == 0);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    // Verify filler received: escrow payout (1000 ESCROW) + excess (300 FILL)
    ts::next_tx(&mut ts, user_b());
    {
        let escrow_payout = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(escrow_payout.value() == test_helpers::escrow_amount());
        ts::return_to_sender(&ts, escrow_payout);

        let excess = ts::take_from_sender<Coin<FILL>>(&ts);
        assert!(excess.value() == 300);
        ts::return_to_sender(&ts, excess);
    };

    ts::end(ts);
}

// =========================================================================
// Cancel
// =========================================================================

#[test]
fun test_cancel_coin_for_coin() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), true, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        coin_for_coin::cancel(contract, &poster, ts::ctx(&mut ts));
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let coin = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(coin.value() == test_helpers::escrow_amount());
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

// =========================================================================
// Cancel partially filled — remaining escrow returned
// =========================================================================

#[test]
fun test_cancel_coin_for_coin_partially_filled() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), true, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Partial fill: 200 of 500
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(200, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        coin_for_coin::cancel(contract, &poster, ts::ctx(&mut ts));
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
// Expire
// =========================================================================

#[test]
fun test_expire_coin_for_coin() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), true, 100,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(200);
        coin_for_coin::expire(contract, &clock, ts::ctx(&mut ts));
        clock.destroy_for_testing();
    };

    ts::next_tx(&mut ts, user_a());
    {
        let coin = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(coin.value() == test_helpers::escrow_amount());
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

// =========================================================================
// Access Control — Character restricted (allowed)
// =========================================================================

#[test]
fun test_access_control_character_allowed() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), false, test_helpers::far_future_ms(),
            vector[filler_id], vector[],
            &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(test_helpers::wanted_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(coin_for_coin::filled_quantity(&contract) == test_helpers::wanted_amount());

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
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), false, test_helpers::far_future_ms(),
            vector[], vector[test_helpers::filler_tribe()],
            &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(test_helpers::wanted_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(coin_for_coin::filled_quantity(&contract) == test_helpers::wanted_amount());

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
#[expected_failure(abort_code = 4)] // EFillerNotAuthorized
fun test_access_control_unauthorized() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let dummy_id = object::id_from_address(@0xDEAD);

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), false, test_helpers::far_future_ms(),
            vector[dummy_id], vector[],
            &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(test_helpers::wanted_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
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
#[expected_failure(abort_code = 5)] // ESelfFill
fun test_self_fill_rejected() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let fill_coin = coin::mint_for_testing<FILL>(test_helpers::wanted_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
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
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(1000);

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), true, 500,
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
#[expected_failure(abort_code = 1)] // EContractExpired
fun test_fill_after_expiry() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), true, 100,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(test_helpers::wanted_amount(), ts::ctx(&mut ts));
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(200);

        coin_for_coin::fill(
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
#[expected_failure(abort_code = 2)] // EContractNotExpired
fun test_expire_before_deadline() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), true, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        coin_for_coin::expire(contract, &clock, ts::ctx(&mut ts));
        clock.destroy_for_testing();
    };

    ts::end(ts);
}

// =========================================================================
// Cancel not poster — fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 6)] // ENotPoster
fun test_cancel_not_poster() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), true, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        coin_for_coin::cancel(contract, &filler, ts::ctx(&mut ts));
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Zero escrow — creation succeeds
// =========================================================================

#[test]
fun test_zero_escrow_succeeds() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(0, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, test_helpers::wanted_amount(), true, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        assert!(coin_for_coin::escrow_amount(&contract) == 0);
        assert!(coin_for_coin::target_quantity(&contract) == test_helpers::wanted_amount());
        ts::return_shared(contract);
    };

    ts::end(ts);
}

// =========================================================================
// Zero wanted amount (free giveaway) — target = escrow
// =========================================================================

#[test]
fun test_zero_wanted_amount_succeeds() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, 0, true, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        assert!(coin_for_coin::escrow_amount(&contract) == test_helpers::escrow_amount());
        assert!(coin_for_coin::target_quantity(&contract) == test_helpers::escrow_amount());
        ts::return_shared(contract);
    };

    ts::end(ts);
}

// =========================================================================
// Zero escrow AND zero wanted — creation rejected
// =========================================================================

#[test]
#[expected_failure(abort_code = 100)] // EWantedAmountZero
fun test_zero_zero_fails() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(0, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, 0, true, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::end(ts);
}

// =========================================================================
// Divisibility — not divisible fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 11)] // ENotDivisible
fun test_not_divisible_coin_for_coin() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        // 1000 % 300 != 0 — should abort
        let escrow = coin::mint_for_testing<ESCROW>(1000, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, 300, true, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::end(ts);
}

// =========================================================================
// Zero dust — multiple partial fills leave exactly 0 remaining
// =========================================================================

#[test]
fun test_zero_dust_multi_partial_fills() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    // Create: 900 ESCROW for 300 FILL (unit price = 3)
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(900, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, 300, true, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Fill 1: 100 of 300 → payout = 100 * 3 = 300
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(coin_for_coin::filled_quantity(&contract) == 100);
        assert!(coin_for_coin::escrow_balance(&contract) == 600);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    // Fill 2: 100 of 300 → payout = 100 * 3 = 300
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(coin_for_coin::filled_quantity(&contract) == 200);
        assert!(coin_for_coin::escrow_balance(&contract) == 300);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    // Fill 3 (final): 100 of 300 → drains remaining 300
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(coin_for_coin::filled_quantity(&contract) == 300);
        assert!(coin_for_coin::escrow_balance(&contract) == 0);
        assert!(coin_for_coin::fill_pool_balance(&contract) == 0);

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Divisibility skipped when allow_partial = false
// =========================================================================

#[test]
fun test_non_divisible_coin_for_coin_no_partial() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    // 1000 % 300 != 0 — would abort with partial, but succeeds with no-partial
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(1000, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::create<ESCROW, FILL>(
            &poster, escrow, 300, false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        assert!(coin_for_coin::escrow_amount(&contract) == 1000);
        assert!(coin_for_coin::target_quantity(&contract) == 300);
        assert!(coin_for_coin::allow_partial(&contract) == false);
        ts::return_shared(contract);
    };

    // Full fill succeeds — filler pays 300, gets all 1000 escrow
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForCoinContract<ESCROW, FILL>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(300, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_coin::fill(
            &mut contract, fill_coin, &filler, &clock, ts::ctx(&mut ts),
        );

        assert!(coin_for_coin::filled_quantity(&contract) == 300);
        assert!(coin_for_coin::escrow_balance(&contract) == 0);
        assert!(coin_for_coin::status(&contract) == contract_utils::status_completed());

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(filler);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let payout = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(payout.value() == 1000);
        ts::return_to_sender(&ts, payout);
    };

    ts::end(ts);
}
