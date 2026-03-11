#[test_only]
module tribe::tribe_tests;

use std::string::utf8;
use sui::{
    clock,
    coin,
    test_scenario as ts,
};
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
    TreasuryProposal,
};

// === Test coin — stand-in for EVE in unit tests ===
// On EVE Frontier testnet, deploy with Tribe<assets::EVE::EVE> instead.
#[test_only]
public struct TESTCOIN has drop {}

// === Constants ===
const LEADER_GAME_ID: u32 = 1001;
const MEMBER_GAME_ID: u32 = 1002;
const VOTE_THRESHOLD_51: u64 = 51;
const TRIBE_NAME: vector<u8> = b"Iron Vanguard";
const FAR_FUTURE_MS: u64 = 9_999_999_999_999;

// === Helpers ===

/// Sets up the world environment and creates two Characters.
/// Returns (leader_char_id, member_char_id).
fun setup_characters(ts: &mut ts::Scenario): (ID, ID) {
    test_helpers::setup_world(ts);

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
        let cap = tribe::create_tribe<TESTCOIN>(
            &leader,
            utf8(TRIBE_NAME),
            VOTE_THRESHOLD_51,
            ts::ctx(&mut ts),
        );
        // Verify cap fields
        assert!(tribe::cap_role(&cap) == tribe::role_leader());
        transfer::public_transfer(cap, user_a());
        ts::return_shared(leader);
    };

    // Verify the tribe was shared
    ts::next_tx(&mut ts, user_a());
    {
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        assert!(tribe::member_count(&tribe) == 1);
        assert!(tribe::vote_threshold(&tribe) == VOTE_THRESHOLD_51);
        assert!(tribe::treasury_balance(&tribe) == 0);
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
        let cap = tribe::create_tribe<TESTCOIN>(&leader, utf8(b""), VOTE_THRESHOLD_51, ts::ctx(&mut ts));
        tribe::destroy_tribe_cap_for_testing(cap);
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
        let cap = tribe::create_tribe<TESTCOIN>(
            &leader,
            utf8(TRIBE_NAME),
            VOTE_THRESHOLD_51,
            ts::ctx(&mut ts),
        );
        let _tribe_id = tribe::tribe_id(&cap);
        transfer::public_transfer(cap, user_a());
        ts::return_shared(leader);
    };

    // Add member
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
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
        let cap = tribe::create_tribe<TESTCOIN>(&leader, utf8(TRIBE_NAME), VOTE_THRESHOLD_51, ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(leader);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
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
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
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
        let cap = tribe::create_tribe<TESTCOIN>(&leader, utf8(TRIBE_NAME), VOTE_THRESHOLD_51, ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(leader);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
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
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
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
        let cap = tribe::create_tribe<TESTCOIN>(&leader, utf8(TRIBE_NAME), VOTE_THRESHOLD_51, ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(leader);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
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
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
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
        let cap = tribe::create_tribe<TESTCOIN>(&leader, utf8(TRIBE_NAME), VOTE_THRESHOLD_51, ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(leader);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let member_cap = tribe::add_member(&mut tribe, &leader_cap, &member, tribe::role_member(), ts::ctx(&mut ts));
        transfer::public_transfer(member_cap, user_b());

        // Issue a RepUpdateCap
        let rep_cap = tribe::issue_rep_update_cap(&tribe, &leader_cap, ts::ctx(&mut ts));
        let member_id_val = object::id(&member);

        // Use it to update rep (simulating contract_board cross-module call)
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
fun treasury_deposit_and_vote_execute() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_characters(&mut ts);

    // Create tribe
    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let cap = tribe::create_tribe<TESTCOIN>(&leader, utf8(TRIBE_NAME), VOTE_THRESHOLD_51, ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(leader);
    };

    // Add member (so we have 2 members; 51% of 2 = 1.02, so 2 votes required for majority)
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let member_cap = tribe::add_member(&mut tribe, &leader_cap, &member, tribe::role_member(), ts::ctx(&mut ts));
        transfer::public_transfer(member_cap, user_b());
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    // Deposit 1000 TESTCOIN into treasury
    ts::next_tx(&mut ts, user_a());
    {
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let test_coin = coin::mint_for_testing<TESTCOIN>(1000, ts::ctx(&mut ts));
        tribe::deposit_to_treasury(&mut tribe, test_coin);
        assert!(tribe::treasury_balance(&tribe) == 1000);
        ts::return_shared(tribe);
    };

    // Create a spend proposal (51% threshold with 2 members requires 2 votes)
    let proposal_id;
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        tribe::propose_treasury_spend(
            &tribe,
            &leader_cap,
            500,
            user_b(),
            FAR_FUTURE_MS,
            &clock,
            ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
    };

    // Get proposal id
    ts::next_tx(&mut ts, user_a());
    {
        let proposal = ts::take_shared<TreasuryProposal>(&ts);
        proposal_id = object::id(&proposal);
        assert!(tribe::proposal_vote_count(&proposal) == 0);
        assert!(!tribe::proposal_executed(&proposal));
        ts::return_shared(proposal);
    };

    // Leader votes
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut proposal = ts::take_shared_by_id<TreasuryProposal>(&ts, proposal_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        tribe::vote_on_proposal(&tribe, &mut proposal, &leader_cap, &clock);
        assert!(tribe::proposal_vote_count(&proposal) == 1);

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(proposal);
    };

    // Member votes
    ts::next_tx(&mut ts, user_b());
    {
        let member_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut proposal = ts::take_shared_by_id<TreasuryProposal>(&ts, proposal_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        tribe::vote_on_proposal(&tribe, &mut proposal, &member_cap, &clock);
        assert!(tribe::proposal_vote_count(&proposal) == 2);

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, member_cap);
        ts::return_shared(tribe);
        ts::return_shared(proposal);
    };

    // Execute proposal (threshold met: 2 votes, 2 members, 51%)
    ts::next_tx(&mut ts, user_a());
    {
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut proposal = ts::take_shared_by_id<TreasuryProposal>(&ts, proposal_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        tribe::execute_proposal(&mut tribe, &mut proposal, &clock, ts::ctx(&mut ts));

        assert!(tribe::proposal_executed(&proposal));
        assert!(tribe::treasury_balance(&tribe) == 500);

        clock.destroy_for_testing();
        ts::return_shared(tribe);
        ts::return_shared(proposal);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 8)]
fun execute_proposal_without_enough_votes_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let cap = tribe::create_tribe<TESTCOIN>(&leader, utf8(TRIBE_NAME), VOTE_THRESHOLD_51, ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(leader);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let test_coin = coin::mint_for_testing<TESTCOIN>(1000, ts::ctx(&mut ts));
        tribe::deposit_to_treasury(&mut tribe, test_coin);
        ts::return_shared(tribe);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        tribe::propose_treasury_spend(&tribe, &leader_cap, 500, user_b(), FAR_FUTURE_MS, &clock, ts::ctx(&mut ts));

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut proposal = ts::take_shared<TreasuryProposal>(&ts);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        // No votes cast — should fail threshold check
        tribe::execute_proposal(&mut tribe, &mut proposal, &clock, ts::ctx(&mut ts));

        clock.destroy_for_testing();
        ts::return_shared(tribe);
        ts::return_shared(proposal);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 7)]
fun double_vote_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, _) = setup_characters(&mut ts);

    ts::next_tx(&mut ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let cap = tribe::create_tribe<TESTCOIN>(&leader, utf8(TRIBE_NAME), VOTE_THRESHOLD_51, ts::ctx(&mut ts));
        transfer::public_transfer(cap, user_a());
        ts::return_shared(leader);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let test_coin = coin::mint_for_testing<TESTCOIN>(1000, ts::ctx(&mut ts));
        tribe::deposit_to_treasury(&mut tribe, test_coin);
        ts::return_shared(tribe);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        tribe::propose_treasury_spend(&tribe, &leader_cap, 100, user_b(), FAR_FUTURE_MS, &clock, ts::ctx(&mut ts));
        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
    };

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let mut proposal = ts::take_shared<TreasuryProposal>(&ts);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        tribe::vote_on_proposal(&tribe, &mut proposal, &leader_cap, &clock);
        // Second vote by the same character — should fail
        tribe::vote_on_proposal(&tribe, &mut proposal, &leader_cap, &clock);

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(proposal);
    };

    ts::end(ts);
}
