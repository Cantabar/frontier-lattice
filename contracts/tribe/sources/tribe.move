/// Tribe Registry — on-chain tribe membership, per-tribe reputation, and shared treasury.
///
/// Each `Tribe<C>` is a shared object that is the authoritative source for:
///   - Membership roles (Leader, Officer, Member)
///   - Per-tribe reputation scores for each Character (independent per tribe)
///   - A shared treasury holding `Coin<C>` (any fungible token, typically EVE)
///
/// The `TribeCap` capability is issued to each member and proves membership + role.
/// It authenticates calls into the tribe (add members, vote, update rep, etc.).
/// Removing a member invalidates their TribeCap by removing them from the members table;
/// subsequent calls using the stale cap will abort at the membership check.
///
/// The `RepUpdateCap` is issued by a tribe Leader to authorise external contracts
/// (e.g. the Contract Board in Phase 2) to update member reputation automatically on
/// job completion — without requiring a TribeCap from a live operator.
///
/// Design principles:
/// - Generic over coin type C (phantom): deploy with C = EVE for EVE Frontier.
/// - Per-tribe reputation avoids a global bottleneck; a player's score is contextual.
/// - Only active proposals live on-chain; completed/cancelled ones are event-sourced.
/// - Treasury spend requires on-chain voting (vote_count * 100 >= member_count * threshold).
module tribe::tribe;

use std::string::String;
use sui::{
    balance::{Self, Balance},
    clock::Clock,
    coin::{Self, Coin},
    event,
    table::{Self, Table},
};
use world::character::Character;

// === Errors ===
const ETribeNameEmpty: u64 = 0;
const ENotAuthorized: u64 = 1;
const EAlreadyMember: u64 = 2;
const ENotMember: u64 = 3;
const EInsufficientFunds: u64 = 4;
const EProposalExpired: u64 = 5;
const EProposalAlreadyExecuted: u64 = 6;
const EAlreadyVoted: u64 = 7;
const EThresholdNotMet: u64 = 8;
const ECannotRemoveLeader: u64 = 9;
const ETribeMismatch: u64 = 10;
const EThresholdOutOfRange: u64 = 11;
const EDeadlineInPast: u64 = 12;
#[allow(unused_const)]
const EProposalNotExpired: u64 = 13;

// === Enums ===
public enum Role has copy, drop, store {
    Leader,
    Officer,
    Member,
}

// === Structs ===

/// The on-chain registry for a single tribe.
/// Shared object — one per tribe.
/// C is a phantom coin type (e.g. assets::EVE::EVE on EVE Frontier testnet).
public struct Tribe<phantom C> has key {
    id: UID,
    name: String,
    leader_character_id: ID,
    /// Character Sui object ID -> Role
    members: Table<ID, Role>,
    /// Character Sui object ID -> reputation score (tribe-specific)
    reputation: Table<ID, u64>,
    /// Shared treasury holding Coin<C>
    treasury: Balance<C>,
    /// 1–100: percentage of current members required to pass a spend vote
    vote_threshold: u64,
    member_count: u64,
}

/// Owned capability proving membership in a specific tribe.
/// Held by the member's wallet; required to authenticate tribe operations.
/// Becomes effectively invalid when the holder is removed from the tribe
/// (membership check in `verify_tribe_cap` will abort).
public struct TribeCap has key, store {
    id: UID,
    tribe_id: ID,
    character_id: ID,
    role: Role,
}

/// Owned capability that authorises an external address or contract to update
/// a member's reputation in a specific tribe without needing a TribeCap.
/// Issued by the tribe Leader; transfer to a hot wallet or authorised contract
/// (e.g. the Contract Board in Phase 2) for automated reputation updates.
public struct RepUpdateCap has key, store {
    id: UID,
    tribe_id: ID,
}

/// Shared proposal for a tribe treasury spend vote.
/// Lives on-chain while active; votes are recorded here.
/// After execution or expiry, the event log provides the historical record.
public struct TreasuryProposal has key {
    id: UID,
    tribe_id: ID,
    amount: u64,
    recipient: address,
    /// Character ID -> voted yes (present means voted)
    votes: Table<ID, bool>,
    vote_count: u64,
    executed: bool,
    deadline_ms: u64,
}

// === Events ===

public struct TribeCreatedEvent has copy, drop {
    tribe_id: ID,
    name: String,
    leader_character_id: ID,
}

public struct MemberJoinedEvent has copy, drop {
    tribe_id: ID,
    character_id: ID,
    role: Role,
}

public struct MemberRemovedEvent has copy, drop {
    tribe_id: ID,
    character_id: ID,
}

