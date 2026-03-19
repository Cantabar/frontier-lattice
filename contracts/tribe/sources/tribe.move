/// Tribe Registry — on-chain tribe membership, per-tribe reputation, and leadership.
///
/// Each `Tribe` is a shared object that is the authoritative source for:
///   - Membership roles (Leader, Officer, Member)
///   - Per-tribe reputation scores for each Character (independent per tribe)
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
/// - Per-tribe reputation avoids a global bottleneck; a player's score is contextual.
/// - Only active state lives on-chain; completed/cancelled operations are event-sourced.
module tribe::tribe;

use std::string::String;
use sui::{
    event,
    table::{Self, Table},
};
use world::character::Character;

// === Errors ===
const ETribeNameEmpty: u64 = 0;
const ENotAuthorized: u64 = 1;
const EAlreadyMember: u64 = 2;
const ENotMember: u64 = 3;
const ECannotRemoveLeader: u64 = 4;
const ETribeMismatch: u64 = 5;
const EInGameTribeAlreadyClaimed: u64 = 6;
const EInGameTribeIdInvalid: u64 = 7;
const ECharacterTribeMismatch: u64 = 8;
const ECannotTransferToSelf: u64 = 9;
const ERoleStale: u64 = 10;

// === Enums ===
public enum Role has copy, drop, store {
    Leader,
    Officer,
    Member,
}

// === Structs ===

/// Shared singleton registry enforcing one on-chain Tribe per in-game tribe.
/// Created once in the module `init` function.
public struct TribeRegistry has key {
    id: UID,
    /// in_game_tribe_id (u32) -> on-chain Tribe object ID
    registry: Table<u32, ID>,
}

