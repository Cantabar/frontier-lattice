#[test_only]
module contract_board::contract_board_tests;

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
use tribe::tribe::{Self, Tribe, TribeCap, RepUpdateCap};
use contract_board::contract_board::{Self, JobPosting};

// === Test coin — stand-in for EVE in unit tests ===
#[test_only]
public struct TESTCOIN has drop {}

// === Constants ===
const LEADER_GAME_ID: u32 = 1001;
const MEMBER_GAME_ID: u32 = 1002;
const VOTE_THRESHOLD_51: u64 = 51;
const TRIBE_NAME: vector<u8> = b"Iron Vanguard";
const JOB_DEADLINE_MS: u64 = 9_999_999_999_999;
const ESCROW_AMOUNT: u64 = 1000;
const JOB_DESCRIPTION: vector<u8> = b"Deliver 100 units of ore to Alpha Station";

// === Helpers ===

/// Sets up the world, creates two characters, a tribe, and adds member.
/// Returns (leader_char_id, member_char_id).
fun setup_world_and_characters(ts: &mut ts::Scenario): (ID, ID) {
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

/// Creates a tribe and adds the member. Returns after both caps are transferred.
fun setup_tribe_with_member(ts: &mut ts::Scenario, leader_id: ID, member_id: ID) {
    // Create tribe
    ts::next_tx(ts, user_a());
    {
        let leader = ts::take_shared_by_id<Character>(ts, leader_id);
        let cap = tribe::create_tribe<TESTCOIN>(
            &leader,
            utf8(TRIBE_NAME),
            VOTE_THRESHOLD_51,
            ts::ctx(ts),
        );
        transfer::public_transfer(cap, user_a());
        ts::return_shared(leader);
    };

    // Add member
    ts::next_tx(ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(ts);
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(ts);
        let member = ts::take_shared_by_id<Character>(ts, member_id);
        let member_cap = tribe::add_member(
            &mut tribe,
            &leader_cap,
            &member,
            tribe::role_member(),
            ts::ctx(ts),
        );
        transfer::public_transfer(member_cap, user_b());
        ts::return_to_sender(ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };
}

/// Creates a default delivery completion type for tests.
fun test_completion_type(): contract_board::CompletionType {
    contract_board::completion_delivery(
        object::id_from_address(@0x42), // dummy storage_unit_id
        42,   // type_id
        100,  // quantity
    )
}

// === Tests ===

#[test]
fun create_job_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    // Create job
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let escrow = coin::mint_for_testing<TESTCOIN>(ESCROW_AMOUNT, ts::ctx(&mut ts));

        contract_board::create_job(
            &tribe,
            &leader_cap,
            &leader,
            utf8(JOB_DESCRIPTION),
            test_completion_type(),
            escrow,
            JOB_DEADLINE_MS,
            0, // no min reputation
            &clock,
            ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    // Verify the job was shared with correct fields
    ts::next_tx(&mut ts, user_a());
    {
        let job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);
        assert!(contract_board::job_poster_id(&job) == leader_id);
        assert!(contract_board::job_reward_amount(&job) == ESCROW_AMOUNT);
        assert!(contract_board::job_status(&job) == contract_board::status_open());
        assert!(contract_board::job_min_reputation(&job) == 0);
        assert!(option::is_none(&contract_board::job_assignee_id(&job)));
        ts::return_shared(job);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 0)] // EDescriptionEmpty
fun create_job_empty_description_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let escrow = coin::mint_for_testing<TESTCOIN>(ESCROW_AMOUNT, ts::ctx(&mut ts));

        contract_board::create_job(
            &tribe,
            &leader_cap,
            &leader,
            utf8(b""), // empty description
            test_completion_type(),
            escrow,
            JOB_DEADLINE_MS,
            0,
            &clock,
            ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };
    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 6)] // EInsufficientEscrow
fun create_job_zero_escrow_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let escrow = coin::mint_for_testing<TESTCOIN>(0, ts::ctx(&mut ts));

        contract_board::create_job(
            &tribe,
            &leader_cap,
            &leader,
            utf8(JOB_DESCRIPTION),
            test_completion_type(),
            escrow,
            JOB_DEADLINE_MS,
            0,
            &clock,
            ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };
    ts::end(ts);
}

#[test]
fun accept_job_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    // Create job
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let escrow = coin::mint_for_testing<TESTCOIN>(ESCROW_AMOUNT, ts::ctx(&mut ts));

        contract_board::create_job(
            &tribe, &leader_cap, &leader,
            utf8(JOB_DESCRIPTION), test_completion_type(), escrow,
            JOB_DEADLINE_MS, 0, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    // Accept job as member
    ts::next_tx(&mut ts, user_b());
    {
        let member_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        contract_board::accept_job(&mut job, &tribe, &member_cap, &member, &clock);

        assert!(contract_board::job_status(&job) == contract_board::status_assigned());
        assert!(option::contains(&contract_board::job_assignee_id(&job), &member_id));

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, member_cap);
        ts::return_shared(job);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 10)] // ESelfAssign
