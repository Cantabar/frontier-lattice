#[test_only]
module tribe::tribe_tests;

use std::string::utf8;
use sui::test_scenario as ts;
use world::{
    access::AdminACL,
    character::{Self, Character},
    object_registry::ObjectRegistry,
    test_helpers::{Self, admin, tenant, user_a, user_b},
};
use tribe::tribe::{
    Self,
    Tribe,
    TribeCap,
    TribeRegistry,
};

// === Constants ===
const LEADER_GAME_ID: u32 = 1001;
const MEMBER_GAME_ID: u32 = 1002;
const TRIBE_NAME: vector<u8> = b"Iron Vanguard";

// === Helpers ===

/// Sets up the world environment and creates two Characters.
/// Returns (leader_char_id, member_char_id).
fun setup_characters(ts: &mut ts::Scenario): (ID, ID) {
    test_helpers::setup_world(ts);

    // Create the TribeRegistry singleton
    ts::next_tx(ts, admin());
    tribe::create_registry_for_testing(ts::ctx(ts));

    // Create leader character
    ts::next_tx(ts, admin());
    let leader_id = {
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let char = character::create_character(
            &mut registry,
            &admin_acl,
            LEADER_GAME_ID,
            tenant(),
            100,
            user_a(),
            utf8(b"Alice"),
            ts::ctx(ts),
        );
        let id = object::id(&char);
        character::share_character(char, &admin_acl, ts::ctx(ts));
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        id
    };

    // Create member character
    ts::next_tx(ts, admin());
    let member_id = {
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let char = character::create_character(
            &mut registry,
            &admin_acl,
            MEMBER_GAME_ID,
            tenant(),
            100,
            user_b(),
            utf8(b"Bob"),
            ts::ctx(ts),
        );
        let id = object::id(&char);
        character::share_character(char, &admin_acl, ts::ctx(ts));
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        id
    };

    (leader_id, member_id)
}

// === Tests ===

#[test]
fun create_tribe_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(
            &mut tribe_registry,
            &leader,
            utf8(TRIBE_NAME),
            ts::ctx(&mut ts),
        );
        // Verify cap fields
        assert!(tribe::cap_role(&cap) == tribe::role_leader());
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    // Verify the tribe was shared
    ts::next_tx(&mut ts, user_a());
    {
        let tribe = ts::take_shared<Tribe>(&ts);
        assert!(tribe::member_count(&tribe) == 1);
        assert!(tribe::in_game_tribe_id(&tribe) == 100);
        ts::return_shared(tribe);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 0)]
fun create_tribe_empty_name_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(&mut tribe_registry, &leader, utf8(b""), ts::ctx(&mut ts));
        tribe::destroy_tribe_cap_for_testing(cap);
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };
    ts::end(ts);
}

#[test]
fun add_member_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_characters(&mut ts);
    // Create tribe
    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(
            &mut tribe_registry,
            &leader,
            utf8(TRIBE_NAME),
            ts::ctx(&mut ts),
        );
        let _tribe_id = tribe::tribe_id(&cap);
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    // Add member
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);

        let member_cap = tribe::add_member(
            &mut tribe,
            &leader_cap,
            &member,
            tribe::role_member(),
            ts::ctx(&mut ts),
        );

        assert!(tribe::member_count(&tribe) == 2);
        assert!(tribe::is_member(&tribe, object::id(&member)));
        assert!(tribe::cap_role(&member_cap) == tribe::role_member());

        transfer::public_transfer(member_cap, user_b());
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 1)]
fun add_member_as_member_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(&mut tribe_registry, &leader, utf8(TRIBE_NAME), ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);
        let member_char = ts::take_shared_by_id<Character>(&ts, member_id);
        let member_cap = tribe::add_member(&mut tribe, &leader_cap, &member_char, tribe::role_member(), ts::ctx(&mut ts));
        transfer::public_transfer(member_cap, user_b());
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(member_char);
    };

    // Now Bob tries to add another member
    ts::next_tx(&mut ts, user_b());
    {
        let member_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);
        // Reuse leader_id as a dummy "new member" — will fail on auth first
        let leader_char = ts::take_shared_by_id<Character>(&ts, leader_id);
        let bad_cap = tribe::add_member(&mut tribe, &member_cap, &leader_char, tribe::role_member(), ts::ctx(&mut ts));
        tribe::destroy_tribe_cap_for_testing(bad_cap);
        ts::return_to_sender(&ts, member_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader_char);
    };

    ts::end(ts);
}

#[test]
fun remove_member_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(&mut tribe_registry, &leader, utf8(TRIBE_NAME), ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let member_cap = tribe::add_member(&mut tribe, &leader_cap, &member, tribe::role_member(), ts::ctx(&mut ts));
        transfer::public_transfer(member_cap, user_b());
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);

        tribe::remove_member(&mut tribe, &leader_cap, object::id(&member));

        assert!(tribe::member_count(&tribe) == 1);
        assert!(!tribe::is_member(&tribe, object::id(&member)));

        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    ts::end(ts);
}