/// The on-chain registry for a single tribe.
/// Shared object — one per tribe.
public struct Tribe has key {
    id: UID,
    name: String,
    /// The in-game tribe ID from the world Character contract (1:1 with this Tribe)
    in_game_tribe_id: u32,
    leader_character_id: ID,
    /// Character Sui object ID -> Role
    members: Table<ID, Role>,
    /// Character Sui object ID -> reputation score (tribe-specific)
    reputation: Table<ID, u64>,
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

// === Events ===

public struct TribeRegistryCreatedEvent has copy, drop {
    registry_id: ID,
}

public struct TribeCreatedEvent has copy, drop {
    tribe_id: ID,
    name: String,
    in_game_tribe_id: u32,
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

public struct LeadershipTransferredEvent has copy, drop {
    tribe_id: ID,
    old_leader_id: ID,
    new_leader_id: ID,
}

// === Init ===

/// Creates the singleton TribeRegistry on module publish.
fun init(ctx: &mut TxContext) {
    let registry = TribeRegistry {
        id: object::new(ctx),
        registry: table::new<u32, ID>(ctx),
    };
    event::emit(TribeRegistryCreatedEvent { registry_id: object::id(&registry) });
    transfer::share_object(registry);
}

// === Public Functions ===

/// Creates a new tribe. The caller provides their `Character` as proof of identity.
/// The in-game tribe ID is read from the Character and must not already be claimed.
/// The returned `TribeCap` (Leader role) must be transferred to the caller's wallet.
public fun create_tribe(
    registry: &mut TribeRegistry,
    character: &Character,
    name: String,
    ctx: &mut TxContext,
): TribeCap {
    assert!(name.length() > 0, ETribeNameEmpty);

    let in_game_tribe_id = character.tribe();
    assert!(in_game_tribe_id != 0, EInGameTribeIdInvalid);
    assert!(!registry.registry.contains(in_game_tribe_id), EInGameTribeAlreadyClaimed);

    let character_id = character.id();

    let mut members = table::new<ID, Role>(ctx);
    let mut reputation = table::new<ID, u64>(ctx);
    members.add(character_id, Role::Leader);
    reputation.add(character_id, 0u64);

    let tribe = Tribe {
        id: object::new(ctx),
        name,
        in_game_tribe_id,
        leader_character_id: character_id,
        members,
        reputation,
        member_count: 1,
    };

    let tribe_id = object::id(&tribe);
    // String has copy ability — safe to copy for the event before sharing
    let tribe_name = tribe.name;

    // Register the 1:1 mapping
    registry.registry.add(in_game_tribe_id, tribe_id);

    let leader_cap = TribeCap {
        id: object::new(ctx),
        tribe_id,
        character_id,
        role: Role::Leader,
    };

    event::emit(TribeCreatedEvent {
        tribe_id,
        name: tribe_name,
        in_game_tribe_id,
        leader_character_id: character_id,
    });

    transfer::share_object(tribe);
    leader_cap
}

/// Allows a Character whose in-game tribe matches this Tribe to join
/// autonomously as a Member. No TribeCap authorization is needed — the
/// Character's `tribe_id` (set by the world contract) serves as proof.
/// Returns a `TribeCap` that must be transferred to the caller's wallet.
public fun self_join(
    tribe: &mut Tribe,
    character: &Character,
    ctx: &mut TxContext,
): TribeCap {
    let in_game_id = character.tribe();
    assert!(in_game_id != 0, EInGameTribeIdInvalid);
    assert!(in_game_id == tribe.in_game_tribe_id, ECharacterTribeMismatch);

    let character_id = character.id();
    assert!(!tribe.members.contains(character_id), EAlreadyMember);

    tribe.members.add(character_id, Role::Member);
    tribe.reputation.add(character_id, 0u64);
    tribe.member_count = tribe.member_count + 1;

    let tribe_id = object::id(tribe);
    event::emit(MemberJoinedEvent { tribe_id, character_id, role: Role::Member });

    TribeCap {
        id: object::new(ctx),
        tribe_id,
        character_id,
        role: Role::Member,
    }
}

/// Adds a new member to the tribe. Requires an Officer or Leader `TribeCap`.
/// The returned `TribeCap` must be transferred to the new member's wallet.
public fun add_member(
    tribe: &mut Tribe,
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
public fun remove_member(
    tribe: &mut Tribe,
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
public fun update_reputation(
    tribe: &mut Tribe,
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

/// Transfers leadership to another tribe member. Only the current leader
/// (verified by both `TribeCap` role and `leader_character_id` match) can call this.
///
/// Atomically:
/// 1. Removes both old and new leader from the members table (invalidates old TribeCaps).
/// 2. Updates `leader_character_id` to the new leader.
/// 3. Re-adds both with swapped roles (new leader → Leader, old leader → Officer).
/// 4. Returns `(new_leader_cap, old_leader_cap)` — caller must transfer both.
///
/// Reputation is preserved (only the members table is cycled).
/// `member_count` is unchanged.
public fun transfer_leadership(
    tribe: &mut Tribe,
    cap: &TribeCap,
    new_leader_character_id: ID,
    ctx: &mut TxContext,
): (TribeCap, TribeCap) {
    verify_tribe_cap(tribe, cap);
    assert!(cap.role == Role::Leader, ENotAuthorized);
    assert!(cap.character_id == tribe.leader_character_id, ENotAuthorized);
    assert!(tribe.members.contains(new_leader_character_id), ENotMember);
    assert!(new_leader_character_id != cap.character_id, ECannotTransferToSelf);

    let old_leader_id = cap.character_id;
    let tribe_id = object::id(tribe);

    // Remove both from the members table (invalidates their existing TribeCaps)
    // Reputation entries are intentionally kept.
    tribe.members.remove(old_leader_id);
    tribe.members.remove(new_leader_character_id);

    // Update the canonical leader
    tribe.leader_character_id = new_leader_character_id;

    // Re-add with swapped roles
    tribe.members.add(new_leader_character_id, Role::Leader);
    tribe.members.add(old_leader_id, Role::Officer);

    event::emit(LeadershipTransferredEvent {
        tribe_id,
        old_leader_id,
        new_leader_id: new_leader_character_id,
    });

    let new_leader_cap = TribeCap {
        id: object::new(ctx),
        tribe_id,
        character_id: new_leader_character_id,
        role: Role::Leader,
    };
    let old_leader_cap = TribeCap {
        id: object::new(ctx),
        tribe_id,
        character_id: old_leader_id,
        role: Role::Officer,
    };

    (new_leader_cap, old_leader_cap)
}

/// Issues a `RepUpdateCap`
/// Transfer this cap to a hot wallet or authorised contract to allow automated
/// reputation updates (e.g. from the Contract Board on job completion).
public fun issue_rep_update_cap(
    tribe: &Tribe,
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
public fun update_reputation_with_cap(
    tribe: &mut Tribe,
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

// === View Functions ===

public fun tribe_id(cap: &TribeCap): ID { cap.tribe_id }
public fun cap_character_id(cap: &TribeCap): ID { cap.character_id }
public fun cap_role(cap: &TribeCap): Role { cap.role }
public fun rep_update_cap_tribe_id(cap: &RepUpdateCap): ID { cap.tribe_id }

public fun tribe_name(tribe: &Tribe): String { tribe.name }
public fun in_game_tribe_id(tribe: &Tribe): u32 { tribe.in_game_tribe_id }
public fun leader_character_id(tribe: &Tribe): ID { tribe.leader_character_id }
public fun member_count(tribe: &Tribe): u64 { tribe.member_count }

/// Returns the on-chain Tribe object ID for a given in-game tribe, if one exists.
public fun tribe_for_game_id(registry: &TribeRegistry, game_tribe_id: u32): Option<ID> {
    if (registry.registry.contains(game_tribe_id)) {
        std::option::some(*registry.registry.borrow(game_tribe_id))
    } else {
        std::option::none()
    }
}

public fun reputation_of(tribe: &Tribe, character_id: ID): u64 {
    if (tribe.reputation.contains(character_id)) {
        *tribe.reputation.borrow(character_id)
    } else {
        0
    }
}

public fun is_member(tribe: &Tribe, character_id: ID): bool {
    tribe.members.contains(character_id)
}

public fun member_role(tribe: &Tribe, character_id: ID): Role {
    assert!(tribe.members.contains(character_id), ENotMember);
    *tribe.members.borrow(character_id)
}

// === Private Helpers ===

fun verify_tribe_cap(tribe: &Tribe, cap: &TribeCap) {
    assert!(cap.tribe_id == object::id(tribe), ETribeMismatch);
    assert!(tribe.members.contains(cap.character_id), ENotMember);
    assert!(cap.role == *tribe.members.borrow(cap.character_id), ERoleStale);
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

#[test_only]
public fun create_registry_for_testing(ctx: &mut TxContext) {
    init(ctx);
}