fun accept_job_self_assign_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    // Create job
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let escrow = coin::mint_for_testing<TESTCOIN>(ESCROW_AMOUNT, ts::ctx(&mut ts));

        contract_board::create_job(
            &tribe, &leader_cap, &leader,
            utf8(JOB_DESCRIPTION), test_completion_type(), escrow,
            JOB_DEADLINE_MS, 0, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    // Poster tries to accept own job
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        contract_board::accept_job(&mut job, &tribe, &leader_cap, &leader, &clock);

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(job);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 7)] // EReputationTooLow
fun accept_job_low_reputation_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    // Create job with min_reputation = 100
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let escrow = coin::mint_for_testing<TESTCOIN>(ESCROW_AMOUNT, ts::ctx(&mut ts));

        contract_board::create_job(
            &tribe, &leader_cap, &leader,
            utf8(JOB_DESCRIPTION), test_completion_type(), escrow,
            JOB_DEADLINE_MS,
            100, // min reputation = 100
            &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    // Member (rep=0) tries to accept — should fail
    ts::next_tx(&mut ts, user_b());
    {
        let member_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        contract_board::accept_job(&mut job, &tribe, &member_cap, &member, &clock);

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, member_cap);
        ts::return_shared(job);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    ts::end(ts);
}

#[test]
fun confirm_completion_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    // Create job
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let escrow = coin::mint_for_testing<TESTCOIN>(ESCROW_AMOUNT, ts::ctx(&mut ts));

        contract_board::create_job(
            &tribe, &leader_cap, &leader,
            utf8(JOB_DESCRIPTION), test_completion_type(), escrow,
            JOB_DEADLINE_MS, 0, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    // Accept job
    ts::next_tx(&mut ts, user_b());
    {
        let member_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        contract_board::accept_job(&mut job, &tribe, &member_cap, &member, &clock);

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, member_cap);
        ts::return_shared(job);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    // Poster confirms completion — job consumed, escrow to assignee
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);

        contract_board::confirm_completion(job, &leader_cap, ts::ctx(&mut ts));
        // job is consumed — do not return

        ts::return_to_sender(&ts, leader_cap);
    };

    // Verify escrow was transferred to assignee (user_b)
    ts::next_tx(&mut ts, user_b());
    {
        let coin = ts::take_from_sender<Coin<TESTCOIN>>(&ts);
        assert!(coin.value() == ESCROW_AMOUNT);
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

#[test]
fun confirm_completion_with_rep_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    // Issue RepUpdateCap
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let rep_cap = tribe::issue_rep_update_cap(&tribe, &leader_cap, ts::ctx(&mut ts));
        transfer::public_transfer(rep_cap, user_a());
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
    };

    // Create job
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let escrow = coin::mint_for_testing<TESTCOIN>(ESCROW_AMOUNT, ts::ctx(&mut ts));

        contract_board::create_job(
            &tribe, &leader_cap, &leader,
            utf8(JOB_DESCRIPTION), test_completion_type(), escrow,
            JOB_DEADLINE_MS, 0, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    // Accept job
    ts::next_tx(&mut ts, user_b());
    {
        let member_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        contract_board::accept_job(&mut job, &tribe, &member_cap, &member, &clock);

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, member_cap);
        ts::return_shared(job);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    // Confirm with reputation award
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let rep_cap = ts::take_from_sender<RepUpdateCap>(&ts);
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);

        contract_board::confirm_completion_with_rep(
            job, &mut tribe, &rep_cap, &leader_cap, 50, ts::ctx(&mut ts),
        );

        // Verify reputation was updated
        assert!(tribe::reputation_of(&tribe, member_id) == 50);

        ts::return_to_sender(&ts, leader_cap);
        ts::return_to_sender(&ts, rep_cap);
        ts::return_shared(tribe);
    };

    // Verify escrow was transferred to assignee
    ts::next_tx(&mut ts, user_b());
    {
        let coin = ts::take_from_sender<Coin<TESTCOIN>>(&ts);
        assert!(coin.value() == ESCROW_AMOUNT);
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

#[test]
fun cancel_job_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    // Create job
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let escrow = coin::mint_for_testing<TESTCOIN>(ESCROW_AMOUNT, ts::ctx(&mut ts));

        contract_board::create_job(
            &tribe, &leader_cap, &leader,
            utf8(JOB_DESCRIPTION), test_completion_type(), escrow,
            JOB_DEADLINE_MS, 0, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    // Cancel job — escrow returned to poster
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);

        contract_board::cancel_job(job, &leader_cap, ts::ctx(&mut ts));

        ts::return_to_sender(&ts, leader_cap);
    };

    // Verify escrow returned to poster (user_a)
    ts::next_tx(&mut ts, user_a());
    {
        let coin = ts::take_from_sender<Coin<TESTCOIN>>(&ts);
        assert!(coin.value() == ESCROW_AMOUNT);
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 1)] // EJobNotOpen
fun cancel_assigned_job_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    // Create job
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let escrow = coin::mint_for_testing<TESTCOIN>(ESCROW_AMOUNT, ts::ctx(&mut ts));

        contract_board::create_job(
            &tribe, &leader_cap, &leader,
            utf8(JOB_DESCRIPTION), test_completion_type(), escrow,
            JOB_DEADLINE_MS, 0, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    // Accept job
    ts::next_tx(&mut ts, user_b());
    {
        let member_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let member = ts::take_shared_by_id<Character>(&ts, member_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        contract_board::accept_job(&mut job, &tribe, &member_cap, &member, &clock);

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, member_cap);
        ts::return_shared(job);
        ts::return_shared(tribe);
        ts::return_shared(member);
    };

    // Try to cancel assigned job — should fail
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);

        contract_board::cancel_job(job, &leader_cap, ts::ctx(&mut ts));

        ts::return_to_sender(&ts, leader_cap);
    };

    ts::end(ts);
}

