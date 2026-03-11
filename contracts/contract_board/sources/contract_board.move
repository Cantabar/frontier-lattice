/// Contract Board — on-chain job board with escrow, completion verification, and tribe reputation.
///
/// Each `JobPosting<C>` is a shared object representing an active contract.
/// Jobs hold escrowed tokens (`Balance<C>`) released on verified completion.
/// Completed/expired/cancelled jobs are deleted; history lives exclusively in events.
///
/// Completion types describe the expected verification:
///   - Delivery: items deposited at a StorageUnit
///   - Bounty: killmail matching a target
///   - Transport: jump through a specific gate
///   - Custom: commitment hash for zkProof path (stretch goal)
///
/// For the hackathon, completion is poster-confirmed. The architecture supports
/// plugging in on-chain object verification (Killmail, Inventory, Gate) once
/// public getters are added to world contracts.
///
/// Reputation integration uses the `RepUpdateCap` from Phase 1: tribe leaders
/// delegate automated rep updates to job completion flows.
///
/// Design principles (same as Phase 1):
/// - Generic over coin type C (phantom): deploy with C = EVE for EVE Frontier.
/// - Objects as live state, events as history. Jobs deleted on terminal state.
/// - Per-tribe reputation context: jobs scoped to a tribe's trust network.
module contract_board::contract_board;

use std::string::String;
use sui::{
    balance::Balance,
    clock::Clock,
    coin::{Self, Coin},
    event,
};
use world::character::Character;
use tribe::tribe::{Self, Tribe, TribeCap, RepUpdateCap};

// === Errors ===
const EDescriptionEmpty: u64 = 0;
const EJobNotOpen: u64 = 1;
const EJobNotAssigned: u64 = 2;
const EJobExpired: u64 = 3;
const EJobNotExpired: u64 = 4;
const ENotPoster: u64 = 5;
const EInsufficientEscrow: u64 = 6;
const EReputationTooLow: u64 = 7;
const ENotTribeMember: u64 = 8;
const EDeadlineInPast: u64 = 9;
const ESelfAssign: u64 = 10;
const ETribeMismatch: u64 = 11;
const ECharacterMismatch: u64 = 12;

// === Enums ===

/// Describes the type of work and what verification is expected.
/// On-chain verification of world events is a stretch goal; completion is
/// poster-confirmed for the hackathon. The enum captures intent so that
/// automated verification can be plugged in later.
public enum CompletionType has copy, drop, store {
    /// Deliver items to a specified StorageUnit.
    /// Verification intent: ItemDepositedEvent at storage_unit_id for type_id × quantity.
    Delivery { storage_unit_id: ID, type_id: u64, quantity: u32 },
    /// Kill a target character (verified via Killmail).
    /// Verification intent: KillmailCreatedEvent where victim matches target.
    Bounty { target_character_id: ID },
    /// Transport through a specific gate.
    /// Verification intent: JumpEvent for character through gate_id.
    Transport { gate_id: ID },
    /// Custom/confidential — commitment hash for zkProof path.
    /// Verification intent: Groth16 proof matching commitment_hash.
    Custom { commitment_hash: vector<u8> },
}

/// Status of a job posting. Only `Open` and `Assigned` exist on-chain.
/// Terminal states (completed, expired, cancelled) are recorded as events
/// and the object is deleted.
public enum JobStatus has copy, drop, store {
    Open,
    Assigned,
    Disputed,
}

// === Structs ===

/// An active contract on the board. Shared object — one per job.
/// Holds escrowed tokens released on completion or returned on cancellation/expiry.
/// Deleted when the job reaches a terminal state (reclaims storage rebate).
///
/// C is a phantom coin type (e.g. assets::EVE::EVE on EVE Frontier testnet).
public struct JobPosting<phantom C> has key {
    id: UID,
    poster_id: ID,
    poster_address: address,
    poster_tribe_id: ID,
    description: String,
    completion_type: CompletionType,
    reward_amount: u64,
    escrow: Balance<C>,
    assignee_id: Option<ID>,
    assignee_address: Option<address>,
    deadline_ms: u64,
    status: JobStatus,
    /// Minimum reputation in the poster's tribe required to accept this job.
    min_reputation: u64,
}

