/// CormState — on-chain shared object representing a single corm's canonical
/// state. Each network node hosts one corm; all players on that node share
/// the same CormState and its progression.
///
/// Phase transitions, stability/corruption updates, and MintCap issuance
/// are managed by the corm-brain service via its funded keypair.
module corm_state::corm_state;

use sui::event;
use sui::dynamic_field as df;
use corm_auth::corm_auth::CormAdminCap;
use corm_state::corm_coin::{Self, MintCap};

// === Version ===
const CURRENT_VERSION: u64 = 1;

// === Errors ===
const ENotAdmin: u64 = 0;
const EPhaseRegression: u64 = 1;
const EMeterOutOfRange: u64 = 2;
const EVersionMismatch: u64 = 3;
const EAlreadyMigrated: u64 = 4;

/// Dynamic-field key for version tracking on shared objects.
public struct VersionKey has copy, drop, store {}

// === Structs ===

/// Shared config created once by admin after deploy. Stores the address of
/// the corm-brain service keypair so that player-initiated `install` can
/// route authority (admin + MintCap) to the brain automatically.
public struct CormConfig has key {
    id: UID,
    /// Address of the corm-brain service keypair.
    brain_address: address,
}

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

/// Create the shared `CormConfig`. Admin-only, called once after deploy.
/// `brain_address` is the corm-brain service keypair that will administer
/// all CormState objects created via `install`.
public fun create_config(
    _admin_cap: &CormAdminCap,
    brain_address: address,
    ctx: &mut TxContext,
) {
    let mut config = CormConfig {
        id: object::new(ctx),
        brain_address,
    };
    df::add(&mut config.id, VersionKey {}, CURRENT_VERSION);
    transfer::share_object(config);
}

/// Update the brain address stored in `CormConfig`. Admin-only.
public fun set_brain_address(
    config: &mut CormConfig,
    _admin_cap: &CormAdminCap,
    new_brain_address: address,
) {
    assert_config_version(config);
    config.brain_address = new_brain_address;
}

/// Install a corm on a network node. **Permissionless** — any player can
/// call this to create a CormState for a node they own.
///
/// The CormState `admin` is set to the brain address from `CormConfig`,
/// and the `MintCap` is transferred directly to the brain so the player
/// never holds minting authority.
public fun install(
    config: &CormConfig,
    network_node_id: ID,
    ctx: &mut TxContext,
) {
    let mut state = CormState {
        id: object::new(ctx),
        network_node_id,
        phase: 0,
        stability: 0,
        corruption: 0,
        admin: config.brain_address,
    };
    df::add(&mut state.id, VersionKey {}, CURRENT_VERSION);

    let state_id = object::id(&state);

    event::emit(CormStateCreatedEvent {
        corm_state_id: state_id,
        network_node_id,
        admin: config.brain_address,
    });

    let mint_cap = corm_coin::create_mint_cap(state_id, ctx);

    transfer::share_object(state);
    transfer::public_transfer(mint_cap, config.brain_address);
}

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
    let mut state = CormState {
        id: object::new(ctx),
        network_node_id,
        phase: 0,
        stability: 0,
        corruption: 0,
        admin: ctx.sender(),
    };
    df::add(&mut state.id, VersionKey {}, CURRENT_VERSION);

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
    assert_state_version(state);
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

/// Reset the corm's phase, stability, and corruption. Only the admin
/// (corm-brain keypair) can call this.
///
/// Unlike `update_state`, this function allows phase regression —
/// it is the admin escape hatch for recovering corms stuck at invalid phases.
public fun reset_state(
    state: &mut CormState,
    new_phase: u8,
    new_stability: u64,
    new_corruption: u64,
    ctx: &TxContext,
) {
    assert_state_version(state);
    assert!(ctx.sender() == state.admin, ENotAdmin);
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
    assert_state_version(state);
    assert!(ctx.sender() == state.admin, ENotAdmin);
    state.admin = new_admin;
}

// === View functions ===

public fun network_node_id(state: &CormState): ID { state.network_node_id }
public fun phase(state: &CormState): u8 { state.phase }
public fun stability(state: &CormState): u64 { state.stability }
public fun corruption(state: &CormState): u64 { state.corruption }
public fun admin(state: &CormState): address { state.admin }
public fun brain_address(config: &CormConfig): address { config.brain_address }

// === Migration ===

/// Migrate CormConfig to the current version. Admin-gated.
public fun migrate_config(
    config: &mut CormConfig,
    _admin_cap: &CormAdminCap,
) {
    if (df::exists_(&config.id, VersionKey {})) {
        let v: &mut u64 = df::borrow_mut(&mut config.id, VersionKey {});
        assert!(*v < CURRENT_VERSION, EAlreadyMigrated);
        *v = CURRENT_VERSION;
    } else {
        df::add(&mut config.id, VersionKey {}, CURRENT_VERSION);
    };
}

/// Migrate CormState to the current version. Admin-gated.
public fun migrate_state(
    state: &mut CormState,
    _admin_cap: &CormAdminCap,
) {
    if (df::exists_(&state.id, VersionKey {})) {
        let v: &mut u64 = df::borrow_mut(&mut state.id, VersionKey {});
        assert!(*v < CURRENT_VERSION, EAlreadyMigrated);
        *v = CURRENT_VERSION;
    } else {
        df::add(&mut state.id, VersionKey {}, CURRENT_VERSION);
    };
}

// === Version view functions ===

public fun config_version(config: &CormConfig): u64 {
    if (df::exists_(&config.id, VersionKey {})) {
        *df::borrow(&config.id, VersionKey {})
    } else {
        1
    }
}

public fun state_version(state: &CormState): u64 {
    if (df::exists_(&state.id, VersionKey {})) {
        *df::borrow(&state.id, VersionKey {})
    } else {
        1
    }
}

// === Private version helpers ===

fun assert_config_version(config: &CormConfig) {
    assert!(config_version(config) == CURRENT_VERSION, EVersionMismatch);
}

fun assert_state_version(state: &CormState) {
    assert!(state_version(state) == CURRENT_VERSION, EVersionMismatch);
}

// === Test-only helpers ===

#[test_only]
public fun create_config_for_testing(
    brain_address: address,
    ctx: &mut TxContext,
): CormConfig {
    let mut config = CormConfig {
        id: object::new(ctx),
        brain_address,
    };
    df::add(&mut config.id, VersionKey {}, CURRENT_VERSION);
    config
}

#[test_only]
public fun destroy_config_for_testing(config: CormConfig) {
    let CormConfig { id, .. } = config;
    id.delete();
}

#[test_only]
public fun destroy_for_testing(state: CormState) {
    let CormState { id, .. } = state;
    id.delete();
}