public struct ReputationUpdatedEvent has copy, drop {
    tribe_id: ID,
    character_id: ID,
    new_score: u64,
}

public struct TreasuryDepositEvent has copy, drop {
    tribe_id: ID,
    amount: u64,
}

public struct TreasuryProposalCreatedEvent has copy, drop {
    tribe_id: ID,
    proposal_id: ID,
    amount: u64,
    recipient: address,
    deadline_ms: u64,
}

public struct TreasuryProposalVotedEvent has copy, drop {
    tribe_id: ID,
    proposal_id: ID,
    character_id: ID,
    vote_count: u64,
}

public struct TreasurySpendEvent has copy, drop {
    tribe_id: ID,
    proposal_id: ID,
    amount: u64,
    recipient: address,
}

public struct TreasuryWithdrawEvent has copy, drop {
    tribe_id: ID,
    amount: u64,
    withdrawn_by: ID,
}

// === Public Functions ===

/// Creates a new tribe. The caller provides their `Character` as proof of identity.
/// The returned `TribeCap` (Leader role) must be transferred to the caller's wallet.
/// C is the phantom coin type for the treasury (e.g. EVE on EVE Frontier testnet).
public fun create_tribe<C>(
    character: &Character,
    name: String,
    vote_threshold: u64,
    ctx: &mut TxContext,
): TribeCap {
    assert!(name.length() > 0, ETribeNameEmpty);
    assert!(vote_threshold >= 1 && vote_threshold <= 100, EThresholdOutOfRange);

    let character_id = character.id();

    let mut members = table::new<ID, Role>(ctx);
    let mut reputation = table::new<ID, u64>(ctx);
    members.add(character_id, Role::Leader);
    reputation.add(character_id, 0u64);

    let tribe = Tribe<C> {
        id: object::new(ctx),
        name,
        leader_character_id: character_id,
        members,
        reputation,
        treasury: balance::zero<C>(),
        vote_threshold,
        member_count: 1,
    };

    let tribe_id = object::id(&tribe);
    // String has copy ability — safe to copy for the event before sharing
    let tribe_name = tribe.name;

    let leader_cap = TribeCap {
        id: object::new(ctx),
        tribe_id,
        character_id,
        role: Role::Leader,
    };

    event::emit(TribeCreatedEvent {
        tribe_id,
        name: tribe_name,
        leader_character_id: character_id,
    });

    transfer::share_object(tribe);
    leader_cap
}

/// Adds a new member to the tribe. Requires an Officer or Leader `TribeCap`.
/// The returned `TribeCap` must be transferred to the new member's wallet.
public fun add_member<C>(
    tribe: &mut Tribe<C>,
    cap: &TribeCap,
    new_member_character: &Character,
    role: Role,
    ctx: &mut TxContext,
): TribeCap {
    verify_tribe_cap(tribe, cap);
    assert!(is_leader_or_officer(cap), ENotAuthorized);

    let character_id = new_member_character.id();
    assert!(!tribe.members.contains(character_id), EAlreadyMember);

    tribe.members.add(character_id, role);
    tribe.reputation.add(character_id, 0u64);
    tribe.member_count = tribe.member_count + 1;

    let tribe_id = object::id(tribe);
    event::emit(MemberJoinedEvent { tribe_id, character_id, role });

    TribeCap {
        id: object::new(ctx),
        tribe_id,
        character_id,
        role,
    }
}

/// Removes a member from the tribe. Requires a Leader `TribeCap`.
/// The removed member's TribeCap becomes invalid (membership check fails on next use).
/// Does NOT delete the stale cap; the removed member may burn it separately.
public fun remove_member<C>(
    tribe: &mut Tribe<C>,
    cap: &TribeCap,
    character_id: ID,
) {
    verify_tribe_cap(tribe, cap);
    assert!(cap.role == Role::Leader, ENotAuthorized);
    assert!(character_id != tribe.leader_character_id, ECannotRemoveLeader);
    assert!(tribe.members.contains(character_id), ENotMember);

    tribe.members.remove(character_id);
    tribe.reputation.remove(character_id);
    tribe.member_count = tribe.member_count - 1;

    event::emit(MemberRemovedEvent {
        tribe_id: object::id(tribe),
        character_id,
    });
}

/// Updates a member's reputation score. Requires an Officer or Leader `TribeCap`.
/// If `increase` is false the score is decremented, clamped to zero.
public fun update_reputation<C>(
    tribe: &mut Tribe<C>,
    cap: &TribeCap,
    character_id: ID,
    delta: u64,
    increase: bool,
) {
    verify_tribe_cap(tribe, cap);
    assert!(is_leader_or_officer(cap), ENotAuthorized);
    assert!(tribe.reputation.contains(character_id), ENotMember);

    let tribe_id = object::id(tribe);
    let new_score = {
        let score = tribe.reputation.borrow_mut(character_id);
        *score = if (increase) {
            *score + delta
        } else if (*score >= delta) {
            *score - delta
        } else {
            0
        };
        *score
    };

    event::emit(ReputationUpdatedEvent { tribe_id, character_id, new_score });
}

