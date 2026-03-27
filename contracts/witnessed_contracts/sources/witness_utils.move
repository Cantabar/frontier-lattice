/// Witness Utilities — shared attestation verification logic for all
/// witnessed contract modules.
///
/// Provides Ed25519 signature verification against the CORM
/// `WitnessRegistry`, BCS deserialization for attestation structs,
/// and deadline validation.
///
/// All helper functions are `public(package)` — visible to sibling modules
/// within this package but invisible to external packages.
module witnessed_contracts::witness_utils;

use sui::{bcs, clock::Clock};
use corm_auth::corm_auth::WitnessRegistry;
use world::sig_verify;

// === Errors ===

const EInvalidWitness: u64 = 0;
const ESignatureVerificationFailed: u64 = 1;
const EAttestationExpired: u64 = 2;

// === Build Attestation ===

/// Deserialized build attestation signed by a CORM witness.
/// Fields are ordered to match the BCS encoding produced by the indexer.
public struct BuildAttestation has copy, drop {
    contract_id: ID,
    witness_address: address,
    builder_character_id: ID,
    builder_address: address,
    structure_id: ID,
    structure_type_id: u64,
    owner_cap_id: ID,
    extension_authorized: bool,
    anchor_tx_digest: vector<u8>,
    anchor_checkpoint_seq: u64,
    extension_tx_digest: vector<u8>,
    deadline_ms: u64,
}

// === Public(package) helpers ===

/// Verify an Ed25519 signature against the WitnessRegistry and return
/// the deserialized `BuildAttestation`.
///
/// Aborts if:
///  - the signer is not in `WitnessRegistry`
///  - Ed25519 verification fails
///  - the attestation deadline has passed
public(package) fun verify_and_unpack_build_attestation(
    attestation_bytes: vector<u8>,
    signature: vector<u8>,
    registry: &WitnessRegistry,
    clock: &Clock,
): BuildAttestation {
    let attestation = unpack_build_attestation(attestation_bytes);

    // 1. Check witness is registered
    assert!(
        corm_auth::corm_auth::is_witness(registry, attestation.witness_address),
        EInvalidWitness,
    );

    // 2. Verify Ed25519 signature
    assert!(
        sig_verify::verify_signature(
            attestation_bytes,
            signature,
            attestation.witness_address,
        ),
        ESignatureVerificationFailed,
    );

    // 3. Check attestation deadline
    assert!(attestation.deadline_ms > clock.timestamp_ms(), EAttestationExpired);

    attestation
}

// === Attestation accessors ===

public(package) fun contract_id(a: &BuildAttestation): ID { a.contract_id }
public(package) fun witness_address(a: &BuildAttestation): address { a.witness_address }
public(package) fun builder_character_id(a: &BuildAttestation): ID { a.builder_character_id }
public(package) fun builder_address(a: &BuildAttestation): address { a.builder_address }
public(package) fun structure_id(a: &BuildAttestation): ID { a.structure_id }
public(package) fun structure_type_id(a: &BuildAttestation): u64 { a.structure_type_id }
public(package) fun owner_cap_id(a: &BuildAttestation): ID { a.owner_cap_id }
public(package) fun extension_authorized(a: &BuildAttestation): bool { a.extension_authorized }

// === BCS deserialization ===

/// Deserialize a `BuildAttestation` from BCS bytes.
/// Field order must match the encoding produced by the indexer's
/// `attestation.ts` module.
fun unpack_build_attestation(bytes: vector<u8>): BuildAttestation {
    let mut bcs_data = bcs::new(bytes);

    let contract_id = object::id_from_address(bcs_data.peel_address());
    let witness_address = bcs_data.peel_address();
    let builder_character_id = object::id_from_address(bcs_data.peel_address());
    let builder_address = bcs_data.peel_address();
    let structure_id = object::id_from_address(bcs_data.peel_address());
    let structure_type_id = bcs_data.peel_u64();
    let owner_cap_id = object::id_from_address(bcs_data.peel_address());
    let extension_authorized = bcs_data.peel_bool();
    let anchor_tx_digest = bcs_data.peel_vec!(|b| b.peel_u8());
    let anchor_checkpoint_seq = bcs_data.peel_u64();
    let extension_tx_digest = bcs_data.peel_vec!(|b| b.peel_u8());
    let deadline_ms = bcs_data.peel_u64();

    BuildAttestation {
        contract_id,
        witness_address,
        builder_character_id,
        builder_address,
        structure_id,
        structure_type_id,
        owner_cap_id,
        extension_authorized,
        anchor_tx_digest,
        anchor_checkpoint_seq,
        extension_tx_digest,
        deadline_ms,
    }
}

// === Test-only helpers ===

#[test_only]
public fun create_build_attestation_for_testing(
    contract_id: ID,
    witness_address: address,
    builder_character_id: ID,
    builder_address: address,
    structure_id: ID,
    structure_type_id: u64,
    owner_cap_id: ID,
    extension_authorized: bool,
    deadline_ms: u64,
): BuildAttestation {
    BuildAttestation {
        contract_id,
        witness_address,
        builder_character_id,
        builder_address,
        structure_id,
        structure_type_id,
        owner_cap_id,
        extension_authorized,
        anchor_tx_digest: vector[],
        anchor_checkpoint_seq: 0,
        extension_tx_digest: vector[],
        deadline_ms,
    }
}
