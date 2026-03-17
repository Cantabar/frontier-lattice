#[test_only]
module trustless_contracts::transport_tests;

use sui::{
    clock,
    coin::{Self, Coin},
    test_scenario as ts,
};
use world::{
    access::OwnerCap,
    character::Character,
    storage_unit::StorageUnit,
    test_helpers::{user_a, user_b},
};
use trustless_contracts::test_helpers::{Self, ESCROW, FILL};
use trustless_contracts::transport::{Self, TransportContract};
use trustless_contracts::contract_utils;

// =========================================================================
// Transport — Create and Accept
// =========================================================================

#[test]
fun test_transport_create_and_accept() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = test_helpers::create_test_ssu(&mut ts, poster_id);
    test_helpers::online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);
    test_helpers::authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);
    let dest_ssu_id = object::id_from_address(@0x42);
    let stake_amount: u64 = 200;

    // Create transport
    ts::next_tx(&mut ts, user_a());
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(&ts, poster_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        let item = storage_unit.withdraw_by_owner(
            &character, &owner_cap, test_helpers::item_type_id(), test_helpers::item_quantity(), ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);

        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        transport::create<ESCROW, FILL>(
            &character, escrow, &mut storage_unit, item, dest_ssu_id,
            stake_amount, false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    // Verify items in open inventory and contract fields
    ts::next_tx(&mut ts, user_b());
    {
        let storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let open_key = storage_unit.open_storage_key();
        assert!(storage_unit.item_quantity(open_key, test_helpers::item_type_id()) == test_helpers::item_quantity());
        ts::return_shared(storage_unit);

        let contract = ts::take_shared<TransportContract<ESCROW, FILL>>(&ts);
        assert!(transport::stake_amount(&contract) == stake_amount);
        assert!(transport::target_quantity(&contract) == (test_helpers::item_quantity() as u64));
        assert!(transport::status(&contract) == contract_utils::status_open());
        ts::return_shared(contract);
    };

    // Courier accepts — items transfer to courier's player inventory
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<TransportContract<ESCROW, FILL>>(&ts);
        let courier = ts::take_shared_by_id<Character>(&ts, filler_id);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let stake = coin::mint_for_testing<FILL>(stake_amount, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        transport::accept(
            &mut contract, stake, &courier, &mut storage_unit, &clock, ts::ctx(&mut ts),
        );

        assert!(transport::status(&contract) == contract_utils::status_in_progress());
        assert!(transport::courier_stake_balance(&contract) == stake_amount);
        assert!(transport::courier_id(&contract) == option::some(filler_id));
        assert!(transport::items_released(&contract) == test_helpers::item_quantity());

        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(contract);
        ts::return_shared(courier);
    };

    // Verify items moved to courier's player inventory
    ts::next_tx(&mut ts, user_b());
    {
        let storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let courier_char = ts::take_shared_by_id<Character>(&ts, filler_id);
        let courier_cap_id = courier_char.owner_cap_id();
        assert!(storage_unit.item_quantity(courier_cap_id, test_helpers::item_type_id()) == test_helpers::item_quantity());
        ts::return_shared(courier_char);
        ts::return_shared(storage_unit);
    };

    ts::end(ts);
}

// =========================================================================
// Transport — Insufficient stake fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 100)] // EInsufficientStake
fun test_transport_insufficient_stake() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = test_helpers::create_test_ssu(&mut ts, poster_id);
    test_helpers::online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);
    test_helpers::authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);
    let dest_ssu_id = object::id_from_address(@0x42);

    // Create transport
    ts::next_tx(&mut ts, user_a());
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(&ts, poster_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        let item = storage_unit.withdraw_by_owner(
            &character, &owner_cap, test_helpers::item_type_id(), test_helpers::item_quantity(), ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);

        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        transport::create<ESCROW, FILL>(
            &character, escrow, &mut storage_unit, item, dest_ssu_id,
            200, false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    // Courier stakes too little — should abort
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<TransportContract<ESCROW, FILL>>(&ts);
        let courier = ts::take_shared_by_id<Character>(&ts, filler_id);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let stake = coin::mint_for_testing<FILL>(100, ts::ctx(&mut ts)); // need 200
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        transport::accept(
            &mut contract, stake, &courier, &mut storage_unit, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(contract);
        ts::return_shared(courier);
    };

    ts::end(ts);
}

// =========================================================================
// Expire Transport — stake forfeited to poster
// =========================================================================

#[test]
fun test_expire_transport_forfeits_stake() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = test_helpers::create_test_ssu(&mut ts, poster_id);
    test_helpers::online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);
    test_helpers::authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);
    let dest_ssu_id = object::id_from_address(@0x42);
    let stake_amount: u64 = 200;

    // Create transport
    ts::next_tx(&mut ts, user_a());
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(&ts, poster_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        let item = storage_unit.withdraw_by_owner(
            &character, &owner_cap, test_helpers::item_type_id(), test_helpers::item_quantity(), ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);

        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        transport::create<ESCROW, FILL>(
            &character, escrow, &mut storage_unit, item, dest_ssu_id,
            stake_amount, false, 100,
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    // Courier accepts
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<TransportContract<ESCROW, FILL>>(&ts);
        let courier = ts::take_shared_by_id<Character>(&ts, filler_id);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let stake = coin::mint_for_testing<FILL>(stake_amount, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        transport::accept(
            &mut contract, stake, &courier, &mut storage_unit, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(contract);
        ts::return_shared(courier);
    };

    // Expire — stake forfeited to poster (items stay with courier)
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let contract = ts::take_shared<TransportContract<ESCROW, FILL>>(&ts);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(200);

        transport::expire(
            contract, &poster, &mut storage_unit, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
        ts::return_shared(storage_unit);
    };

    // Poster receives escrow (1000 ESCROW) + forfeited stake (200 FILL)
    ts::next_tx(&mut ts, user_a());
    {
        let escrow_back = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(escrow_back.value() == test_helpers::escrow_amount());
        ts::return_to_sender(&ts, escrow_back);

        let forfeited_stake = ts::take_from_sender<Coin<FILL>>(&ts);
        assert!(forfeited_stake.value() == stake_amount);
        ts::return_to_sender(&ts, forfeited_stake);
    };

    ts::end(ts);
}

// =========================================================================
// Divisibility — Transport stake not divisible
// =========================================================================

#[test]
#[expected_failure(abort_code = 11)] // ENotDivisible
fun test_not_divisible_transport() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = test_helpers::create_test_ssu(&mut ts, poster_id);
    test_helpers::online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);
    test_helpers::authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);
    let dest_ssu_id = object::id_from_address(@0x42);

    ts::next_tx(&mut ts, user_a());
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(&ts, poster_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        let item = storage_unit.withdraw_by_owner(
            &character, &owner_cap, test_helpers::item_type_id(), test_helpers::item_quantity(), ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);

        // payment 1000 % 10 == 0, but stake 333 % 10 != 0 — should abort
        let escrow = coin::mint_for_testing<ESCROW>(1000, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        transport::create<ESCROW, FILL>(
            &character, escrow, &mut storage_unit, item, dest_ssu_id,
            333, false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    ts::end(ts);
}
