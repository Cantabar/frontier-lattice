#[test_only]
module trustless_contracts::multi_input_tests;

use std::string::utf8;
use sui::{
    clock,
    coin::{Self, Coin},
    test_scenario as ts,
};
use world::{
    character::Character,
    test_helpers::{user_a, user_b},
};
use trustless_contracts::test_helpers;
use trustless_contracts::multi_input::{Self, MultiInputContract};

// === Test coin witness ===
public struct BOUNTY has drop {}

// Slot type IDs representing items
const TYPE_CARBON_WEAVE: u64 = 1001;
const TYPE_BATCHED_CW: u64 = 1002;
const TYPE_ORE: u64 = 1003;

// === Helpers ===

fun dummy_ssu_id(): ID { object::id_from_address(@0xABCD) }

// =========================================================================
// Create — basic two-slot contract
// =========================================================================

#[test]
fun test_create_two_slots() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(1000, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        // 70 Batched CW slots (700 CW base-units at 10:1, 70 BCW at 1:1)
        multi_input::create<BOUNTY>(
            &poster, bounty,
            utf8(b"Build Chumaq components"),
            dummy_ssu_id(),
            vector[TYPE_CARBON_WEAVE, TYPE_BATCHED_CW],
            vector[700, 70],
            test_helpers::far_future_ms(),
            vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        assert!(multi_input::poster_id(&c) == poster_id);
        assert!(multi_input::total_required(&c) == 770);  // 700 + 70
        assert!(multi_input::total_filled(&c) == 0);
        assert!(multi_input::bounty_amount(&c) == 1000);
        assert!(multi_input::bounty_balance(&c) == 1000);
        assert!(!multi_input::is_complete(&c));
        assert!(multi_input::slot_required(&c, TYPE_CARBON_WEAVE) == 700);
        assert!(multi_input::slot_filled(&c, TYPE_CARBON_WEAVE) == 0);
        assert!(multi_input::slot_required(&c, TYPE_BATCHED_CW) == 70);
        assert!(multi_input::slot_filled(&c, TYPE_BATCHED_CW) == 0);
        ts::return_shared(c);
    };

    ts::end(ts);
}

// =========================================================================
// Fill — partial fill of one slot
// =========================================================================

#[test]
fun test_fill_slot_partial() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(1000, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Test"),
            dummy_ssu_id(),
            vector[TYPE_CARBON_WEAVE],
            vector[100],
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Filler fills 40 of 100 units
    ts::next_tx(&mut ts, user_b());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        multi_input::fill_slot_for_testing(
            &mut c, &filler, TYPE_CARBON_WEAVE, 40, &clock, ts::ctx(&mut ts),
        );

        // Payout: (40 * 1000) / 100 = 400
        assert!(multi_input::total_filled(&c) == 40);
        assert!(multi_input::slot_filled(&c, TYPE_CARBON_WEAVE) == 40);
        assert!(multi_input::bounty_balance(&c) == 600); // 1000 - 400
        assert!(multi_input::filler_contribution(&c, filler_id) == 40);
        assert!(!multi_input::is_complete(&c));

        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(filler);
    };

    // Verify filler received correct payout
    ts::next_tx(&mut ts, user_b());
    {
        let payout = ts::take_from_sender<Coin<BOUNTY>>(&ts);
        assert!(payout.value() == 400);
        ts::return_to_sender(&ts, payout);
    };

    ts::end(ts);
}

// =========================================================================
// Fill — two fillers across two slots, contract completes
// =========================================================================