// === Events ===

public struct JobCreatedEvent has copy, drop {
    job_id: ID,
    poster_id: ID,
    poster_tribe_id: ID,
    completion_type: CompletionType,
    reward_amount: u64,
    deadline_ms: u64,
    min_reputation: u64,
}

public struct JobAcceptedEvent has copy, drop {
    job_id: ID,
    assignee_id: ID,
}

public struct JobCompletedEvent has copy, drop {
    job_id: ID,
    poster_id: ID,
    assignee_id: ID,
    reward_amount: u64,
    completion_type: CompletionType,
    rep_awarded: u64,
}

public struct JobExpiredEvent has copy, drop {
    job_id: ID,
    poster_id: ID,
    reward_amount: u64,
}

public struct JobCancelledEvent has copy, drop {
    job_id: ID,
    poster_id: ID,
    reward_amount: u64,
}

// === CompletionType Constructors ===
// Enum variants in Move 2024.beta cannot be constructed outside their
// defining module, so we expose public constructor functions.

public fun completion_delivery(storage_unit_id: ID, type_id: u64, quantity: u32): CompletionType {
    CompletionType::Delivery { storage_unit_id, type_id, quantity }
}

public fun completion_bounty(target_character_id: ID): CompletionType {
    CompletionType::Bounty { target_character_id }
}

public fun completion_transport(gate_id: ID): CompletionType {
    CompletionType::Transport { gate_id }
}

public fun completion_custom(commitment_hash: vector<u8>): CompletionType {
    CompletionType::Custom { commitment_hash }
}

// === JobStatus Constructors ===

public fun status_open(): JobStatus { JobStatus::Open }
public fun status_assigned(): JobStatus { JobStatus::Assigned }
public fun status_disputed(): JobStatus { JobStatus::Disputed }

// === Public Functions ===

/// Creates a new job posting. The poster locks tokens as escrow.
/// Requires a valid TribeCap matching the poster's Character.
/// The job is scoped to the poster's tribe for reputation context.
public fun create_job<C>(
    tribe: &Tribe<C>,
    cap: &TribeCap,
    poster_character: &Character,
    description: String,
    completion_type: CompletionType,
    escrow_coin: Coin<C>,
    deadline_ms: u64,
    min_reputation: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(description.length() > 0, EDescriptionEmpty);
    assert!(escrow_coin.value() > 0, EInsufficientEscrow);
    assert!(deadline_ms > clock.timestamp_ms(), EDeadlineInPast);

    let poster_id = tribe::cap_character_id(cap);
    let tribe_id = tribe::tribe_id(cap);
    assert!(poster_character.id() == poster_id, ECharacterMismatch);
    assert!(tribe_id == object::id(tribe), ETribeMismatch);
    assert!(tribe::is_member(tribe, poster_id), ENotTribeMember);

    let reward_amount = escrow_coin.value();
    let poster_address = poster_character.character_address();

    let job = JobPosting<C> {
        id: object::new(ctx),
        poster_id,
        poster_address,
        poster_tribe_id: tribe_id,
        description,
        completion_type,
        reward_amount,
        escrow: escrow_coin.into_balance(),
        assignee_id: option::none(),
        assignee_address: option::none(),
        deadline_ms,
        status: JobStatus::Open,
        min_reputation,
    };

    let job_id = object::id(&job);
    event::emit(JobCreatedEvent {
        job_id,
        poster_id,
        poster_tribe_id: tribe_id,
        completion_type,
        reward_amount,
        deadline_ms,
        min_reputation,
    });

    transfer::share_object(job);
}

