/// CORM — corm-minted incentive token representing a player's contribution
/// to continuity. Standard fungible coin; can be merged, split, and used
/// directly in trustless contracts.
///
/// Uses 4 decimal places (1 CORM = 10,000 base units) to maintain a 1:1
/// value relationship with LUX, the in-game currency. This allows item
/// prices with fractional LUX values to be expressed exactly in CORM.
///
/// Minting is gated through `MintCap` objects issued per-corm, held by the
/// corm-brain service keypair.
module corm_state::corm_coin;

use sui::{
    coin::{Self, TreasuryCap},
    event,
};

// === Errors ===
const ECormStateMismatch: u64 = 0;

// === One-time witness ===

/// One-time witness for `coin::create_currency`. The struct name must match
/// the module name in uppercase.
public struct CORM_COIN has drop {}

// === Shared authority ===

/// Shared object wrapping the `TreasuryCap<CORM_COIN>`. Not directly accessible;
/// all minting is gated through `MintCap` verification.
public struct CoinAuthority has key {
    id: UID,
    treasury_cap: TreasuryCap<CORM_COIN>,
}

// === Per-corm mint capability ===

/// Authorizes a specific corm to mint CORM tokens. Transferred to the
/// corm-brain operator on corm creation.
public struct MintCap has key, store {
    id: UID,
    /// The CormState object this cap is bound to.
    corm_state_id: ID,
    /// Lifetime mint count (provenance tracking).
    total_minted: u64,
}

// === Events ===

public struct CormCoinMintedEvent has copy, drop {
    corm_state_id: ID,
    recipient: address,
    amount: u64,
    total_minted: u64,
}

public struct CormCoinBurnedEvent has copy, drop {
    burner: address,
    amount: u64,
    new_total_supply: u64,
}

// === Init ===

/// Module initializer — creates the CORM currency and shares the
/// `CoinAuthority`. The `CoinMetadata` is frozen (immutable).
fun init(witness: CORM_COIN, ctx: &mut TxContext) {
    let (treasury_cap, metadata) = coin::create_currency<CORM_COIN>(
        witness,
        4,                              // decimals — 1 CORM = 10,000 base units (1:1 with LUX)
        b"CORM",                        // symbol
        b"CORM",                        // name
        b"Continuity contribution token", // description
        option::none(),                 // icon URL
        ctx,
    );

    transfer::public_freeze_object(metadata);

    transfer::share_object(CoinAuthority {
        id: object::new(ctx),
        treasury_cap,
    });
}

// === Package-visible helpers ===

/// Create a `MintCap` for a newly created corm. Called from `corm_state::create`.
public(package) fun create_mint_cap(
    corm_state_id: ID,
    ctx: &mut TxContext,
): MintCap {
    MintCap {
        id: object::new(ctx),
        corm_state_id,
        total_minted: 0,
    }
}

// === Public functions ===

/// Mint CORM tokens for a player. The caller must hold a valid `MintCap`
/// whose `corm_state_id` matches the provided CormState ID.
public fun mint(
    authority: &mut CoinAuthority,
    mint_cap: &mut MintCap,
    corm_state_id: ID,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert!(mint_cap.corm_state_id == corm_state_id, ECormStateMismatch);

    let minted = coin::mint(&mut authority.treasury_cap, amount, ctx);
    mint_cap.total_minted = mint_cap.total_minted + amount;

    event::emit(CormCoinMintedEvent {
        corm_state_id,
        recipient,
        amount,
        total_minted: mint_cap.total_minted,
    });

    transfer::public_transfer(minted, recipient);
}

/// Burn CORM tokens. Any holder may burn their own coins (permissionless
/// token sink). Emits `CormCoinBurnedEvent` with the post-burn total supply.
public fun burn(
    authority: &mut CoinAuthority,
    coin: coin::Coin<CORM_COIN>,
    ctx: &TxContext,
) {
    let amount = coin.value();
    coin::burn(&mut authority.treasury_cap, coin);
    let new_total_supply = coin::total_supply(&authority.treasury_cap);

    event::emit(CormCoinBurnedEvent {
        burner: ctx.sender(),
        amount,
        new_total_supply,
    });
}

// === View functions ===

public fun total_supply(authority: &CoinAuthority): u64 {
    coin::total_supply(&authority.treasury_cap)
}

public fun mint_cap_corm_state_id(cap: &MintCap): ID { cap.corm_state_id }
public fun mint_cap_total_minted(cap: &MintCap): u64 { cap.total_minted }

// === Test-only helpers ===

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(CORM_COIN {}, ctx);
}

#[test_only]
public fun destroy_mint_cap_for_testing(cap: MintCap) {
    let MintCap { id, .. } = cap;
    id.delete();
}
