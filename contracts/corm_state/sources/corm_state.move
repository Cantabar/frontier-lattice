/// CormState — on-chain shared object representing a single corm's canonical
/// state. Each network node hosts one corm; all players on that node share
/// the same CormState and its progression.
///
/// Phase transitions, stability/corruption updates, and MintCap issuance
/// are managed by the corm-brain service via its funded keypair.
module corm_state::corm_state;

use sui::event;
use corm_auth::corm_auth::CormAdminCap;
use corm_state::corm_coin::{Self, MintCap};

// === Errors ===
const ENotAdmin: u64 = 0;
const EPhaseRegression: u64 = 1;
const EMeterOutOfRange: u64 = 2;

// === Structs ===

/// Shared object — one per corm (per network node).
public struct CormState has key {
    id: UID,
    /// The network node this corm is bound to.
    network_node_id: ID,
    /// Current phase (0–6). One-way progression.
    phase: u8,
    /// Stability meter (0–100).
    stability: u64,
    /// Corruption meter (0–100).
    corruption: u64,
    /// Address authorized to update this state (corm-brain keypair).
    admin: address,
}

// === Events ===

public struct CormStateCreatedEvent has copy, drop {
    corm_state_id: ID,
    network_node_id: ID,
    admin: address,
}

public struct CormStateUpdatedEvent has copy, drop {
    corm_state_id: ID,
    phase: u8,
    stability: u64,
    corruption: u64,
}

// === Public functions ===

/// Create a new CormState for a network node. Requires `CormAdminCap` to
/// prove the caller is the authorized CORM operator.
///
/// Returns a `MintCap` transferred to the caller so the corm-brain can
/// mint CORM tokens for this corm.
public fun create(
    _admin_cap: &CormAdminCap,
    network_node_id: ID,
    ctx: &mut TxContext,
): MintCap {
    let state = CormState {
        id: object::new(ctx),
        network_node_id,
        phase: 0,
        stability: 0,
        corruption: 0,
        admin: ctx.sender(),
    };

    let state_id = object::id(&state);

    event::emit(CormStateCreatedEvent {
        corm_state_id: state_id,
        network_node_id,
        admin: ctx.sender(),
    });

    let mint_cap = corm_coin::create_mint_cap(state_id, ctx);

    transfer::share_object(state);

    mint_cap
}

/// Update the corm's phase, stability, and corruption. Only the admin
/// (corm-brain keypair) can call this.
///
/// Phase must not regress. Stability and corruption must be 0–100.
public fun update_state(
    state: &mut CormState,
    new_phase: u8,
    new_stability: u64,
    new_corruption: u64,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == state.admin, ENotAdmin);
    assert!(new_phase >= state.phase, EPhaseRegression);
    assert!(new_stability <= 100, EMeterOutOfRange);
    assert!(new_corruption <= 100, EMeterOutOfRange);

    state.phase = new_phase;
    state.stability = new_stability;
    state.corruption = new_corruption;

    event::emit(CormStateUpdatedEvent {
        corm_state_id: object::id(state),
        phase: new_phase,
        stability: new_stability,
        corruption: new_corruption,
    });
}

/// Transfer admin authority to a new address. Only current admin can call.
public fun transfer_admin(
    state: &mut CormState,
    new_admin: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == state.admin, ENotAdmin);
    state.admin = new_admin;
}

// === View functions ===

public fun network_node_id(state: &CormState): ID { state.network_node_id }
public fun phase(state: &CormState): u8 { state.phase }
public fun stability(state: &CormState): u64 { state.stability }
public fun corruption(state: &CormState): u64 { state.corruption }
public fun admin(state: &CormState): address { state.admin }

// === Test-only helpers ===

#[test_only]
public fun destroy_for_testing(state: CormState) {
    let CormState { id, .. } = state;
    id.delete();
}