/// Creates a job funded from the tribe treasury instead of personal coin.
/// Requires Leader or Officer TribeCap. Withdraws `escrow_amount` from the
/// tribe treasury and locks it as the job's escrow.
///
/// This is the primary Tribe → Contract Board integration: tribe leadership
/// can post bounties and delivery contracts funded by collective resources.
public fun create_job_from_treasury<C>(
    tribe: &mut Tribe<C>,
    cap: &TribeCap,
    poster_character: &Character,
    description: String,
    completion_type: CompletionType,
    escrow_amount: u64,
    deadline_ms: u64,
    min_reputation: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(description.length() > 0, EDescriptionEmpty);
    assert!(escrow_amount > 0, EInsufficientEscrow);
    assert!(deadline_ms > clock.timestamp_ms(), EDeadlineInPast);

    let poster_id = tribe::cap_character_id(cap);
    let tribe_id = tribe::tribe_id(cap);
    assert!(poster_character.id() == poster_id, ECharacterMismatch);
    assert!(tribe_id == object::id(tribe), ETribeMismatch);
    assert!(tribe::is_member(tribe, poster_id), ENotTribeMember);

    // Withdraw from tribe treasury (checks Leader/Officer + sufficient balance)
    let escrow_coin = tribe::withdraw_from_treasury(tribe, cap, escrow_amount, ctx);
    let reward_amount = escrow_coin.value();
    let poster_address = poster_character.character_address();

    let job = JobPosting<C> {
        id: object::new(ctx),
        poster_id,
        poster_address,
        poster_tribe_id: tribe_id,
        description,
        completion_type,
        reward_amount,
        escrow: escrow_coin.into_balance(),
        assignee_id: option::none(),
        assignee_address: option::none(),
        deadline_ms,
        status: JobStatus::Open,
        min_reputation,
    };

    let job_id = object::id(&job);
    event::emit(JobCreatedEvent {
        job_id,
        poster_id,
        poster_tribe_id: tribe_id,
        completion_type,
        reward_amount,
        deadline_ms,
        min_reputation,
    });

    transfer::share_object(job);
}

/// Accept an open job. The assignee must be a member of the poster's tribe
/// and meet the minimum reputation requirement.
/// Cannot accept after deadline; cannot self-assign.
public fun accept_job<C>(
    job: &mut JobPosting<C>,
    tribe: &Tribe<C>,
    cap: &TribeCap,
    character: &Character,
    clock: &Clock,
) {
    assert!(job.status == JobStatus::Open, EJobNotOpen);
    assert!(clock.timestamp_ms() <= job.deadline_ms, EJobExpired);

    let assignee_id = tribe::cap_character_id(cap);
    assert!(character.id() == assignee_id, ECharacterMismatch);
    assert!(assignee_id != job.poster_id, ESelfAssign);

    // Verify assignee is a member of the poster's tribe
    assert!(tribe::tribe_id(cap) == job.poster_tribe_id, ETribeMismatch);
    assert!(tribe::is_member(tribe, assignee_id), ENotTribeMember);

    // Check minimum reputation in the poster's tribe
    let rep = tribe::reputation_of(tribe, assignee_id);
    assert!(rep >= job.min_reputation, EReputationTooLow);

    job.assignee_id = option::some(assignee_id);
    job.assignee_address = option::some(character.character_address());
    job.status = JobStatus::Assigned;

    event::emit(JobAcceptedEvent {
        job_id: object::id(job),
        assignee_id,
    });
}

/// Poster confirms job completion. Releases escrow to assignee and deletes
/// the job object (reclaiming storage rebate).
/// Emits `JobCompletedEvent` for the indexer / verifiable history.
public fun confirm_completion<C>(
    job: JobPosting<C>,
    cap: &TribeCap,
    ctx: &mut TxContext,
) {
    assert!(job.status == JobStatus::Assigned, EJobNotAssigned);
    assert!(tribe::cap_character_id(cap) == job.poster_id, ENotPoster);

    let job_id = object::id(&job);
    let assignee_id = *option::borrow(&job.assignee_id);
    let assignee_addr = *option::borrow(&job.assignee_address);

    let JobPosting {
        id,
        poster_id,
        completion_type,
        reward_amount,
        escrow,
        ..
    } = job;

    let coin = coin::from_balance(escrow, ctx);
    transfer::public_transfer(coin, assignee_addr);

    event::emit(JobCompletedEvent {
        job_id,
        poster_id,
        assignee_id,
        reward_amount,
        completion_type,
        rep_awarded: 0,
    });

    id.delete();
}

