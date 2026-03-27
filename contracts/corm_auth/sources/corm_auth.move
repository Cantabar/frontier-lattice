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
    transfer::share_object(WitnessRegistry {
        id: object::new(ctx),
        witnesses: table::new(ctx),
    });
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
    if (registry.witnesses.contains(witness)) {
        registry.witnesses.remove(witness);
    };
}

/// Check if an address is a registered witness.
public fun is_witness(registry: &WitnessRegistry, witness: address): bool {
    registry.witnesses.contains(witness)
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
    WitnessRegistry {
        id: object::new(ctx),
        witnesses: table::new(ctx),
    }
}

#[test_only]
public fun destroy_witness_registry_for_testing(registry: WitnessRegistry) {
    let WitnessRegistry { id, witnesses } = registry;
    witnesses.drop();
    id.delete();
}