#[test]
fun test_fill_multi_slot_completion() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    // 10 CW + 5 BCW = 15 total, bounty = 150 (10 per unit)
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(150, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Multi-slot test"),
            dummy_ssu_id(),
            vector[TYPE_CARBON_WEAVE, TYPE_BATCHED_CW],
            vector[10, 5],
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Filler fills all CW (10 units) — payout: (10 * 150) / 15 = 100
    ts::next_tx(&mut ts, user_b());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        multi_input::fill_slot_for_testing(
            &mut c, &filler, TYPE_CARBON_WEAVE, 10, &clock, ts::ctx(&mut ts),
        );

        assert!(multi_input::total_filled(&c) == 10);
        assert!(!multi_input::is_complete(&c));
        // Remaining bounty: 150 - 100 = 50
        assert!(multi_input::bounty_balance(&c) == 50);

        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(filler);
    };

    // CW payout received
    ts::next_tx(&mut ts, user_b());
    {
        let payout = ts::take_from_sender<Coin<BOUNTY>>(&ts);
        assert!(payout.value() == 100);
        ts::return_to_sender(&ts, payout);
    };

    // Filler fills all BCW (5 units) — payout: (5 * 150) / 15 = 50 + dust(0)
    ts::next_tx(&mut ts, user_b());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        multi_input::fill_slot_for_testing(
            &mut c, &filler, TYPE_BATCHED_CW, 5, &clock, ts::ctx(&mut ts),
        );

        assert!(multi_input::total_filled(&c) == 15);
        assert!(multi_input::is_complete(&c));
        assert!(multi_input::bounty_balance(&c) == 0);

        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(filler);
    };

    // BCW payout (50) received
    ts::next_tx(&mut ts, user_b());
    {
        let payout = ts::take_from_sender<Coin<BOUNTY>>(&ts);
        assert!(payout.value() == 50);
        ts::return_to_sender(&ts, payout);
    };

    ts::end(ts);
}

// =========================================================================
// Fill — bounty dust goes to final filler
// =========================================================================

#[test]
fun test_bounty_dust_to_final_filler() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    // 7 units, bounty = 10 — integer division means dust accumulates
    // payout per unit = 10/7 = 1 (integer), total paid = 7, dust = 3
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(10, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Dust test"),
            dummy_ssu_id(),
            vector[TYPE_ORE],
            vector[7],
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Fill 6 units — payout: (6 * 10) / 7 = 8 (floor), bounty remaining = 2
    ts::next_tx(&mut ts, user_b());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::fill_slot_for_testing(
            &mut c, &filler, TYPE_ORE, 6, &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(filler);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let p = ts::take_from_sender<Coin<BOUNTY>>(&ts);
        assert!(p.value() == 8); // floor(6*10/7) = 8
        ts::return_to_sender(&ts, p);
    };

    // Fill last unit — payout: (1 * 10) / 7 = 1, dust = 10 - 8 - 1 = 1 → swept
    ts::next_tx(&mut ts, user_b());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::fill_slot_for_testing(
            &mut c, &filler, TYPE_ORE, 1, &clock, ts::ctx(&mut ts),
        );
        assert!(multi_input::is_complete(&c));
        assert!(multi_input::bounty_balance(&c) == 0);
        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(filler);
    };

    // Filler receives payout + dust = 1 + 1 = 2 in two transfers; grab both
    ts::next_tx(&mut ts, user_b());
    {
        // Proportional payout (1)
        let p1 = ts::take_from_sender<Coin<BOUNTY>>(&ts);
        // Dust (1)
        let p2 = ts::take_from_sender<Coin<BOUNTY>>(&ts);
        assert!(p1.value() + p2.value() == 2);
        ts::return_to_sender(&ts, p1);
        ts::return_to_sender(&ts, p2);
    };

    ts::end(ts);
}

// =========================================================================
// Fill — overfill capped to slot remaining
// =========================================================================

#[test]
fun test_fill_capped_to_remaining() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Cap test"),
            dummy_ssu_id(),
            vector[TYPE_ORE],
            vector[10],
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Send 50 units when only 10 are needed — only 10 credited
    ts::next_tx(&mut ts, user_b());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::fill_slot_for_testing(
            &mut c, &filler, TYPE_ORE, 50, &clock, ts::ctx(&mut ts),
        );
        assert!(multi_input::total_filled(&c) == 10);
        assert!(multi_input::is_complete(&c));
        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Cancel — poster reclaims bounty
