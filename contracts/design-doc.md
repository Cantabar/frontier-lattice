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

- `CormConfig` — shared config object created once by admin after deploy. Stores the corm-brain service address (`brain_address`). Functions: `create_config` (admin-only), `set_brain_address` (admin-only).
- `CormState` — shared object per corm (one per network node). Fields: `network_node_id`, `phase` (0–6, one-way progression), `stability` (0–100), `corruption` (0–100), `admin` (corm-brain keypair). Functions: `install` (permissionless — any player creates a CormState; admin and MintCap route to `CormConfig.brain_address`), `create` (admin-only, returns `MintCap`), `update_state` (admin-only), `transfer_admin`.
- `CormCoin` (via `corm_coin` module) — fungible token (`Coin<CORM_COIN>`) mintable by the corm-brain via `MintCap`. Uses 4 decimal places (1 CORM = 10,000 base units) to maintain a 1:1 value relationship with LUX, enabling fractional item prices to be expressed exactly in CORM. Key functions: `mint` (requires `MintCap`), `burn` (permissionless — any holder may burn their own coins as a token sink), `total_supply` (view — returns current circulating supply from `TreasuryCap`).
- Events: `CormStateCreatedEvent`, `CormStateUpdatedEvent`, `CormCoinMintedEvent`, `CormCoinBurnedEvent` (includes `burner`, `amount`, `new_total_supply`).

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
  - **Proximity gating (v2):** poster can optionally specify a `reference_structure_id`, `max_distance` (ly), and `proximity_tribe_id`. All three must be set or all three must be none (enforced on-chain via `EProximityMissingFields`). When set, the witness service only fulfills the contract if a verified mutual proximity proof exists in the location database linking the new structure to the reference within the specified distance. This implicitly restricts the contract to the poster's tribe, since location PODs and proximity proofs are tribe-scoped. The web UI prompts the poster to register a location POD for the reference structure if one does not yet exist.
- `witness_utils` — shared attestation verification: unpacks and verifies Ed25519 signatures, checks attestation fields (contract ID, structure type, builder, CormAuth status).
- Events: `BuildRequestCreatedEvent`, `BuildRequestFulfilledEvent`, `BuildRequestCancelledEvent`, `BuildRequestExpiredEvent`.

**continuity-engine integration:** The continuity-engine creates `BuildRequestContract<CORM_COIN>` objects directly via `chain.CreateBuildRequest()` when a corm's network node has no SSU. The corm-brain escrows a CORM bounty targeting the SSU structure type ID with `require_corm_auth = true`. The indexer's witness service detects the anchored structure + CormAuth extension and submits a `fulfill` transaction. Falls back to a UI-only `build_ssu` directive when `WITNESSED_CONTRACTS_PACKAGE_ID` is not configured.

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
- Publishing order: `tribe` → `corm_auth` → `trustless_contracts` → `witnessed_contracts` → `corm_state` → `assembly_metadata`
- **Post-deploy:** Both scripts automatically call `corm_state::create_config` after publishing, using the `CormAdminCap` (owned by the publisher from `corm_auth` init) and a brain address. This creates the shared `CormConfig` object required by the permissionless `install` function. The resulting `VITE_CORM_CONFIG_ID` is written to `.env.*` and `web/.env.*` files. For testnet, the brain address is read from `CORM_BRAIN_ADDRESS` env var or prompted interactively.
- **Idempotent re-runs:** The publish script detects already-published packages via `Published.toml` (auto-generated by the SUI CLI) and skips them, extracting existing package IDs instead. This makes the script safe to re-run after partial failures.
- **Stillness deployment:** All 6 packages deployed to Sui testnet (Stillness world). Package IDs and shared object IDs are in `.env.stillness` and `web/.env.stillness`.

## Features

- CormAuth typed witness for SSU/Gate/Turret extension authorization
- Ed25519 witness registry for off-chain attestation verification
- CormConfig shared object with brain address for permissionless corm installation
- CormState shared object with phase progression (0–6), stability/corruption meters, and admin-gated updates
- Permissionless `install` function: any player can create a CormState for a network node; MintCap and admin authority auto-route to the brain
- CORM fungible token with 4-decimal precision (1:1 LUX parity), per-corm MintCap and shared CoinAuthority
- Permissionless CORM burn (token sink) with `CormCoinBurnedEvent` and on-chain `total_supply` view
- Tribe registry with 1:1 in-game tribe mapping, membership roles (Leader/Officer/Member), autonomous self-join, and versioned migration
- Six trustless contract types with on-chain escrow: coin-for-coin, coin-for-item, item-for-coin, item-for-item, multi-input, transport
- Partial fills, free giveaways (wanted_amount=0), filler access control (character/tribe allowlists)
- Contract lifecycle: create, fill, cancel, expire, cleanup (garbage collection)
- Witnessed build request contracts with cryptographic fulfillment via Ed25519 attestations and BCS deserialization
- Shared contract utilities: deadline validation, fill tracking, divisibility checks, item deposit/release via CormAuth extension
- Assembly metadata registry: OwnerCap-gated structure naming with admin cleanup for unanchored structures

### assembly_metadata

**Purpose:** On-chain registry for user-defined structure metadata (names, descriptions).

- `MetadataRegistry` — shared singleton mapping assembly IDs to `MetadataEntry` (owner, name, description).
- `create_metadata<T: key>` — requires `OwnerCap<T>` to prove assembly ownership. Generic over all structure types.
- `update_metadata` / `delete_metadata` — sender-gated (must match stored owner).
- `admin_cleanup` — `CormAdminCap`-gated removal for automated cleanup when structures are unanchored.
- Events: `MetadataRegistryCreatedEvent`, `MetadataCreatedEvent`, `MetadataUpdatedEvent`, `MetadataDeletedEvent`.

## Testing

Run all contract tests: `make test-contracts` from the repo root, or `sui move test` from any individual package directory.

### Test layout

Each package has a `tests/` directory with Move test files:

- **corm_auth** — `tests/` (empty; auth is exercised by downstream packages)
- **corm_state** — `corm_state_tests.move` (state install, phase progression, admin gates), `corm_coin_tests.move` (mint, burn, supply)
- **tribe** — `tribe_tests.move` (create, self-join, add/remove members, leadership transfer)
- **trustless_contracts** — `coin_for_coin_tests.move`, `coin_for_item_tests.move`, `item_for_coin_tests.move`, `multi_input_tests.move`, `transport_tests.move`, `test_helpers.move`
- **witnessed_contracts** — `build_request_tests.move`, `test_helpers.move`
- **assembly_metadata** — `assembly_metadata_tests.move`

All tests use `#[test]` and `#[test_only]` attributes with `sui::test_scenario` for simulating multi-party transactions.

## Open Questions / Future Work

- Migration from EVM to Sui is underway — some Eve Frontier resources may still reference EVM patterns
- Treasury module for tribe-controlled multi-asset treasuries (planned, see `plan/multi-asset-treasury.md`)
- Additional witnessed contract types beyond `build_request`
- Upgrade policy and versioned migration path for production
- CormState linking: on-chain `link` function to emit `CormLinkedEvent` and mark absorbed CormState objects as dormant (e.g. `is_active: bool` field or dynamic field)
- CormState linking: Hive Mind and Mutual Dissolution models require new on-chain primitives (shared agenda object, dissolution/re-creation flow)