/// Issues a `RepUpdateCap`
/// Transfer this cap to a hot wallet or authorised contract to allow automated
/// reputation updates (e.g. from the Contract Board on job completion).
public fun issue_rep_update_cap<C>(
    tribe: &Tribe<C>,
    cap: &TribeCap,
    ctx: &mut TxContext,
): RepUpdateCap {
    verify_tribe_cap(tribe, cap);
    assert!(cap.role == Role::Leader, ENotAuthorized);

    RepUpdateCap {
        id: object::new(ctx),
        tribe_id: object::id(tribe),
    }
}

/// Updates a member's reputation using a `RepUpdateCap`.
/// Called by authorised external contracts (e.g. Contract Board on job completion).
public fun update_reputation_with_cap<C>(
    tribe: &mut Tribe<C>,
    rep_cap: &RepUpdateCap,
    character_id: ID,
    delta: u64,
    increase: bool,
) {
    let tribe_id = object::id(tribe);
    assert!(rep_cap.tribe_id == tribe_id, ETribeMismatch);
    assert!(tribe.reputation.contains(character_id), ENotMember);

    let new_score = {
        let score = tribe.reputation.borrow_mut(character_id);
        *score = if (increase) {
            *score + delta
        } else if (*score >= delta) {
            *score - delta
        } else {
            0
        };
        *score
    };

    event::emit(ReputationUpdatedEvent { tribe_id, character_id, new_score });
}

/// Deposits coins of type C into the tribe treasury. Open to anyone.
public fun deposit_to_treasury<C>(tribe: &mut Tribe<C>, coin: Coin<C>) {
    let amount = coin.value();
    tribe.treasury.join(coin.into_balance());
    event::emit(TreasuryDepositEvent { tribe_id: object::id(tribe), amount });
}

/// Withdraws tokens from the tribe treasury. Requires Leader or Officer TribeCap.
/// Returns a `Coin<C>` that can be used directly (e.g. to fund a job on the
/// Contract Board) or transferred. This is the composable primitive for
/// treasury-funded operations without requiring the proposal/vote flow.
public fun withdraw_from_treasury<C>(
    tribe: &mut Tribe<C>,
    cap: &TribeCap,
    amount: u64,
    ctx: &mut TxContext,
): Coin<C> {
    verify_tribe_cap(tribe, cap);
    assert!(is_leader_or_officer(cap), ENotAuthorized);
    assert!(amount > 0, ETribeNameEmpty); // reuse: zero-amount check
    assert!(tribe.treasury.value() >= amount, EInsufficientFunds);

    let tribe_id = object::id(tribe);
    let coin = coin::take(&mut tribe.treasury, amount, ctx);

    event::emit(TreasuryWithdrawEvent {
        tribe_id,
        amount,
        withdrawn_by: cap.character_id,
    });

    coin
}

/// Creates a treasury spend proposal. Requires Officer or Leader `TribeCap`.
/// The proposal is shared and open for voting until `deadline_ms`.
/// `amount` must not exceed the current treasury balance at proposal time.
public fun propose_treasury_spend<C>(
    tribe: &Tribe<C>,
    cap: &TribeCap,
    amount: u64,
    recipient: address,
    deadline_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    verify_tribe_cap(tribe, cap);
    assert!(is_leader_or_officer(cap), ENotAuthorized);
    assert!(amount <= tribe.treasury.value(), EInsufficientFunds);
    assert!(deadline_ms > clock.timestamp_ms(), EDeadlineInPast);

    let proposal = TreasuryProposal {
        id: object::new(ctx),
        tribe_id: object::id(tribe),
        amount,
        recipient,
        votes: table::new(ctx),
        vote_count: 0,
        executed: false,
        deadline_ms,
    };

    let proposal_id = object::id(&proposal);
    event::emit(TreasuryProposalCreatedEvent {
        tribe_id: object::id(tribe),
        proposal_id,
        amount,
        recipient,
        deadline_ms,
    });

    transfer::share_object(proposal);
}

