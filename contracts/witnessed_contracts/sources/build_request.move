/// BuildRequest — witnessed bounty for building a specific structure type
/// with optional CormAuth extension.
///
/// Poster escrows a coin bounty. When a builder anchors a matching
/// structure (and optionally enables CormAuth), the CORM indexer signs
/// a `BuildAttestation`. Anyone can submit the attestation to `fulfill`,
/// which verifies the Ed25519 signature against the `WitnessRegistry`
/// and releases the bounty to the builder.
///
/// No builder stake is needed — fulfillment is verified cryptographically.
module witnessed_contracts::build_request;

use sui::{
    balance::Balance,
    clock::Clock,
    coin::{Self, Coin},
    event,
};
use corm_auth::corm_auth::WitnessRegistry;
use witnessed_contracts::witness_utils;

// === Version ===
const CURRENT_VERSION: u64 = 1;

// === Errors ===

const EDeadlineInPast: u64 = 0;
const EContractExpired: u64 = 1;
const EContractNotExpired: u64 = 2;
const ENotPoster: u64 = 3;
const EContractNotOpen: u64 = 4;
const EContractNotCompleted: u64 = 5;
const EZeroBounty: u64 = 6;

// Witness-specific errors (100+)
const ETypeMismatch: u64 = 100;
const ECormAuthNotAttested: u64 = 101;
const EContractIdMismatch: u64 = 102;
const EFillerNotAuthorized: u64 = 103;

// === Status enum ===

public enum ContractStatus has copy, drop, store {
    Open,
    Completed,
}

// === Structs ===

public struct BuildRequestContract<phantom C> has key {
    id: UID,
    version: u64,
    poster_id: ID,
    poster_address: address,
    bounty: Balance<C>,
    bounty_amount: u64,
    requested_type_id: u64,
    require_corm_auth: bool,
    builder_address: Option<address>,
    structure_id: Option<ID>,
    deadline_ms: u64,
    status: ContractStatus,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
}

// === Events ===

public struct BuildRequestCreatedEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    requested_type_id: u64,
    require_corm_auth: bool,
    bounty_amount: u64,
    deadline_ms: u64,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
}

public struct BuildRequestFulfilledEvent has copy, drop {
    contract_id: ID,
    builder_address: address,
    structure_id: ID,
    structure_type_id: u64,
    bounty_paid: u64,
}

public struct BuildRequestCancelledEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    bounty_returned: u64,
}

public struct BuildRequestExpiredEvent has copy, drop {
    contract_id: ID,
    poster_id: ID,
    bounty_returned: u64,
}

// === Public Functions ===

/// Create a build request. Poster escrows a bounty coin.
public fun create<C>(
    poster_id: ID,
    poster_address: address,
    bounty_coin: Coin<C>,
    requested_type_id: u64,
    require_corm_auth: bool,
    deadline_ms: u64,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(deadline_ms > clock.timestamp_ms(), EDeadlineInPast);
    assert!(bounty_coin.value() > 0, EZeroBounty);

    let bounty_amount = bounty_coin.value();

    let contract = BuildRequestContract<C> {
        id: object::new(ctx),
        version: CURRENT_VERSION,
        poster_id,
        poster_address,
        bounty: bounty_coin.into_balance(),
        bounty_amount,
        requested_type_id,
        require_corm_auth,
        builder_address: option::none(),
        structure_id: option::none(),
        deadline_ms,
        status: ContractStatus::Open,
        allowed_characters,
        allowed_tribes,
    };

    let contract_id = object::id(&contract);
    event::emit(BuildRequestCreatedEvent {
        contract_id,
        poster_id,
        requested_type_id,
        require_corm_auth,
        bounty_amount,
        deadline_ms,
        allowed_characters: contract.allowed_characters,
        allowed_tribes: contract.allowed_tribes,
    });

    transfer::share_object(contract);
}

/// Fulfill a build request with a witness attestation.
/// Anyone can submit this — the indexer typically does it automatically.
public fun fulfill<C>(
    contract: &mut BuildRequestContract<C>,
    attestation_bytes: vector<u8>,
    signature: vector<u8>,
    registry: &WitnessRegistry,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(clock.timestamp_ms() <= contract.deadline_ms, EContractExpired);

    let attestation = witness_utils::verify_and_unpack_build_attestation(
        attestation_bytes,
        signature,
        registry,
        clock,
    );

    // Verify attestation matches contract requirements
    assert!(
        witness_utils::contract_id(&attestation) == object::id(contract),
        EContractIdMismatch,
    );
    assert!(
        witness_utils::structure_type_id(&attestation) == contract.requested_type_id,
        ETypeMismatch,
    );
    if (contract.require_corm_auth) {
        assert!(witness_utils::extension_authorized(&attestation), ECormAuthNotAttested);
    };

    // Access control: check builder is allowed (if lists are set)
    verify_builder_access(
        &contract.allowed_characters,
        &contract.allowed_tribes,
        witness_utils::builder_character_id(&attestation),
    );

    // Record fulfillment
    let builder_addr = witness_utils::builder_address(&attestation);
    contract.builder_address = option::some(builder_addr);
    contract.structure_id = option::some(witness_utils::structure_id(&attestation));
    contract.status = ContractStatus::Completed;

    // Pay out bounty
    let bounty_paid = contract.bounty.value();
    if (bounty_paid > 0) {
        let payout = coin::take(&mut contract.bounty, bounty_paid, ctx);
        transfer::public_transfer(payout, builder_addr);
    };

    event::emit(BuildRequestFulfilledEvent {
        contract_id: object::id(contract),
        builder_address: builder_addr,
        structure_id: witness_utils::structure_id(&attestation),
        structure_type_id: witness_utils::structure_type_id(&attestation),
        bounty_paid,
    });
}

