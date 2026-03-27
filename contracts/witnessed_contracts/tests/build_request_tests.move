#[test_only]
module witnessed_contracts::build_request_tests;

use sui::{
    clock,
    coin,
    test_scenario as ts,
};
use witnessed_contracts::build_request::{Self, BuildRequestContract};
use witnessed_contracts::test_helpers;

/// Test coin type for bounty.
public struct BOUNTY has drop {}

// =========================================================================
// Create + Cancel
// =========================================================================

#[test]
fun test_create_and_cancel() {
    let mut ts = ts::begin(@0x0);

    // Create contract
    ts::next_tx(&mut ts, test_helpers::poster());
    {
        let bounty = coin::mint_for_testing<BOUNTY>(test_helpers::bounty_amount(), ts.ctx());
        let clock = clock::create_for_testing(ts.ctx());
        build_request::create(
            test_helpers::poster_id(),
            test_helpers::poster(),
            bounty,
            test_helpers::requested_type_id(),
            true,
            test_helpers::far_future_ms(),
            vector[],
            vector[],
            &clock,
            ts.ctx(),
        );
        clock.destroy_for_testing();
    };

    // Cancel — bounty returned to poster
    ts::next_tx(&mut ts, test_helpers::poster());
    {
        let contract = ts::take_shared<BuildRequestContract<BOUNTY>>(&ts);
        build_request::cancel(contract, test_helpers::poster(), ts.ctx());
    };

    // Verify poster received bounty back
    ts::next_tx(&mut ts, test_helpers::poster());
    {
        let coin = ts::take_from_sender<coin::Coin<BOUNTY>>(&ts);
        assert!(coin.value() == test_helpers::bounty_amount());
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

// =========================================================================
// Cancel — wrong poster rejected
// =========================================================================

#[test]
#[expected_failure(abort_code = build_request::ENotPoster)]
fun test_cancel_wrong_poster() {
    let mut ts = ts::begin(@0x0);

    ts::next_tx(&mut ts, test_helpers::poster());
    {
        let bounty = coin::mint_for_testing<BOUNTY>(test_helpers::bounty_amount(), ts.ctx());
        let clock = clock::create_for_testing(ts.ctx());
        build_request::create(
            test_helpers::poster_id(),
            test_helpers::poster(),
            bounty,
            test_helpers::requested_type_id(),
            false,
            test_helpers::far_future_ms(),
            vector[],
            vector[],
            &clock,
            ts.ctx(),
        );
        clock.destroy_for_testing();
    };

    // Attempt cancel from wrong address
    ts::next_tx(&mut ts, test_helpers::builder());
    {
        let contract = ts::take_shared<BuildRequestContract<BOUNTY>>(&ts);
        build_request::cancel(contract, test_helpers::builder(), ts.ctx());
    };

    ts::end(ts);
}

// =========================================================================
// Expire after deadline
// =========================================================================

#[test]
fun test_expire_after_deadline() {
    let mut ts = ts::begin(@0x0);

    ts::next_tx(&mut ts, test_helpers::poster());
    {
        let bounty = coin::mint_for_testing<BOUNTY>(test_helpers::bounty_amount(), ts.ctx());
        let clock = clock::create_for_testing(ts.ctx());
        build_request::create(
            test_helpers::poster_id(),
            test_helpers::poster(),
            bounty,
            test_helpers::requested_type_id(),
            false,
            100, // short deadline
            vector[],
            vector[],
            &clock,
            ts.ctx(),
        );
        clock.destroy_for_testing();
    };

    // Expire — anyone can call after deadline
    ts::next_tx(&mut ts, test_helpers::builder());
    {
        let contract = ts::take_shared<BuildRequestContract<BOUNTY>>(&ts);
        let mut clock = clock::create_for_testing(ts.ctx());
        clock.set_for_testing(200);
        build_request::expire(contract, &clock, ts.ctx());
        clock.destroy_for_testing();
    };

    // Verify poster received bounty back
    ts::next_tx(&mut ts, test_helpers::poster());
    {
        let coin = ts::take_from_address<coin::Coin<BOUNTY>>(&ts, test_helpers::poster());
        assert!(coin.value() == test_helpers::bounty_amount());
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

// =========================================================================
// Expire before deadline rejected
// =========================================================================

#[test]
#[expected_failure(abort_code = build_request::EContractNotExpired)]
fun test_expire_before_deadline_fails() {
    let mut ts = ts::begin(@0x0);

    ts::next_tx(&mut ts, test_helpers::poster());
    {
        let bounty = coin::mint_for_testing<BOUNTY>(test_helpers::bounty_amount(), ts.ctx());
        let clock = clock::create_for_testing(ts.ctx());
        build_request::create(
            test_helpers::poster_id(),
            test_helpers::poster(),
            bounty,
            test_helpers::requested_type_id(),
            false,
            test_helpers::far_future_ms(),
            vector[],
            vector[],
            &clock,
            ts.ctx(),
        );
        clock.destroy_for_testing();
    };

    ts::next_tx(&mut ts, test_helpers::builder());
    {
        let contract = ts::take_shared<BuildRequestContract<BOUNTY>>(&ts);
        let clock = clock::create_for_testing(ts.ctx());
        build_request::expire(contract, &clock, ts.ctx());
        clock.destroy_for_testing();
    };

    ts::end(ts);
}

// =========================================================================
// Deadline in past rejected
// =========================================================================

#[test]
#[expected_failure(abort_code = build_request::EDeadlineInPast)]
fun test_create_deadline_in_past() {
    let mut ts = ts::begin(@0x0);

    ts::next_tx(&mut ts, test_helpers::poster());
    {
        let bounty = coin::mint_for_testing<BOUNTY>(test_helpers::bounty_amount(), ts.ctx());
        let mut clock = clock::create_for_testing(ts.ctx());
        clock.set_for_testing(500);
        build_request::create(
            test_helpers::poster_id(),
            test_helpers::poster(),
            bounty,
            test_helpers::requested_type_id(),
            false,
            100, // in the past
            vector[],
            vector[],
            &clock,
            ts.ctx(),
        );
        clock.destroy_for_testing();
    };

    ts::end(ts);
}

// =========================================================================
// Zero bounty rejected
// =========================================================================

#[test]
#[expected_failure(abort_code = build_request::EZeroBounty)]
fun test_create_zero_bounty() {
    let mut ts = ts::begin(@0x0);

    ts::next_tx(&mut ts, test_helpers::poster());
    {
        let bounty = coin::mint_for_testing<BOUNTY>(0, ts.ctx());
        let clock = clock::create_for_testing(ts.ctx());
        build_request::create(
            test_helpers::poster_id(),
            test_helpers::poster(),
            bounty,
            test_helpers::requested_type_id(),
            false,
            test_helpers::far_future_ms(),
            vector[],
            vector[],
            &clock,
            ts.ctx(),
        );
        clock.destroy_for_testing();
    };

    ts::end(ts);
}

// =========================================================================
// View functions
// =========================================================================

#[test]
fun test_view_functions() {
    let mut ts = ts::begin(@0x0);

    ts::next_tx(&mut ts, test_helpers::poster());
    {
        let bounty = coin::mint_for_testing<BOUNTY>(test_helpers::bounty_amount(), ts.ctx());
        let clock = clock::create_for_testing(ts.ctx());
        build_request::create(
            test_helpers::poster_id(),
            test_helpers::poster(),
            bounty,
            test_helpers::requested_type_id(),
            true,
            test_helpers::far_future_ms(),
            vector[],
            vector[],
            &clock,
            ts.ctx(),
        );
        clock.destroy_for_testing();
    };

    ts::next_tx(&mut ts, test_helpers::poster());
    {
        let contract = ts::take_shared<BuildRequestContract<BOUNTY>>(&ts);
        assert!(build_request::poster_id(&contract) == test_helpers::poster_id());
        assert!(build_request::poster_address(&contract) == test_helpers::poster());
        assert!(build_request::bounty_amount(&contract) == test_helpers::bounty_amount());
        assert!(build_request::bounty_balance(&contract) == test_helpers::bounty_amount());
        assert!(build_request::requested_type_id(&contract) == test_helpers::requested_type_id());
        assert!(build_request::require_corm_auth(&contract) == true);
        assert!(build_request::deadline_ms(&contract) == test_helpers::far_future_ms());
        assert!(build_request::builder_address(&contract).is_none());
        assert!(build_request::structure_id(&contract).is_none());
        assert!(build_request::contract_version(&contract) == 1);

        build_request::destroy_for_testing(contract);
    };

    ts::end(ts);
}