// =========================================================================

#[test]
fun test_cancel_returns_bounty() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(500, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Cancel me"),
            dummy_ssu_id(),
            vector[TYPE_ORE],
            vector[100],
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        multi_input::cancel(c, &poster, ts::ctx(&mut ts));
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let coin = ts::take_from_sender<Coin<BOUNTY>>(&ts);
        assert!(coin.value() == 500);
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

// =========================================================================
// Cancel — remaining bounty returned after partial fill
// =========================================================================

#[test]
fun test_cancel_after_partial_fill() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(1000, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Partial cancel"),
            dummy_ssu_id(),
            vector[TYPE_ORE],
            vector[100],
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Fill 25 of 100 — payout 250, remaining bounty 750
    ts::next_tx(&mut ts, user_b());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::fill_slot_for_testing(
            &mut c, &filler, TYPE_ORE, 25, &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(filler);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        multi_input::cancel(c, &poster, ts::ctx(&mut ts));
        ts::return_shared(poster);
    };

    // Poster receives remaining 750
    ts::next_tx(&mut ts, user_a());
    {
        let coin = ts::take_from_sender<Coin<BOUNTY>>(&ts);
        assert!(coin.value() == 750);
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

// =========================================================================
// Expire — bounty returned to poster
// =========================================================================

#[test]
fun test_expire_returns_bounty() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(200, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Short deadline"),
            dummy_ssu_id(),
            vector[TYPE_ORE],
            vector[50],
            100, // short deadline
            vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Anyone can expire after deadline
    ts::next_tx(&mut ts, user_b());
    {
        let c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(200); // past deadline
        multi_input::expire(c, &clock, ts::ctx(&mut ts));
        clock.destroy_for_testing();
    };

    ts::next_tx(&mut ts, user_a());
    {
        let coin = ts::take_from_sender<Coin<BOUNTY>>(&ts);
        assert!(coin.value() == 200);
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

// =========================================================================
// Error: deadline in past
// =========================================================================

#[test]
#[expected_failure(abort_code = 0)] // EDeadlineInPast (contract_utils)
fun test_deadline_in_past() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(100, ts::ctx(&mut ts));
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(1000);
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Stale"),
            dummy_ssu_id(),
            vector[TYPE_ORE], vector[10],
            500, // deadline < clock
            vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::end(ts);
}

// =========================================================================
// Error: zero bounty
// =========================================================================

#[test]
#[expected_failure(abort_code = 13)] // EInsufficientEscrow (contract_utils)
fun test_zero_bounty() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(0, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Zero"),
            dummy_ssu_id(),
            vector[TYPE_ORE], vector[10],
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::end(ts);
}

// =========================================================================
// Error: mismatched slot vectors
// =========================================================================

#[test]
#[expected_failure(abort_code = 100)] // ESlotLengthMismatch (module-specific)
fun test_slot_length_mismatch() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Mismatch"),
            dummy_ssu_id(),
            vector[TYPE_ORE, TYPE_CARBON_WEAVE], // 2 type IDs
            vector[10],                           // 1 quantity
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::end(ts);
}

// =========================================================================
// Error: fill unknown slot type
// =========================================================================

#[test]
#[expected_failure(abort_code = 102)] // EUnknownSlot (module-specific)
fun test_fill_unknown_slot() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Unknown slot"),
            dummy_ssu_id(),
            vector[TYPE_ORE], vector[10],
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        // TYPE_BATCHED_CW is not in the contract's slots
        multi_input::fill_slot_for_testing(
            &mut c, &filler, TYPE_BATCHED_CW, 5, &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Error: self-fill rejected
// =========================================================================

#[test]
#[expected_failure(abort_code = 5)] // ESelfFill (contract_utils)
fun test_self_fill_rejected() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Self fill"),
            dummy_ssu_id(),
            vector[TYPE_ORE], vector[10],
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::fill_slot_for_testing(
            &mut c, &poster, TYPE_ORE, 5, &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(poster);
    };

    ts::end(ts);
}

// =========================================================================
// Error: fill after deadline
// =========================================================================

#[test]
#[expected_failure(abort_code = 1)] // EContractExpired (contract_utils)
fun test_fill_after_deadline() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Short"),
            dummy_ssu_id(),
            vector[TYPE_ORE], vector[10],
            100, vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(200); // past deadline
        multi_input::fill_slot_for_testing(
            &mut c, &filler, TYPE_ORE, 5, &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Error: expire before deadline
// =========================================================================

#[test]
#[expected_failure(abort_code = 2)] // EContractNotExpired (contract_utils)
fun test_expire_before_deadline() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Long deadline"),
            dummy_ssu_id(),
            vector[TYPE_ORE], vector[10],
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let clock = clock::create_for_testing(ts::ctx(&mut ts)); // time = 0
        multi_input::expire(c, &clock, ts::ctx(&mut ts));
        clock.destroy_for_testing();
    };

    ts::end(ts);
}

// =========================================================================
// Error: cancel by non-poster
// =========================================================================

#[test]
#[expected_failure(abort_code = 6)] // ENotPoster (contract_utils)
fun test_cancel_not_poster() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Not yours"),
            dummy_ssu_id(),
            vector[TYPE_ORE], vector[10],
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        multi_input::cancel(c, &filler, ts::ctx(&mut ts));
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Access control — character allowlist
// =========================================================================

#[test]
fun test_access_control_character_allowed() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Allowlisted"),
            dummy_ssu_id(),
            vector[TYPE_ORE], vector[10],
            test_helpers::far_future_ms(),
            vector[filler_id], // only filler allowed
            vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::fill_slot_for_testing(
            &mut c, &filler, TYPE_ORE, 5, &clock, ts::ctx(&mut ts),
        );
        assert!(multi_input::total_filled(&c) == 5);
        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Access control — tribe allowlist
// =========================================================================

#[test]
fun test_access_control_tribe_allowed() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Tribe allowlisted"),
            dummy_ssu_id(),
            vector[TYPE_ORE], vector[10],
            test_helpers::far_future_ms(),
            vector[],
            vector[test_helpers::filler_tribe()], // tribe 200 allowed
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::fill_slot_for_testing(
            &mut c, &filler, TYPE_ORE, 10, &clock, ts::ctx(&mut ts),
        );
        assert!(multi_input::is_complete(&c));
        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Access control — unauthorized filler rejected
// =========================================================================

#[test]
#[expected_failure(abort_code = 4)] // EFillerNotAuthorized (contract_utils)
fun test_access_control_unauthorized() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_characters(&mut ts);
    let dummy_id = object::id_from_address(@0xDEAD);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Restricted"),
            dummy_ssu_id(),
            vector[TYPE_ORE], vector[10],
            test_helpers::far_future_ms(),
            vector[dummy_id], // only dummy allowed
            vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_b());
    {
        let mut c = ts::take_shared<MultiInputContract<BOUNTY>>(&ts);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::fill_slot_for_testing(
            &mut c, &filler, TYPE_ORE, 5, &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(c);
        ts::return_shared(filler);
    };

    ts::end(ts);
}

// =========================================================================
// Error: duplicate slot type IDs rejected
// =========================================================================

#[test]
#[expected_failure(abort_code = 106)] // EDuplicateSlot (module-specific)
fun test_duplicate_slot_rejected() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let bounty = coin::mint_for_testing<BOUNTY>(100, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        multi_input::create<BOUNTY>(
            &poster, bounty, utf8(b"Dupe"),
            dummy_ssu_id(),
            vector[TYPE_ORE, TYPE_ORE], // duplicate!
            vector[10, 20],
            test_helpers::far_future_ms(), vector[], vector[],
            &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::end(ts);
}
