#[test_only]
module witnessed_contracts::test_helpers;

use corm_auth::corm_auth::{Self, CormAdminCap, WitnessRegistry};

// === Known Ed25519 test keypair ===
// Reused from world/tests/crypto/sig_verify_tests.move.
// Public key: a94e21ea26cc336019c11a5e10c4b39160188dda0f6b4bfe198dd689db8f3df9
// Derived SUI address: 93d3209c7f138aded41dcb008d066ae872ed558bd8dcb562da47d4ef78295333

public fun witness_address(): address {
    sui::address::from_bytes(
        x"93d3209c7f138aded41dcb008d066ae872ed558bd8dcb562da47d4ef78295333",
    )
}

// === Test constants ===

public fun poster(): address { @0xA }
public fun builder(): address { @0xB }
public fun poster_id(): ID { object::id_from_address(@0xA) }
public fun builder_character_id(): ID { object::id_from_address(@0xB) }
public fun structure_id(): ID { object::id_from_address(@0xC) }
public fun owner_cap_id(): ID { object::id_from_address(@0xD) }
public fun requested_type_id(): u64 { 88082 } // Mini Storage
public fun bounty_amount(): u64 { 1000 }
public fun far_future_ms(): u64 { 9_999_999_999_999 }

// === Helpers ===

/// Create a WitnessRegistry with the known test witness address registered.
public fun setup_registry(ctx: &mut TxContext): (WitnessRegistry, CormAdminCap) {
    let mut registry = corm_auth::create_witness_registry_for_testing(ctx);
    let admin_cap = corm_auth::create_admin_cap_for_testing(ctx);
    corm_auth::register_witness(&mut registry, &admin_cap, witness_address());
    (registry, admin_cap)
}

/// Tear down registry and admin cap.
public fun teardown_registry(registry: WitnessRegistry, admin_cap: CormAdminCap) {
    corm_auth::destroy_witness_registry_for_testing(registry);
    corm_auth::destroy_admin_cap_for_testing(admin_cap);
}
