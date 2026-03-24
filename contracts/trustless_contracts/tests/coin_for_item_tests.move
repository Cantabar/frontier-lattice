#[test_only]
module trustless_contracts::coin_for_item_tests;

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
use corm_auth::corm_auth::CormAuth;
use trustless_contracts::test_helpers::{Self, ESCROW};
use trustless_contracts::coin_for_item::{Self, CoinForItemContract};
use trustless_contracts::contract_utils;

// =========================================================================
// Create CoinForItem
// =========================================================================

#[test]
fun test_create_coin_for_item() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);
    let dest_ssu_id = object::id_from_address(@0x42);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_item::create<ESCROW>(
            &poster, escrow, test_helpers::item_type_id(), test_helpers::item_quantity(),
            dest_ssu_id, true, false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<CoinForItemContract<ESCROW>>(&ts);
        assert!(coin_for_item::poster_id(&contract) == poster_id);
        assert!(coin_for_item::escrow_amount(&contract) == test_helpers::escrow_amount());
        assert!(coin_for_item::target_quantity(&contract) == (test_helpers::item_quantity() as u64));
        assert!(coin_for_item::allow_partial(&contract) == true);
        ts::return_shared(contract);
    };

    ts::end(ts);
}

// =========================================================================
// Fill deposits to poster's player inventory (default)
// =========================================================================

#[test]
fun test_fill_coin_for_item_to_player_inventory() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = test_helpers::create_test_ssu(&mut ts, poster_id);
    test_helpers::online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);

    // Authorize CormAuth extension
    ts::next_tx(&mut ts, user_a());
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(&ts, poster_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        storage_unit.authorize_extension<CormAuth>(&owner_cap);
        character.return_owner_cap(owner_cap, receipt);
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    // Mint items to filler's player inventory
    test_helpers::mint_items_for_character(&mut ts, user_b(), filler_id, storage_id);

    // Create CoinForItem: use_owner_inventory = false
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_item::create<ESCROW>(
            &poster, escrow, test_helpers::item_type_id(), test_helpers::item_quantity(),
            object::id_from_address(object::id_to_address(&storage_id)),
            false, false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Filler withdraws items and fills the contract
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForItemContract<ESCROW>>(&ts);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let mut filler = ts::take_shared_by_id<Character>(&ts, filler_id);

        let (owner_cap, receipt) = filler.borrow_owner_cap<Character>(
            ts::most_recent_receiving_ticket<OwnerCap<Character>>(&filler_id),
            ts.ctx(),
        );
        let item = storage_unit.withdraw_by_owner(
            &filler, &owner_cap, test_helpers::item_type_id(), test_helpers::item_quantity(), ts.ctx(),
        );
        filler.return_owner_cap(owner_cap, receipt);

        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        coin_for_item::fill(
            &mut contract, &mut storage_unit, &poster, &filler,
            item, &clock, ts::ctx(&mut ts),
        );

        assert!(coin_for_item::filled_quantity(&contract) == (test_helpers::item_quantity() as u64));
        assert!(coin_for_item::status(&contract) == contract_utils::status_completed());

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(storage_unit);
        ts::return_shared(poster);
        ts::return_shared(filler);
    };

    // Verify items in poster's PLAYER inventory
    ts::next_tx(&mut ts, user_a());
    {
        let storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let poster_char = ts::take_shared_by_id<Character>(&ts, poster_id);
        let poster_cap_id = poster_char.owner_cap_id();
        assert!(storage_unit.item_quantity(poster_cap_id, test_helpers::item_type_id()) == test_helpers::item_quantity());
        ts::return_shared(poster_char);
        ts::return_shared(storage_unit);
    };

    // Verify filler received escrow payout
    ts::next_tx(&mut ts, user_b());
    {
        let payout = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(payout.value() == test_helpers::escrow_amount());
        ts::return_to_sender(&ts, payout);
    };

    ts::end(ts);
}

// =========================================================================
// Non-owner poster: items delivered to poster's player inventory
// =========================================================================

