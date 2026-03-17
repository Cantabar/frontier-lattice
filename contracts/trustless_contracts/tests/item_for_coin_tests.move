#[test_only]
module trustless_contracts::item_for_coin_tests;

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
use trustless_contracts::item_for_coin::{Self, ItemForCoinContract};

// =========================================================================
// Cancel returns items to poster
// =========================================================================

#[test]
fun test_cancel_item_for_coin_returns_items() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = test_helpers::create_test_ssu(&mut ts, poster_id);
    test_helpers::online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);
    test_helpers::authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);

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
            &character, &owner_cap, test_helpers::item_type_id(), test_helpers::item_quantity(), ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);

        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        item_for_coin::create<ESCROW, FILL>(
            &character, &mut storage_unit, item, test_helpers::wanted_amount(), true,
            test_helpers::far_future_ms(), vector[], vector[], &clock, ts::ctx(&mut ts),
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
        assert!(storage_unit.item_quantity(open_key, test_helpers::item_type_id()) == test_helpers::item_quantity());
        ts::return_shared(storage_unit);
    };

    // Cancel — items should return to poster's owned inventory
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let contract = ts::take_shared<ItemForCoinContract<ESCROW, FILL>>(&ts);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        item_for_coin::cancel(
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
        assert!(storage_unit.item_quantity(cap_id, test_helpers::item_type_id()) == test_helpers::item_quantity());
        ts::return_shared(poster_char);
        ts::return_shared(storage_unit);
    };

    ts::end(ts);
}

// =========================================================================
// Expire returns items to poster
// =========================================================================

#[test]
fun test_expire_item_for_coin_returns_items() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = test_helpers::create_test_ssu(&mut ts, poster_id);
    test_helpers::online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);
    test_helpers::authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);

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
            &character, &owner_cap, test_helpers::item_type_id(), test_helpers::item_quantity(), ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);

        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        item_for_coin::create<ESCROW, FILL>(
            &character, &mut storage_unit, item, test_helpers::wanted_amount(), true,
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
        let contract = ts::take_shared<ItemForCoinContract<ESCROW, FILL>>(&ts);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(200);

        item_for_coin::expire(
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
        assert!(storage_unit.item_quantity(cap_id, test_helpers::item_type_id()) == test_helpers::item_quantity());
        ts::return_shared(poster_char);
        ts::return_shared(storage_unit);
    };

    ts::end(ts);
}

// =========================================================================
// Fill releases items to filler
// =========================================================================

#[test]
fun test_fill_item_for_coin_full() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = test_helpers::create_test_ssu(&mut ts, poster_id);
    test_helpers::online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);
    test_helpers::authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);

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
            &character, &owner_cap, test_helpers::item_type_id(), test_helpers::item_quantity(), ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);

        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        item_for_coin::create<ESCROW, FILL>(
            &character, &mut storage_unit, item, test_helpers::wanted_amount(), false,
            test_helpers::far_future_ms(), vector[], vector[], &clock, ts::ctx(&mut ts),
        );
        clock.destroy_for_testing();
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    // Filler fills with 500 FILL coins
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<ItemForCoinContract<ESCROW, FILL>>(&ts);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let filler = ts::take_shared_by_id<Character>(&ts, filler_id);
        let fill_coin = coin::mint_for_testing<FILL>(test_helpers::wanted_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        item_for_coin::fill(
            &mut contract, &mut storage_unit, &poster, &filler,
            fill_coin, &clock, ts::ctx(&mut ts),
        );

        assert!(item_for_coin::filled_quantity(&contract) == test_helpers::wanted_amount());
        assert!(item_for_coin::items_released(&contract) == test_helpers::item_quantity());

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
        assert!(storage_unit.item_quantity(filler_cap_id, test_helpers::item_type_id()) == test_helpers::item_quantity());
        ts::return_shared(filler_char);
        ts::return_shared(storage_unit);
    };

    // Verify poster received fill coins
    ts::next_tx(&mut ts, user_a());
    {
        let payment = ts::take_from_sender<Coin<FILL>>(&ts);
        assert!(payment.value() == test_helpers::wanted_amount());
        ts::return_to_sender(&ts, payment);
    };

    ts::end(ts);
}
