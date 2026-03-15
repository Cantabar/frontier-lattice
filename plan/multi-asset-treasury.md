# Multi-Asset Tribe Treasury

## Problem
The current `Tribe<C>` struct is parameterized by a single phantom coin type `C`, meaning the treasury can only hold one type of coin (`Balance<C>`). Tribes need the ability to:
1. **Add additional coin types** to their treasury (e.g. hold both EVE and USDC)
2. **Change the primary coin** used for the treasury (migration scenario)

## Current State
`contracts/tribe/sources/tribe.move`:
- `Tribe<C>` has `treasury: Balance<C>` — single coin type, locked at creation
- `deposit_to_treasury<C>`, `withdraw_from_treasury<C>`, `propose_treasury_spend<C>`, `execute_proposal<C>` all operate on `Balance<C>`
- `TreasuryProposal` is not parameterized — it stores amount/recipient/votes, but `execute_proposal<C>` resolves the coin type
- Downstream consumers (`contract_board`, `forge_planner`) call `withdraw_from_treasury` typed to `C`

## Proposed Changes

### 1. Add auxiliary treasury `Bag` to `Tribe<C>`
Add a `sui::bag::Bag` field to the `Tribe<C>` struct. This bag stores `Balance<T>` for any coin type `T`, keyed by `TypeName`. The primary `treasury: Balance<C>` is preserved for backward compatibility.

```move
public struct Tribe<phantom C> has key {
    // ... existing fields unchanged ...
    treasury: Balance<C>,           // primary coin (unchanged)
    auxiliary_treasury: Bag,        // NEW: holds Balance<T> for any T
}
```

Update `create_tribe<C>` and `self_join<C>` to initialize `auxiliary_treasury: bag::empty(ctx)`.

### 2. New auxiliary treasury functions in `tribe.move`
All new functions follow the same auth pattern as existing treasury ops.

**Deposit (open to anyone):**
- `deposit_to_aux_treasury<C, T>(tribe: &mut Tribe<C>, coin: Coin<T>)` — deposits any coin type. Creates the `Balance<T>` entry in the bag on first deposit.

**Withdraw (Leader/Officer):**
- `withdraw_from_aux_treasury<C, T>(tribe: &mut Tribe<C>, cap: &TribeCap, amount: u64, ctx): Coin<T>` — withdraws from auxiliary. Same auth check as `withdraw_from_treasury`.

**View:**
- `aux_treasury_balance<C, T>(tribe: &Tribe<C>): u64` — returns balance for coin type `T`, or 0 if not present.
- `has_aux_coin<C, T>(tribe: &Tribe<C>): bool` — checks if coin type `T` exists in the auxiliary bag.

**Events:**
- `AuxTreasuryDepositEvent { tribe_id, coin_type: TypeName, amount }`
- `AuxTreasuryWithdrawEvent { tribe_id, coin_type: TypeName, amount, withdrawn_by }`

### 3. Auxiliary treasury proposals (voting)
Create a new typed proposal for auxiliary coin spends:

```move
public struct AuxTreasuryProposal<phantom T> has key {
    id: UID,
    tribe_id: ID,
    amount: u64,
    recipient: address,
    votes: Table<ID, bool>,
    vote_count: u64,
    executed: bool,
    deadline_ms: u64,
}
```

New functions:
- `propose_aux_treasury_spend<C, T>(tribe, cap, amount, recipient, deadline_ms, clock, ctx)`
- `vote_on_aux_proposal<C, T>(tribe, proposal, cap, clock)`
- `execute_aux_proposal<C, T>(tribe, proposal, clock, ctx)` — verifies `T` matches the proposal's phantom type

Corresponding events: `AuxTreasuryProposalCreatedEvent`, `AuxTreasuryProposalVotedEvent`, `AuxTreasurySpendEvent` (all include `coin_type: TypeName`).

### 4. Downstream integration — Contract Board
Add a new entry point in `contract_board.move`:
- `create_job_from_aux_treasury<C, T>(tribe, cap, character, ..., escrow_amount, ...)` — withdraws `Coin<T>` from the auxiliary treasury and creates a `JobPosting<T>`.

This allows tribes to fund jobs in any coin they hold, not just the primary.

### 5. Primary coin migration (change the treasury coin)
For tribes that want to **change** their primary coin entirely, provide a helper:
- `migrate_primary_to_aux<C>(tribe: &mut Tribe<C>, cap: &TribeCap, ctx)` — moves all of `Balance<C>` from `treasury` into the auxiliary bag (keyed by `TypeName` of `C`), leaving `treasury` at zero.

The tribe's primary treasury becomes effectively empty, and all funds live in the auxiliary bag. Callers then use `withdraw_from_aux_treasury<C, T>` for the old coin and `deposit_to_aux_treasury<C, NewCoin>` for the new one.

Full type migration (changing `Tribe<C>` to `Tribe<NewCoin>`) is not possible without object destruction/recreation, so this migration pattern is the pragmatic solution.

### 6. Tests
Add test cases to `contracts/tribe/tests/tribe_tests.move`:
- Deposit a second coin type into aux treasury
- Withdraw from aux treasury (Leader/Officer)
- Verify unauthorized withdraw fails
- Propose and vote on aux treasury spend
- Execute passed aux proposal
- Migrate primary to aux
- View function correctness (`aux_treasury_balance`, `has_aux_coin`)

## Files Modified
- `contracts/tribe/sources/tribe.move` — struct change + new functions
- `contracts/tribe/tests/tribe_tests.move` — new tests
- `contracts/contract_board/sources/contract_board.move` — new `create_job_from_aux_treasury`

## Not in Scope
- Forge planner auxiliary treasury integration (can be added later following the same pattern)
- Trustless contracts auxiliary integration (already dual-generic with `CE`/`CF`)
- UI changes
