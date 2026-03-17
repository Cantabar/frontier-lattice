#[test_only]
module trustless_contracts::test_helpers;

use std::string::utf8;
use sui::{
    clock,
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

// === Test coin witnesses ===
public struct ESCROW has drop {}
public struct FILL has drop {}

// === Constants ===
const POSTER_GAME_ID: u32 = 1001;
const FILLER_GAME_ID: u32 = 1002;
const POSTER_TRIBE: u32 = 100;
const FILLER_TRIBE: u32 = 200;

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

// Exported constants
public fun far_future_ms(): u64 { 9_999_999_999_999 }
public fun escrow_amount(): u64 { 1000 }
public fun wanted_amount(): u64 { 500 }
public fun item_type_id(): u64 { 88069 }
public fun item_item_id(): u64 { 1000004145107 }
public fun item_volume(): u64 { 100 }
public fun item_quantity(): u32 { 10 }
public fun poster_tribe(): u32 { POSTER_TRIBE }
public fun filler_tribe(): u32 { FILLER_TRIBE }

// === Helpers ===

/// Sets up the world and creates two Characters (poster = user_a, filler = user_b).
public fun setup_characters(ts: &mut ts::Scenario): (ID, ID) {
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
public fun setup_ssu_characters(ts: &mut ts::Scenario): (ID, ID) {
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
public fun create_test_ssu(ts: &mut ts::Scenario, character_id: ID): (ID, ID) {
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
public fun online_test_ssu(
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

/// Mints items to a character's owned inventory on the SSU using a Character OwnerCap.
public fun mint_items_for_character(
    ts: &mut ts::Scenario,
    user: address,
    character_id: ID,
    storage_id: ID,
) {
    ts::next_tx(ts, user);
    {
        let mut character = ts::take_shared_by_id<Character>(ts, character_id);
        let (owner_cap, receipt) = character.borrow_owner_cap<Character>(
            ts::most_recent_receiving_ticket<OwnerCap<Character>>(&character_id),
            ts.ctx(),
        );
        let mut storage_unit = ts::take_shared_by_id<StorageUnit>(ts, storage_id);
        storage_unit.game_item_to_chain_inventory_test<Character>(
            &character, &owner_cap,
            item_item_id(), item_type_id(), item_volume(), item_quantity(),
            ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);
        ts::return_shared(character);
        ts::return_shared(storage_unit);
    };
}

/// Authorizes CormAuth on the SSU and mints items to poster's owned inventory.
public fun authorize_and_mint(
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
            item_item_id(), item_type_id(), item_volume(), item_quantity(),
            ts.ctx(),
        );
        character.return_owner_cap(owner_cap, receipt);
        ts::return_shared(character);
        ts::return_shared(storage_unit);
    };
}