/// Votes yes on a treasury proposal. Any member with a valid `TribeCap` may vote once.
public fun vote_on_proposal<C>(
    tribe: &Tribe<C>,
    proposal: &mut TreasuryProposal,
    cap: &TribeCap,
    clock: &Clock,
) {
    verify_tribe_cap(tribe, cap);
    assert!(proposal.tribe_id == object::id(tribe), ETribeMismatch);
    assert!(!proposal.executed, EProposalAlreadyExecuted);
    assert!(clock.timestamp_ms() <= proposal.deadline_ms, EProposalExpired);
    assert!(!proposal.votes.contains(cap.character_id), EAlreadyVoted);

    proposal.votes.add(cap.character_id, true);
    proposal.vote_count = proposal.vote_count + 1;

    event::emit(TreasuryProposalVotedEvent {
        tribe_id: object::id(tribe),
        proposal_id: object::id(proposal),
        character_id: cap.character_id,
        vote_count: proposal.vote_count,
    });
}

/// Executes a passed treasury proposal. Anyone may call this once the threshold is met.
/// Releases the treasury coins to the specified recipient.
public fun execute_proposal<C>(
    tribe: &mut Tribe<C>,
    proposal: &mut TreasuryProposal,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(proposal.tribe_id == object::id(tribe), ETribeMismatch);
    assert!(!proposal.executed, EProposalAlreadyExecuted);
    assert!(clock.timestamp_ms() <= proposal.deadline_ms, EProposalExpired);
    assert!(
        proposal.vote_count * 100 >= tribe.member_count * tribe.vote_threshold,
        EThresholdNotMet,
    );
    assert!(tribe.treasury.value() >= proposal.amount, EInsufficientFunds);

    proposal.executed = true;
    let coin = coin::take(&mut tribe.treasury, proposal.amount, ctx);
    transfer::public_transfer(coin, proposal.recipient);

    event::emit(TreasurySpendEvent {
        tribe_id: object::id(tribe),
        proposal_id: object::id(proposal),
        amount: proposal.amount,
        recipient: proposal.recipient,
    });
}

// === View Functions ===

public fun tribe_id(cap: &TribeCap): ID { cap.tribe_id }
public fun cap_character_id(cap: &TribeCap): ID { cap.character_id }
public fun cap_role(cap: &TribeCap): Role { cap.role }
public fun rep_update_cap_tribe_id(cap: &RepUpdateCap): ID { cap.tribe_id }

public fun tribe_name<C>(tribe: &Tribe<C>): String { tribe.name }
public fun leader_character_id<C>(tribe: &Tribe<C>): ID { tribe.leader_character_id }
public fun member_count<C>(tribe: &Tribe<C>): u64 { tribe.member_count }
public fun treasury_balance<C>(tribe: &Tribe<C>): u64 { tribe.treasury.value() }
public fun vote_threshold<C>(tribe: &Tribe<C>): u64 { tribe.vote_threshold }

public fun reputation_of<C>(tribe: &Tribe<C>, character_id: ID): u64 {
    if (tribe.reputation.contains(character_id)) {
        *tribe.reputation.borrow(character_id)
    } else {
        0
    }
}

public fun is_member<C>(tribe: &Tribe<C>, character_id: ID): bool {
    tribe.members.contains(character_id)
}

public fun member_role<C>(tribe: &Tribe<C>, character_id: ID): Role {
    assert!(tribe.members.contains(character_id), ENotMember);
    *tribe.members.borrow(character_id)
}

public fun proposal_vote_count(proposal: &TreasuryProposal): u64 { proposal.vote_count }
public fun proposal_executed(proposal: &TreasuryProposal): bool { proposal.executed }
public fun proposal_amount(proposal: &TreasuryProposal): u64 { proposal.amount }
public fun proposal_recipient(proposal: &TreasuryProposal): address { proposal.recipient }

// === Private Helpers ===

fun verify_tribe_cap<C>(tribe: &Tribe<C>, cap: &TribeCap) {
    assert!(cap.tribe_id == object::id(tribe), ETribeMismatch);
    assert!(tribe.members.contains(cap.character_id), ENotMember);
}

fun is_leader_or_officer(cap: &TribeCap): bool {
    cap.role == Role::Leader || cap.role == Role::Officer
}

// === Role Constructors ===
// Enum variants in Move 2024.beta are not directly constructable outside
// their defining module, so we expose constructor functions.
public fun role_leader(): Role { Role::Leader }
public fun role_officer(): Role { Role::Officer }
public fun role_member(): Role { Role::Member }

// === Test-only helpers ===

#[test_only]
public fun destroy_tribe_cap_for_testing(cap: TribeCap) {
    let TribeCap { id, .. } = cap;
    id.delete();
}

#[test_only]
public fun destroy_rep_update_cap_for_testing(cap: RepUpdateCap) {
    let RepUpdateCap { id, .. } = cap;
    id.delete();
}