#[test]
fun expire_job_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    let deadline = 5000u64;

    // Create job with a short deadline
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let escrow = coin::mint_for_testing<TESTCOIN>(ESCROW_AMOUNT, ts::ctx(&mut ts));

        contract_board::create_job(
            &tribe, &leader_cap, &leader,
            utf8(JOB_DESCRIPTION), test_completion_type(), escrow,
            deadline, 0, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    // Expire the job (clock past deadline)
    ts::next_tx(&mut ts, user_b()); // anyone can call expire
    {
        let job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);
        let mut clock = clock::create_for_testing(ts::ctx(&mut ts));
        clock.set_for_testing(deadline + 1);

        contract_board::expire_job(job, &clock, ts::ctx(&mut ts));

        clock.destroy_for_testing();
    };

    // Verify escrow returned to poster (user_a), even though user_b triggered expiry
    ts::next_tx(&mut ts, user_a());
    {
        let coin = ts::take_from_sender<Coin<TESTCOIN>>(&ts);
        assert!(coin.value() == ESCROW_AMOUNT);
        ts::return_to_sender(&ts, coin);
    };

    ts::end(ts);
}

#[test]
fun create_job_from_treasury_success() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    // Deposit 2000 into tribe treasury
    ts::next_tx(&mut ts, user_a());
    {
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let test_coin = coin::mint_for_testing<TESTCOIN>(2000, ts::ctx(&mut ts));
        tribe::deposit_to_treasury(&mut tribe, test_coin);
        assert!(tribe::treasury_balance(&tribe) == 2000);
        ts::return_shared(tribe);
    };

    // Create job from treasury
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let mut tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        contract_board::create_job_from_treasury(
            &mut tribe,
            &leader_cap,
            &leader,
            utf8(JOB_DESCRIPTION),
            test_completion_type(),
            ESCROW_AMOUNT,
            JOB_DEADLINE_MS,
            0,
            &clock,
            ts::ctx(&mut ts),
        );

        // Treasury should be reduced by escrow amount
        assert!(tribe::treasury_balance(&tribe) == 1000); // 2000 - 1000

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    // Verify job was created with correct fields
    ts::next_tx(&mut ts, user_a());
    {
        let job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);
        assert!(contract_board::job_poster_id(&job) == leader_id);
        assert!(contract_board::job_reward_amount(&job) == ESCROW_AMOUNT);
        assert!(contract_board::job_status(&job) == contract_board::status_open());
        ts::return_shared(job);
    };

    ts::end(ts);
}

#[test]
#[expected_failure(abort_code = 4)] // EJobNotExpired
fun expire_before_deadline_fails() {
    let mut ts = ts::begin(@0x0);
    let (leader_id, member_id) = setup_world_and_characters(&mut ts);
    setup_tribe_with_member(&mut ts, leader_id, member_id);

    // Create job
    ts::next_tx(&mut ts, user_a());
    {
        let leader_cap = ts::take_from_sender<TribeCap>(&ts);
        let tribe = ts::take_shared<Tribe<TESTCOIN>>(&ts);
        let leader = ts::take_shared_by_id<Character>(&ts, leader_id);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));
        let escrow = coin::mint_for_testing<TESTCOIN>(ESCROW_AMOUNT, ts::ctx(&mut ts));

        contract_board::create_job(
            &tribe, &leader_cap, &leader,
            utf8(JOB_DESCRIPTION), test_completion_type(), escrow,
            JOB_DEADLINE_MS, 0, &clock, ts::ctx(&mut ts),
        );

        clock.destroy_for_testing();
        ts::return_to_sender(&ts, leader_cap);
        ts::return_shared(tribe);
        ts::return_shared(leader);
    };

    // Try to expire before deadline — should fail
    ts::next_tx(&mut ts, user_a());
    {
        let job = ts::take_shared<JobPosting<TESTCOIN>>(&ts);
        let clock = clock::create_for_testing(ts::ctx(&mut ts));

        contract_board::expire_job(job, &clock, ts::ctx(&mut ts));

        clock.destroy_for_testing();
    };

    ts::end(ts);
}
