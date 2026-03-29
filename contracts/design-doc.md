# Contracts

## Overview

The contracts directory contains all Sui Move smart contracts for Frontier Corm. These define the on-chain primitives for corm identity and authorization, tribe social structures, peer-to-peer trustless exchanges, and off-chain-witnessed bounty fulfillment. All contracts are deployed to Sui testnet and target integration with Eve Frontier's world contracts.

## Architecture

### Package Dependency Graph

```
world::character (external, Eve Frontier)
       │
       ├──────────────────────┐
       ▼                      ▼
  tribe::tribe      trustless_contracts::*
                          │
                          ▼
                   contract_utils (shared)

corm_auth::corm_auth
       │
       ├────────────────────┐
       ▼                    ▼
corm_state::corm_state   witnessed_contracts::*
       │                    │
       ▼                    ▼
corm_state::corm_coin    witness_utils (shared)
```

- `corm_auth` has no internal dependencies (standalone witness/registry)
- `corm_state` depends on `corm_auth` (requires `CormAdminCap`)
- `tribe` depends on `world::character` (reads in-game tribe ID)
- `trustless_contracts` depends on `world::character` (filler identity)
- `witnessed_contracts` depends on `corm_auth` (witness registry verification)

## Modules

### corm_auth

**Purpose:** Shared extension witness and Ed25519 witness registry for the CORM system.

- `CormAuth` — typed witness struct for SSU/Gate/Turret extension authorization. Structure owners register it once to grant deposit/withdraw/permit authority to any Corm contract.
- `CormAdminCap` — admin capability transferred to the publisher on deploy. Used for registry management and future migrations.
- `WitnessRegistry` — shared object storing Ed25519 addresses authorized to sign off-chain attestations (e.g. the CORM indexer). Functions: `register_witness`, `remove_witness`, `is_witness`.

### corm_state

**Purpose:** On-chain shared object representing a corm's canonical state and its fungible token.

- `CormState` — shared object per corm (one per network node). Fields: `network_node_id`, `phase` (0–6, one-way progression), `stability` (0–100), `corruption` (0–100), `admin` (corm-brain keypair). Functions: `create` (requires `CormAdminCap`, returns `MintCap`), `update_state` (admin-only), `transfer_admin`.
- `CormCoin` (via `corm_coin` module) — fungible token (`Coin<CORM_COIN>`) mintable by the corm-brain via `MintCap`. Used for in-game rewards.
- Events: `CormStateCreatedEvent`, `CormStateUpdatedEvent`.

### tribe

**Purpose:** On-chain tribe registry with membership roles and leadership.

- `TribeRegistry` — shared singleton enforcing one on-chain `Tribe` per in-game tribe ID (read from `world::Character`).
- `Tribe` — shared object per tribe. Fields: `name`, `in_game_tribe_id`, `leader_character_id`, `members` (Table<ID, Role>), `member_count`. Versioned for future migrations.
- `TribeCap` — owned capability proving membership + role (Leader/Officer/Member). Held by member's wallet.
- Key functions: `create_tribe` (links to in-game tribe via Character), `self_join` (autonomous join if Character's tribe matches), `add_member`, `remove_member`, `transfer_leadership`.
- Events: `TribeCreatedEvent`, `MemberJoinedEvent`, `MemberRemovedEvent`, `LeadershipTransferredEvent`.

### trustless_contracts

**Purpose:** Peer-to-peer exchange contracts with on-chain escrow. Six contract types across six source files:

- **coin_for_coin** — poster locks `Coin<CE>`, wants `Coin<CF>`. Supports partial fills and free giveaways (`wanted_amount = 0`).
- **coin_for_item** — poster locks coins, wants in-game items.
- **item_for_coin** — poster locks items, wants coins.
- **item_for_item** — poster locks items, wants different items.
- **multi_input** — multi-slot contract where multiple fillers contribute to named slots.
- **transport** — transport bounty for moving items between locations.

Shared utilities in `contract_utils`: deadline validation, fill tracking, divisibility checks, access control (allowed characters/tribes), status enum, version management.

All contract types emit creation, fill, completion, cancellation, and expiration events.

### witnessed_contracts

**Purpose:** Bounty contracts fulfilled by off-chain witness attestation rather than direct on-chain interaction.

- **build_request** — poster escrows a bounty coin for building a specific structure type (optionally requiring CormAuth extension). Fulfillment is verified cryptographically: the CORM indexer signs a `BuildAttestation` (Ed25519), and anyone can submit it to `fulfill`, which verifies the signature against the `WitnessRegistry`.
- `witness_utils` — shared attestation verification: unpacks and verifies Ed25519 signatures, checks attestation fields (contract ID, structure type, builder, CormAuth status).
- Events: `BuildRequestCreatedEvent`, `BuildRequestFulfilledEvent`, `BuildRequestCancelledEvent`, `BuildRequestExpiredEvent`.

## Tech Stack

- **Language:** Sui Move
- **Target chain:** Sui testnet
- **External dependency:** `world::character` (Eve Frontier world contracts)
- **Build:** `sui move build`
- **Test:** `sui move test`

## Configuration

Each contract package has a `Move.toml` with dependency addresses. Package IDs are environment-specific and written to `.env.localnet` / `.env.utopia` / `.env.stillness` after publishing.

## Deployment

- **Local:** `scripts/publish-contracts-local.sh` (publishes all packages in dependency order after world contracts are deployed)
- **Testnet:** `make publish-contracts ENV=utopia|stillness` (via `scripts/publish-contracts.sh`)
- Publishing order: `corm_auth` → `corm_state` → `tribe` → `trustless_contracts` → `witnessed_contracts`

## Features

- CormAuth typed witness for SSU/Gate/Turret extension authorization
- Ed25519 witness registry for off-chain attestation verification
- CormState shared object with phase progression (0–6), stability/corruption meters, and admin-gated updates
- CORM fungible token with per-corm MintCap and shared CoinAuthority
- Tribe registry with 1:1 in-game tribe mapping, membership roles (Leader/Officer/Member), autonomous self-join, and versioned migration
- Six trustless contract types with on-chain escrow: coin-for-coin, coin-for-item, item-for-coin, item-for-item, multi-input, transport
- Partial fills, free giveaways (wanted_amount=0), filler access control (character/tribe allowlists)
- Contract lifecycle: create, fill, cancel, expire, cleanup (garbage collection)
- Witnessed build request contracts with cryptographic fulfillment via Ed25519 attestations and BCS deserialization
- Shared contract utilities: deadline validation, fill tracking, divisibility checks, item deposit/release via CormAuth extension

## Open Questions / Future Work

- Migration from EVM to Sui is underway — some Eve Frontier resources may still reference EVM patterns
- Treasury module for tribe-controlled multi-asset treasuries (planned, see `plan/multi-asset-treasury.md`)
- Additional witnessed contract types beyond `build_request`
- Upgrade policy and versioned migration path for production
