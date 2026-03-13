# Composable Trustless Contracts

Standalone Sui Move package for composable, trustless contracts with escrow, partial fulfillment, and SSU-based item verification.

## Problem

The existing Contract Board (Phase 2) is 1:1 poster/assignee, all-or-nothing, poster-confirmed. There's no:

- Partial fulfillment (multiple fillers contributing toward a target)
- Trustless verification (relies on poster confirmation)
- Item escrow (only coin escrow)
- Courier stake mechanism for transport
- Multi-coin-type support

## Current State

- `contract_board` package: `JobPosting<phantom C>` with single assignee, poster-confirmed completion, `Balance<C>` escrow, deleted on terminal state. 12 tests passing.
- `tribe` package: `Tribe<phantom C>`, `TribeCap`, `RepUpdateCap`, per-tribe reputation. 10 tests passing.
- World contracts: SSU extension pattern (`deposit_item<Auth>`, `withdraw_item<Auth>`, `deposit_to_open_inventory<Auth>`, `deposit_to_owned<Auth>`), `Item` transit objects with `parent_id` binding (items are SSU-bound), `Killmail` has no public getters.

## Key Constraints from World Contracts

- **Items are SSU-bound:** `parent_id` check on all deposit functions means items can only be deposited back into their originating SSU. Cross-SSU transfer is game-bridge only (off-chain).
- **Killmail/Gate fields are private:** No public getters on `Killmail` (`killer_id`, `victim_id` inaccessible). Bounty/transport verification via on-chain object reads is not currently possible.
- **SSU extension pattern:** Our module can register as the typed witness extension on an SSU, gaining `deposit_item<OurAuth>`, `withdraw_item<OurAuth>`, `deposit_to_open_inventory<OurAuth>`, `withdraw_from_open_inventory<OurAuth>`, `deposit_to_owned<OurAuth>` access.
- **Inventory view limitations:** `contains_item(inventory, type_id)` is public, but `item_quantity` is test-only. Quantity verification must happen through our extension controlling the actual withdraw/deposit flow (we inspect the transit `Item` object).

## Proposed Design

### New package: `contracts/trustless_contracts/`

Standalone package depending on `world` (for SSU/Item/Character types). No dependency on `contract_board`.

### Core Struct: `Contract<phantom C_ESCROW, phantom C_FILL>`

Shared object. One per contract.

**Two phantom coin types:**

- `C_ESCROW` — coin type the poster locks in escrow (their offer)
- `C_FILL` — coin type fillers pay in or couriers stake in
- In the common case (all EVE), both are the same type
- For item-only sides, the corresponding Balance is zero

**Fields:**