#[test]
fun update_reputation_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(&mut tribe_registry, &leader, utf8(TRIBE_NAME), ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let member_cap = tribe::add_member(&mut tribe, &leader_cap, &member, tribe::role_member(), ts::ctx(&mut ts));
        transfer::public_transfer(member_cap, user_b());
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let member_id_val = object::id(&member);

        tribe::update_reputation(&mut tribe, &leader_cap, member_id_val, 100, true);
        assert!(tribe::reputation_of(&tribe, member_id_val) == 100);

        tribe::update_reputation(&mut tribe, &leader_cap, member_id_val, 30, false);
        assert!(tribe::reputation_of(&tribe, member_id_val) == 70);

        // Clamped subtraction
        tribe::update_reputation(&mut tribe, &leader_cap, member_id_val, 999, false);
        assert!(tribe::reputation_of(&tribe, member_id_val) == 0);

        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    ts::end(ts);
}

#[test]
fun rep_update_cap_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(&mut tribe_registry, &leader, utf8(TRIBE_NAME), ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let member_cap = tribe::add_member(&mut tribe, &leader_cap, &member, tribe::role_member(), ts::ctx(&mut ts));
        transfer::public_transfer(member_cap, user_b());

        // Issue a RepUpdateCap
        let rep_cap = tribe::issue_rep_update_cap(&tribe, &leader_cap, ts::ctx(&mut ts));
        let member_id_val = object::id(&member);

        // Use it to update rep (simulating cross-module call)
        tribe::update_reputation_with_cap(&mut tribe, &rep_cap, member_id_val, 50, true);
        assert!(tribe::reputation_of(&tribe, member_id_val) == 50);

        tribe::destroy_rep_update_cap_for_testing(rep_cap);
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    ts::end(ts);
}

#[test]
fun self_join_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_characters(&mut ts);

    // Create tribe
    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(
            &mut tribe_registry, &leader, utf8(TRIBE_NAME), ts::ctx(&mut ts),
        );
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    // Bob self-joins (his character has tribe_id=100, matching the on-chain tribe)
    ts::next_tx(&mut ts, user_b());
    {
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let mut tribe = ts::take_shared<Tribe>(&ts);

        let member_cap = tribe::self_join(&mut tribe, &member, ts::ctx(&mut ts));

        assert!(tribe::member_count(&tribe) == 2);
        assert!(tribe::is_member(&tribe, object::id(&member)));
        assert!(tribe::cap_role(&member_cap) == tribe::role_member());

        transfer::public_transfer(member_cap, user_b());
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 8)] // ECharacterTribeMismatch
fun self_join_wrong_tribe_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, _) = setup_characters(&mut ts);

    // Create tribe (in-game tribe 100)
    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(
            &mut tribe_registry, &leader, utf8(TRIBE_NAME), ts::ctx(&mut ts),
        );
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    // Create a character with a different tribe_id (200)
    let outsider_addr = @0xC;
    ts::next_tx(&mut ts, admin());
    let outsider_id = {
        let mut registry = ts::take_shared<ObjectRegistry>(&ts);
        let admin_acl = ts::take_shared<AdminACL>(&ts);
        let char = character::create_character(
            &mut registry, &admin_acl,
            9999, tenant(), 200, outsider_addr, utf8(b"Charlie"), ts::ctx(&mut ts),
        );
        let id = object::id(&char);
        character::share_character(char, &admin_acl, ts::ctx(&mut ts));
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        id
    };

    // Charlie tries to self-join a tribe with in-game tribe 100 — should abort
    ts::next_tx(&mut ts, outsider_addr);
    {
        let outsider = ts::take_shared_by_id<Character>(&ts, outsider_id);
        let mut tribe = ts::take_shared<Tribe>(&ts);

        let cap = tribe::self_join(&mut tribe, &outsider, ts::ctx(&mut ts));
        tribe::destroy_tribe_cap_for_testing(cap);

        ts::return_shared(tribe);
        ts::return_shared(outsider);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 2)] // EAlreadyMember
fun self_join_already_member_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, _) = setup_characters(&mut ts);

    // Create tribe (leader is already a member)
    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(
            &mut tribe_registry, &leader, utf8(TRIBE_NAME), ts::ctx(&mut ts),
        );
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    // Leader tries to self-join again — should abort
    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe = ts::take_shared<Tribe>(&ts);

        let cap = tribe::self_join(&mut tribe, &leader, ts::ctx(&mut ts));
        tribe::destroy_tribe_cap_for_testing(cap);

        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    ts::end(ts);
}

