/// Shared extension witness and witness registry for Frontier Corm.
///
/// **CormAuth** — typed witness for SSU/Gate/Turret extension authorization.
/// Structure owners register it once via `authorize_extension<CormAuth>()`
/// to grant deposit/withdraw (SSU), jump-permit (Gate), or targeting (Turret)
/// authority to any Corm contract.
///
/// **WitnessRegistry** — shared object storing Ed25519 addresses of
/// authorized off-chain witnesses (e.g. the CORM indexer). Witnessed
/// contracts verify attestation signatures against this registry.
module corm_auth::corm_auth;

use sui::table::{Self, Table};
use sui::dynamic_field as df;

// === Version ===
const CURRENT_VERSION: u64 = 1;

// === Errors ===
const EVersionMismatch: u64 = 100;
const EAlreadyMigrated: u64 = 101;

/// Dynamic-field key for version tracking on shared objects that were
/// published without a `version` struct field.
public struct VersionKey has copy, drop, store {}

/// Typed witness for SSU extension authorization.
public struct CormAuth has drop {}

/// Admin capability for the CORM system. Transferred to the publisher on
/// package deploy. Used to authorise future migrations or admin operations.
public struct CormAdminCap has key, store {
    id: UID,
}

/// Registry of Ed25519 addresses authorized to sign witness attestations.
/// Managed by `CormAdminCap`. Analogous to the world's
/// `ServerAddressRegistry` but under CORM control.
public struct WitnessRegistry has key {
    id: UID,
    witnesses: Table<address, bool>,
}

/// Creates the `CormAdminCap` and `WitnessRegistry`.
fun init(ctx: &mut TxContext) {
    transfer::transfer(
        CormAdminCap { id: object::new(ctx) },
        ctx.sender(),
    );
    let mut registry = WitnessRegistry {
        id: object::new(ctx),
        witnesses: table::new(ctx),
    };
    df::add(&mut registry.id, VersionKey {}, CURRENT_VERSION);
    transfer::share_object(registry);
}

/// Construct a `CormAuth` witness value.
public fun auth(): CormAuth { CormAuth {} }

// === WitnessRegistry management ===

/// Register an Ed25519 address as an authorized witness.
public fun register_witness(
    registry: &mut WitnessRegistry,
    _admin_cap: &CormAdminCap,
    witness: address,
) {
    assert_registry_version(registry);
    if (!registry.witnesses.contains(witness)) {
        registry.witnesses.add(witness, true);
    };
}

/// Remove an authorized witness address.
public fun remove_witness(
    registry: &mut WitnessRegistry,
    _admin_cap: &CormAdminCap,
    witness: address,
) {
    assert_registry_version(registry);
    if (registry.witnesses.contains(witness)) {
        registry.witnesses.remove(witness);
    };
}

/// Check if an address is a registered witness.
public fun is_witness(registry: &WitnessRegistry, witness: address): bool {
    registry.witnesses.contains(witness)
}

// === Migration ===

/// Migrate the WitnessRegistry to the current version. Admin-gated.
/// For objects published without a version field, this stamps the
/// dynamic-field version. On the first call (pre-upgrade objects) it
/// adds the field; on subsequent upgrades it bumps it.
public fun migrate_registry(
    registry: &mut WitnessRegistry,
    _admin_cap: &CormAdminCap,
) {
    if (df::exists_(&registry.id, VersionKey {})) {
        let v: &mut u64 = df::borrow_mut(&mut registry.id, VersionKey {});
        assert!(*v < CURRENT_VERSION, EAlreadyMigrated);
        *v = CURRENT_VERSION;
    } else {
        // Pre-upgrade object: stamp initial version
        df::add(&mut registry.id, VersionKey {}, CURRENT_VERSION);
    };
}

// === View ===

public fun registry_version(registry: &WitnessRegistry): u64 {
    if (df::exists_(&registry.id, VersionKey {})) {
        *df::borrow(&registry.id, VersionKey {})
    } else {
        1 // Pre-upgrade objects default to version 1
    }
}

// === Private helpers ===

fun assert_registry_version(registry: &WitnessRegistry) {
    assert!(registry_version(registry) == CURRENT_VERSION, EVersionMismatch);
}

// === Test-only helpers ===

#[test_only]
public fun create_admin_cap_for_testing(ctx: &mut TxContext): CormAdminCap {
    CormAdminCap { id: object::new(ctx) }
}

#[test_only]
public fun destroy_admin_cap_for_testing(cap: CormAdminCap) {
    let CormAdminCap { id } = cap;
    id.delete();
}

#[test_only]
public fun create_witness_registry_for_testing(ctx: &mut TxContext): WitnessRegistry {
    let mut registry = WitnessRegistry {
        id: object::new(ctx),
        witnesses: table::new(ctx),
    };
    df::add(&mut registry.id, VersionKey {}, CURRENT_VERSION);
    registry
}

#[test_only]
public fun destroy_witness_registry_for_testing(registry: WitnessRegistry) {
    let WitnessRegistry { id, witnesses } = registry;
    witnesses.drop();
    id.delete();
}