/// Cancel an open build request. Only the poster can cancel.
public fun cancel<C>(
    contract: BuildRequestContract<C>,
    poster_address: address,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(poster_address == contract.poster_address, ENotPoster);

    let contract_id = object::id(&contract);
    let bounty_returned = contract.bounty.value();

    let BuildRequestContract {
        id, poster_id, bounty, poster_address: addr, ..
    } = contract;

    if (bounty.value() > 0) {
        let refund = coin::from_balance(bounty, ctx);
        transfer::public_transfer(refund, addr);
    } else {
        bounty.destroy_zero();
    };

    event::emit(BuildRequestCancelledEvent {
        contract_id,
        poster_id,
        bounty_returned,
    });

    id.delete();
}

/// Expire a build request after its deadline. Anyone can call.
public fun expire<C>(
    contract: BuildRequestContract<C>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Open, EContractNotOpen);
    assert!(clock.timestamp_ms() > contract.deadline_ms, EContractNotExpired);

    let contract_id = object::id(&contract);
    let bounty_returned = contract.bounty.value();

    let BuildRequestContract {
        id, poster_id, bounty, poster_address, ..
    } = contract;

    if (bounty.value() > 0) {
        let refund = coin::from_balance(bounty, ctx);
        transfer::public_transfer(refund, poster_address);
    } else {
        bounty.destroy_zero();
    };

    event::emit(BuildRequestExpiredEvent {
        contract_id,
        poster_id,
        bounty_returned,
    });

    id.delete();
}

/// Garbage-collect a completed contract to reclaim storage.
public fun cleanup<C>(
    contract: BuildRequestContract<C>,
    ctx: &mut TxContext,
) {
    assert!(contract.status == ContractStatus::Completed, EContractNotCompleted);

    let BuildRequestContract {
        id, bounty, poster_address, ..
    } = contract;

    // Return any dust (should be zero after fulfill)
    if (bounty.value() > 0) {
        let dust = coin::from_balance(bounty, ctx);
        transfer::public_transfer(dust, poster_address);
    } else {
        bounty.destroy_zero();
    };

    id.delete();
}

// === View Functions ===

public fun contract_version<C>(c: &BuildRequestContract<C>): u64 { c.version }
public fun poster_id<C>(c: &BuildRequestContract<C>): ID { c.poster_id }
public fun poster_address<C>(c: &BuildRequestContract<C>): address { c.poster_address }
public fun bounty_amount<C>(c: &BuildRequestContract<C>): u64 { c.bounty_amount }
public fun bounty_balance<C>(c: &BuildRequestContract<C>): u64 { c.bounty.value() }
public fun requested_type_id<C>(c: &BuildRequestContract<C>): u64 { c.requested_type_id }
public fun require_corm_auth<C>(c: &BuildRequestContract<C>): bool { c.require_corm_auth }
public fun builder_address<C>(c: &BuildRequestContract<C>): Option<address> { c.builder_address }
public fun structure_id<C>(c: &BuildRequestContract<C>): Option<ID> { c.structure_id }
public fun deadline_ms<C>(c: &BuildRequestContract<C>): u64 { c.deadline_ms }
public fun status<C>(c: &BuildRequestContract<C>): ContractStatus { c.status }
public fun allowed_characters<C>(c: &BuildRequestContract<C>): vector<ID> { c.allowed_characters }
public fun allowed_tribes<C>(c: &BuildRequestContract<C>): vector<u32> { c.allowed_tribes }

// === Private helpers ===

/// Verify the builder is authorized (if access lists are set).
/// Open to all if both lists are empty. Otherwise, the builder's
/// character ID must appear in `allowed_characters`, or we accept
/// any builder (tribe filtering requires Character object, which we
/// don't have in witnessed contracts — so tribe ACL is only enforced
/// if the indexer witness service pre-filters by tribe).
fun verify_builder_access(
    allowed_characters: &vector<ID>,
    _allowed_tribes: &vector<u32>,
    builder_character_id: ID,
) {
    // If no restrictions, allow anyone
    if (allowed_characters.is_empty()) {
        return
    };

    let mut authorized = false;
    let mut i = 0;
    while (i < allowed_characters.length()) {
        if (allowed_characters[i] == builder_character_id) {
            authorized = true;
            break
        };
        i = i + 1;
    };
    assert!(authorized, EFillerNotAuthorized);
}

// === Test-only Helpers ===

#[test_only]
public fun destroy_for_testing<C>(contract: BuildRequestContract<C>) {
    let BuildRequestContract { id, bounty, .. } = contract;
    bounty.destroy_for_testing();
    id.delete();
}