#[test]
fun transfer_leadership_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_characters(&mut ts);

    // Create tribe
    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(&mut tribe_registry, &leader, utf8(TRIBE_NAME), ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    // Add member as Officer
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let member_cap = tribe::add_member(&mut tribe, &leader_cap, &member, tribe::role_officer(), ts::ctx(&mut ts));

        // Give the member some reputation to verify it's preserved
        tribe::update_reputation(&mut tribe, &leader_cap, object::id(&member), 42, true);

        transfer::public_transfer(member_cap, user_b());
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    // Transfer leadership from user_a to user_b
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);

        let (new_leader_cap, old_leader_cap) = tribe::transfer_leadership(
            &mut tribe, &leader_cap, member_id, ts::ctx(&mut ts),
        );

        // Verify the tribe state
        assert!(tribe::leader_character_id(&tribe) == member_id);
        assert!(tribe::member_count(&tribe) == 2);
        assert!(tribe::is_member(&tribe, leader_id));
        assert!(tribe::is_member(&tribe, member_id));
        assert!(tribe::member_role(&tribe, member_id) == tribe::role_leader());
        assert!(tribe::member_role(&tribe, leader_id) == tribe::role_officer());

        // Verify reputation was preserved
        assert!(tribe::reputation_of(&tribe, member_id) == 42);
        assert!(tribe::reputation_of(&tribe, leader_id) == 0);

        // Verify new caps
        assert!(tribe::cap_role(&new_leader_cap) == tribe::role_leader());
        assert!(tribe::cap_character_id(&new_leader_cap) == member_id);
        assert!(tribe::cap_role(&old_leader_cap) == tribe::role_officer());
        assert!(tribe::cap_character_id(&old_leader_cap) == leader_id);

        // Clean up: destroy old leader cap (now stale), transfer new caps
        tribe::destroy_tribe_cap_for_testing(leader_cap);
        transfer::public_transfer(new_leader_cap, user_b());
        transfer::public_transfer(old_leader_cap, user_a());
        ts::return_shared(tribe);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 9)] // ECannotTransferToSelf
fun transfer_leadership_to_self_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(&mut tribe_registry, &leader, utf8(TRIBE_NAME), ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);

        let (new_cap, old_cap) = tribe::transfer_leadership(
            &mut tribe, &leader_cap, leader_id, ts::ctx(&mut ts),
        );

        tribe::destroy_tribe_cap_for_testing(new_cap);
        tribe::destroy_tribe_cap_for_testing(old_cap);
        tribe::destroy_tribe_cap_for_testing(leader_cap);
        ts::return_shared(tribe);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 10)] // ERoleStale
fun stale_leader_cap_rejected_after_transfer() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_characters(&mut ts);

    // Create tribe
    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(&mut tribe_registry, &leader, utf8(TRIBE_NAME), ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    // Add member as Officer
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let member_cap = tribe::add_member(
            &mut tribe, &leader_cap, &member, tribe::role_officer(), ts::ctx(&mut ts),
        );
        transfer::public_transfer(member_cap, user_b());
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    // Transfer leadership; send valid Officer cap elsewhere to isolate stale cap
    ts::next_tx(&mut ts, user_a());
    {
        let stale_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);

        let (new_leader_cap, old_leader_cap) = tribe::transfer_leadership(
            &mut tribe, &stale_cap, member_id, ts::ctx(&mut ts),
        );

        transfer::public_transfer(new_leader_cap, user_b());
        transfer::public_transfer(old_leader_cap, @0xDEAD);
        ts::return_to_sender(&ts, stale_cap);
        ts::return_shared(tribe);
    };

    // Use stale cap (role=Leader but table says Officer) — should abort ERoleStale
    ts::next_tx(&mut ts, user_a());
    {
        let stale_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe>(&ts);
        tribe::remove_member(&mut tribe, &stale_cap, member_id);
        ts::return_to_sender(&ts, stale_cap);
        ts::return_shared(tribe);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 6)] // EInGameTribeAlreadyClaimed
fun create_duplicate_in_game_tribe_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_characters(&mut ts);

    // First tribe creation succeeds
    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(&mut tribe_registry, &leader, utf8(TRIBE_NAME), ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    // Second tribe creation with same in-game tribe (member has same tribe_id=100) — should fail
    ts::next_tx(&mut ts, user_b());
    {
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(&mut tribe_registry, &member, utf8(b"Rival Tribe"), ts::ctx(&mut ts));
        tribe::destroy_tribe_cap_for_testing(cap);
        ts::return_shared(tribe_registry);
        ts::return_shared(member);
    };

    ts::end(ts);
}

#[test]
fun tribe_registry_lookup_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let mut tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let cap = tribe::create_tribe(&mut tribe_registry, &leader, utf8(TRIBE_NAME), ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(tribe_registry);
        ts::return_shared(leader);
    };

    // Verify registry lookup
    ts::next_tx(&mut ts, user_a());
    {
        let tribe_registry = ts::take_shared<TribeRegistry>(&ts);
        let tribe = ts::take_shared<Tribe>(&ts);

        // Should find tribe for in-game tribe 100
        let found = tribe::tribe_for_game_id(&tribe_registry, 100);
        assert!(std::option::is_some(&found));
        assert!(*std::option::borrow(&found) == object::id(&tribe));

        // Should not find tribe for in-game tribe 999
        let not_found = tribe::tribe_for_game_id(&tribe_registry, 999);
        assert!(std::option::is_none(&not_found));

        ts::return_shared(tribe_registry);
        ts::return_shared(tribe);
    };

    ts::end(ts);
}