- `poster_id: ID` (Character ID)
- `poster_address: address`
- `contract_type: ContractType` (enum)
- `escrow: Balance<C_ESCROW>` (poster's locked coins — zero for Item-for-Coin)
- `fill_pool: Balance<C_FILL>` (accumulated filler payments — zero for Coin-for-Item)
- `courier_stake: Balance<C_FILL>` (courier's collateral — zero when no stake required)
- `courier_id: Option<ID>` (assigned courier, if transport)
- `courier_address: Option<address>`
- `target_quantity: u64` (total units wanted)
- `filled_quantity: u64` (units fulfilled so far)
- `allow_partial: bool`
- `require_stake: bool`
- `stake_amount: u64` (required collateral)
- `fills: Table<ID, u64>` (filler Character ID → quantity contributed)
- `ssu_source_id: Option<ID>` (SSU for item withdrawal, if applicable)
- `ssu_destination_id: Option<ID>` (SSU for item deposit/delivery)
- `item_type_id: u64` (world contract type_id for items involved, 0 if coin-only)
- `item_quantity_target: u32` (item units wanted)
- `item_quantity_filled: u32` (item units delivered so far)
- `deadline_ms: u64`
- `status: ContractStatus`
- `allowed_characters: vector<ID>` (Character IDs permitted to fill; empty = no restriction)
- `allowed_tribes: vector<u32>` (in-game tribe IDs permitted to fill; empty = no restriction)

### Filler Access Control

Uses the world contract's in-game tribe designation (`character.tribe(): u32`) rather than our Phase 1 Tribe module.

- **allowed_characters** — specific Character object IDs that may fill/accept
- **allowed_tribes** — in-game tribe IDs (read from `world::character::tribe()`)
- **Logic:** OR — filler is authorized if:
  - Both lists are empty (open to anyone), OR
  - Filler's Character ID is in `allowed_characters`, OR
  - Filler's `character.tribe()` is in `allowed_tribes`
- Checked on every `fill_*` and `accept_transport` call
- Poster sets these at contract creation

### Typed Witness Auth

```move
public struct TrustlessAuth has drop {}
public fun trustless_auth(): TrustlessAuth { TrustlessAuth {} }
```

SSU owners register `TrustlessAuth` as the extension on their SSU via `storage_unit::authorize_extension<TrustlessAuth>`. Our module then has deposit/withdraw authority on that SSU.

### ContractType Enum

```move
public enum ContractType has copy, drop, store {
    CoinForCoin { offered_amount: u64, wanted_amount: u64 },
    CoinForItem { offered_amount: u64, wanted_type_id: u64, wanted_quantity: u32, destination_ssu_id: ID },
    ItemForCoin { offered_type_id: u64, offered_quantity: u32, source_ssu_id: ID, wanted_amount: u64 },
    ItemForItem { offered_type_id: u64, offered_quantity: u32, source_ssu_id: ID, wanted_type_id: u64, wanted_quantity: u32, destination_ssu_id: ID },
    Transport { item_type_id: u64, item_quantity: u32, destination_ssu_id: ID, payment_amount: u64, required_stake: u64 },
}
```

### ContractStatus Enum

```move
public enum ContractStatus has copy, drop, store {
    Open,
    InProgress,   // courier accepted (transport only)
    Completed,
    Expired,
}
```

### Entry Points

**Creation:**

- `create_coin_for_coin<CE, CF>(escrow_coin, wanted_amount, allow_partial, deadline, clock, ctx)` — poster locks Coin<CE>, wants Coin<CF>
- `create_coin_for_item<CE, CF>(escrow_coin, wanted_type_id, wanted_quantity, destination_ssu_id, allow_partial, deadline, clock, ctx)` — poster locks coins, wants items at SSU
- `create_item_for_coin<CE, CF>(source_ssu, character, owner_cap, offered_type_id, offered_quantity, wanted_amount, allow_partial, deadline, clock, ctx)` — poster locks items at SSU (withdraw to open inventory), wants coins
- `create_item_for_item<CE, CF>(...)` — poster locks items, wants items
- `create_transport<CE, CF>(escrow_coin, item_type_id, item_quantity, destination_ssu_id, required_stake, deadline, clock, ctx)` — poster locks payment, defines delivery + stake

**Filling:**

- `fill_with_coins<CE, CF>(contract, fill_coin, character, ctx)` — filler pays coins, receives proportional escrow or items
- `fill_with_items<CE, CF>(contract, destination_ssu, character, item, ctx)` — filler deposits Item at SSU via `deposit_to_owned<TrustlessAuth>` to poster

**Transport:**

- `accept_transport<CE, CF>(contract, stake_coin, character, ctx)` — courier locks stake
- `deliver_transport<CE, CF>(contract, destination_ssu, courier_character, poster_character, item, ctx)` — trustless delivery verification

**Lifecycle:**

- `cancel_contract<CE, CF>(contract, source_ssu, character, ctx)` — poster cancels open contract
- `expire_contract<CE, CF>(contract, source_ssu, clock, ctx)` — anyone triggers after deadline

### Fill Mechanics (Partial Fulfillment)

- Each fill: `fill_amount = min(provided, remaining_target)`
- Proportional payout: `payout = (fill_amount * total_escrow) / target_quantity`
- `fills: Table<ID, u64>` accumulates per-filler contributions
- When `filled_quantity == target_quantity`, contract auto-completes and is deleted

### Item Escrow via SSU Open Inventory

1. Poster calls `create_*` with their SSU + OwnerCap
2. Our module calls `withdraw_by_owner` to get transit Item
3. Module calls `deposit_to_open_inventory<TrustlessAuth>` to lock items
4. Open inventory is only accessible via our extension
5. On completion/cancellation, items released via `withdraw_from_open_inventory<TrustlessAuth>` + `deposit_to_owned<TrustlessAuth>`

### Transport: Staked Courier

1. Poster creates transport contract, locks coin payment
2. Courier accepts, locks coin stake
3. Off-chain: courier acquires items, travels to destination SSU, bridges on-chain
4. On-chain at destination SSU: courier calls `deliver_transport`
   - Module verifies Item type_id + quantity
   - Module calls `deposit_to_owned<TrustlessAuth>` to push items to poster
   - Proportional payment + stake released to courier
5. Deadline expiry: stake forfeited to poster, payment returned to poster

### Events

- `ContractCreatedEvent` — all contract details for indexer
- `ContractFilledEvent` — filler_id, fill_quantity, payout, remaining
- `ContractCompletedEvent` — final totals
- `ContractCancelledEvent`
- `ContractExpiredEvent` — includes stake_forfeited
- `TransportAcceptedEvent` — courier_id, stake_amount
- `TransportDeliveredEvent` — delivery details + payment/stake released

### Object Lifecycle

Contracts are shared objects while active, deleted on terminal state. History lives in events. Storage rebate reclaimed on deletion.