/// Poster confirms job completion AND awards reputation to the assignee.
/// Requires a `RepUpdateCap` for the poster's tribe (issued by tribe leader).
/// This is the primary integration point between the Contract Board and
/// the Tribe Registry from Phase 1.
public fun confirm_completion_with_rep<C>(
    job: JobPosting<C>,
    tribe: &mut Tribe<C>,
    rep_cap: &RepUpdateCap,
    cap: &TribeCap,
    rep_delta: u64,
    ctx: &mut TxContext,
) {
    assert!(job.status == JobStatus::Assigned, EJobNotAssigned);
    assert!(tribe::cap_character_id(cap) == job.poster_id, ENotPoster);

    let job_id = object::id(&job);
    let assignee_id = *option::borrow(&job.assignee_id);
    let assignee_addr = *option::borrow(&job.assignee_address);

    // Update assignee reputation in the poster's tribe
    tribe::update_reputation_with_cap(tribe, rep_cap, assignee_id, rep_delta, true);

    let JobPosting {
        id,
        poster_id,
        completion_type,
        reward_amount,
        escrow,
        ..
    } = job;

    let coin = coin::from_balance(escrow, ctx);
    transfer::public_transfer(coin, assignee_addr);

    event::emit(JobCompletedEvent {
        job_id,
        poster_id,
        assignee_id,
        reward_amount,
        completion_type,
        rep_awarded: rep_delta,
    });

    id.delete();
}

/// Cancel an open (unassigned) job. Returns escrow to the poster.
/// Only the poster can cancel. Cannot cancel an assigned job.
public fun cancel_job<C>(
    job: JobPosting<C>,
    cap: &TribeCap,
    ctx: &mut TxContext,
) {
    assert!(job.status == JobStatus::Open, EJobNotOpen);
    assert!(tribe::cap_character_id(cap) == job.poster_id, ENotPoster);

    let job_id = object::id(&job);

    let JobPosting {
        id,
        poster_id,
        poster_address,
        reward_amount,
        escrow,
        ..
    } = job;

    let coin = coin::from_balance(escrow, ctx);
    transfer::public_transfer(coin, poster_address);

    event::emit(JobCancelledEvent {
        job_id,
        poster_id,
        reward_amount,
    });

    id.delete();
}

/// Reclaim escrow for an expired job. Anyone can call this after the deadline.
/// Escrow is returned to the poster's stored address regardless of job status.
/// This prevents expired jobs from lingering on-chain indefinitely.
public fun expire_job<C>(
    job: JobPosting<C>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(clock.timestamp_ms() > job.deadline_ms, EJobNotExpired);

    let job_id = object::id(&job);

    let JobPosting {
        id,
        poster_id,
        poster_address,
        reward_amount,
        escrow,
        ..
    } = job;

    let coin = coin::from_balance(escrow, ctx);
    transfer::public_transfer(coin, poster_address);

    event::emit(JobExpiredEvent {
        job_id,
        poster_id,
        reward_amount,
    });

    id.delete();
}

// === View Functions ===

public fun job_poster_id<C>(job: &JobPosting<C>): ID { job.poster_id }
public fun job_poster_tribe_id<C>(job: &JobPosting<C>): ID { job.poster_tribe_id }
public fun job_reward_amount<C>(job: &JobPosting<C>): u64 { job.reward_amount }
public fun job_deadline_ms<C>(job: &JobPosting<C>): u64 { job.deadline_ms }
public fun job_status<C>(job: &JobPosting<C>): JobStatus { job.status }
public fun job_min_reputation<C>(job: &JobPosting<C>): u64 { job.min_reputation }
public fun job_completion_type<C>(job: &JobPosting<C>): CompletionType { job.completion_type }
public fun job_assignee_id<C>(job: &JobPosting<C>): Option<ID> { job.assignee_id }

// === Test-only Helpers ===

#[test_only]
public fun destroy_job_for_testing<C>(job: JobPosting<C>) {
    let JobPosting { id, escrow, .. } = job;
    escrow.destroy_for_testing();
    id.delete();
}