/// Player B (filler_id/user_b) creates a CoinForItem on Player A's SSU.
/// Filler delivers items → items land in Player B's player inventory,
/// not Player A's owner inventory.
#[test]
fun test_nonowner_poster_coin_for_item() {
    let mut ts = ts::begin(@0x0);
    // poster_id = user_a (SSU owner), filler_id = user_b
    let (poster_id, filler_id) = test_helpers::setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = test_helpers::create_test_ssu(&mut ts, poster_id);
    test_helpers::online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);

    // Authorize CormAuth on SSU (SSU owner does this)
    ts::next_tx(&mut ts, user_a());
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(&ts, poster_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        storage_unit.authorize_extension<CormAuth>(&owner_cap);
        character.return_owner_cap(owner_cap, receipt);
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    // Mint items to SSU owner's inventory so the filler has something to deliver
    test_helpers::authorize_and_mint(&mut ts, user_a(), poster_id, storage_id);

    // NON-OWNER (user_b / filler_id) creates CoinForItem with use_owner_inventory = false
    ts::next_tx(&mut ts, user_b());
    {
        let nonowner = ts::take_shared_by_id<Character>(&ts, filler_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_item::create<ESCROW>(
            &nonowner, escrow, test_helpers::item_type_id(), test_helpers::item_quantity(),
            object::id_from_address(object::id_to_address(&storage_id)),
            false, false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(nonowner);
    };

    // SSU owner (poster_id/user_a) fills by withdrawing from their own inventory
    ts::next_tx(&mut ts, user_a());
    {
        let mut contract = ts::take_shared<CoinForItemContract<ESCROW>>(&ts);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let nonowner = ts::take_shared_by_id<Character>(&ts, filler_id);
        let mut filler_char = ts::take_shared_by_id<Character>(&ts, poster_id);

        let (owner_cap, receipt) = filler_char.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        let item = storage_unit.withdraw_by_owner(
            &filler_char, &owner_cap, test_helpers::item_type_id(), test_helpers::item_quantity(), ts.ctx(),
        );
        filler_char.return_owner_cap(owner_cap, receipt);

        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        coin_for_item::fill(
            &mut contract, &mut storage_unit, &nonowner, &filler_char,
            item, &clock, ts::ctx(&mut ts),
        );

        assert!(coin_for_item::status(&contract) == contract_utils::status_completed());

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(storage_unit);
        ts::return_shared(nonowner);
        ts::return_shared(filler_char);
    };

    // Verify items landed in NON-OWNER's (filler_id) player inventory — NOT the SSU owner inventory
    ts::next_tx(&mut ts, user_b());
    {
        let storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let nonowner_char = ts::take_shared_by_id<Character>(&ts, filler_id);
        let nonowner_cap_id = nonowner_char.owner_cap_id();
        assert!(storage_unit.item_quantity(nonowner_cap_id, test_helpers::item_type_id()) == test_helpers::item_quantity());
        ts::return_shared(nonowner_char);
        ts::return_shared(storage_unit);
    };

    ts::end(ts);
}

// =========================================================================
// Fill deposits to SSU owner inventory
// =========================================================================

#[test]
fun test_fill_coin_for_item_to_owner_inventory() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, filler_id) = test_helpers::setup_ssu_characters(&mut ts);
    let (storage_id, nwn_id) = test_helpers::create_test_ssu(&mut ts, poster_id);
    test_helpers::online_test_ssu(&mut ts, user_a(), poster_id, storage_id, nwn_id);

    // Authorize CormAuth
    ts::next_tx(&mut ts, user_a());
    {
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let mut character = ts::take_shared_by_id<Character>(&ts, poster_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::most_recent_receiving_ticket<OwnerCap<StorageUnit>>(&poster_id),
            ts.ctx(),
        );
        storage_unit.authorize_extension<CormAuth>(&owner_cap);
        character.return_owner_cap(owner_cap, receipt);
        ts::return_shared(storage_unit);
        ts::return_shared(character);
    };

    // Mint items to filler's player inventory
    test_helpers::mint_items_for_character(&mut ts, user_b(), filler_id, storage_id);

    // Create CoinForItem: use_owner_inventory = true
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(test_helpers::escrow_amount(), ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_item::create<ESCROW>(
            &poster, escrow, test_helpers::item_type_id(), test_helpers::item_quantity(),
            object::id_from_address(object::id_to_address(&storage_id)),
            false, true, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    // Filler withdraws items and fills the contract
    ts::next_tx(&mut ts, user_b());
    {
        let mut contract = ts::take_shared<CoinForItemContract<ESCROW>>(&ts);
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let mut filler = ts::take_shared_by_id<Character>(&ts, filler_id);

        let (owner_cap, receipt) = filler.borrow_owner_cap<Character>(
            ts::most_recent_receiving_ticket<OwnerCap<Character>>(&filler_id),
            ts.ctx(),
        );
        let item = storage_unit.withdraw_by_owner(
            &filler, &owner_cap, test_helpers::item_type_id(), test_helpers::item_quantity(), ts.ctx(),
        );
        filler.return_owner_cap(owner_cap, receipt);

        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        coin_for_item::fill(
            &mut contract, &mut storage_unit, &poster, &filler,
            item, &clock, ts::ctx(&mut ts),
        );

        assert!(coin_for_item::filled_quantity(&contract) == (test_helpers::item_quantity() as u64));
        assert!(coin_for_item::status(&contract) == contract_utils::status_completed());

        clock.destroy_for_testing();
        ts::return_shared(contract);
        ts::return_shared(storage_unit);
        ts::return_shared(poster);
        ts::return_shared(filler);
    };

    // Verify items in SSU's OWNER inventory
    ts::next_tx(&mut ts, user_a());
    {
        let storage_unit = ts::take_shared_by_id<StorageUnit>(&ts, storage_id);
        let ssu_owner_cap_id = storage_unit.owner_cap_id();
        assert!(storage_unit.item_quantity(ssu_owner_cap_id, test_helpers::item_type_id()) == test_helpers::item_quantity());
        ts::return_shared(storage_unit);
    };

    // Verify filler received escrow payout
    ts::next_tx(&mut ts, user_b());
    {
        let payout = ts::take_from_sender<Coin<ESCROW>>(&ts);
        assert!(payout.value() == test_helpers::escrow_amount());
        ts::return_to_sender(&ts, payout);
    };

    ts::end(ts);
}

// =========================================================================
// Divisibility — CoinForItem not divisible fails
// =========================================================================

#[test]
#[expected_failure(abort_code = 11)] // ENotDivisible
fun test_not_divisible_coin_for_item() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);
    let dest_ssu_id = object::id_from_address(@0x42);

    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        // 1000 % 3 != 0 — should abort
        let escrow = coin::mint_for_testing<ESCROW>(1000, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_item::create<ESCROW>(
            &poster, escrow, 88069, 3, dest_ssu_id, true, false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::end(ts);
}

// =========================================================================
// Divisibility skipped when allow_partial = false — CoinForItem
// =========================================================================

#[test]
fun test_non_divisible_coin_for_item_no_partial() {
    let mut ts = ts::begin(@0x0);
    let (poster_id, _) = test_helpers::setup_characters(&mut ts);
    let dest_ssu_id = object::id_from_address(@0x42);

    // 1000 % 3 != 0 — would abort with partial, but succeeds with no-partial
    ts::next_tx(&mut ts, user_a());
    {
        let poster = ts::take_shared_by_id<Character>(&ts, poster_id);
        let escrow = coin::mint_for_testing<ESCROW>(1000, ts::ctx(&mut ts));
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        coin_for_item::create<ESCROW>(
            &poster, escrow, 88069, 3, dest_ssu_id, false, false, test_helpers::far_future_ms(),
            vector[], vector[], &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_shared(poster);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let contract = ts::take_shared<CoinForItemContract<ESCROW>>(&ts);
        assert!(coin_for_item::escrow_amount(&contract) == 1000);
        assert!(coin_for_item::target_quantity(&contract) == 3);
        assert!(coin_for_item::allow_partial(&contract) == false);
        ts::return_shared(contract);
    };

    ts::end(ts);
}
