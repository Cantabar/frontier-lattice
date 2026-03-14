# Tribe Contract — In-Game Tribe Association & 1:1 Enforcement

## Problem
The `Tribe<C>` contract has no link to the in-game tribe system. Anyone can create unlimited tribes with no connection to actual Eve Frontier tribes. We need:
1. Each on-chain `Tribe` to be associated with exactly one in-game tribe (via the `tribe_id: u32` from the world `Character` contract).
2. A one-to-one constraint: only one `Tribe<C>` per in-game tribe ID.

## Current State
- `Character` (world contract, `character.move`) has `tribe_id: u32` — the in-game tribe assignment, set by admin.
- `Tribe<C>` (`tribe.move`) has `name`, `leader_character_id`, `members`, `reputation`, `treasury`, but **no in-game tribe reference**.
- `create_tribe` takes a `Character` ref and a name, but never reads `character.tribe_id`.

## Proposed Changes

### 1. Add `TribeRegistry` shared singleton
A new shared object created via the module `init` function (auto-created on publish, guarantees exactly one). Holds:
- `registry: Table<u32, ID>` — maps `in_game_tribe_id -> Tribe<C> object ID`

This enforces the 1:1 constraint globally. Using `u32` to match the world contract's `tribe_id` type.
Since `Table` is generic and `Tribe<C>` is parameterized by coin type, the registry key is the in-game tribe ID (`u32`) and the value is the `Tribe` object `ID`. A single registry works regardless of coin type `C`.

### 2. Add `in_game_tribe_id: u32` to `Tribe<C>`
New field on the `Tribe` struct storing the linked in-game tribe ID. Exposed via a new view function `in_game_tribe_id<C>(tribe: &Tribe<C>): u32`.

### 3. Update `create_tribe` signature & logic
New signature adds `registry: &mut TribeRegistry` parameter. Logic changes:
- Read `character.tribe()` to get the leader's in-game tribe ID.
- Assert `!registry.registry.contains(in_game_tribe_id)` — fail if an on-chain tribe already exists for this in-game tribe.
- Store `in_game_tribe_id` on the new `Tribe` object.
- Insert `in_game_tribe_id -> tribe_id` into the registry after creating the tribe.

### 4. Validate leader belongs to the in-game tribe
The leader's `Character.tribe_id` is the source of truth for which in-game tribe they belong to. `create_tribe` will use this value directly — the creator can only create a tribe for the in-game tribe they're actually in.

### 5. New error constants
- `EInGameTribeAlreadyClaimed: u64 = 14` — a Tribe already exists for this in-game tribe ID.
- `EInGameTribeIdInvalid: u64 = 15` — the character's in-game tribe ID is zero/invalid.

### 6. Add `TribeRegistry` event
- `TribeRegistryCreatedEvent` — emitted when the registry singleton is created.

### 7. Update tests
- Update `create_tribe` calls to pass the registry.
- Add test: second `create_tribe` for the same in-game tribe aborts with `EInGameTribeAlreadyClaimed`.
- Add test: character with tribe_id=0 cannot create a tribe.

### 8. View function additions
- `in_game_tribe_id<C>(tribe: &Tribe<C>): u32`
- `tribe_for_game_id(registry: &TribeRegistry, game_tribe_id: u32): Option<ID>` — lookup whether an on-chain tribe exists for a given in-game tribe.

## Files Changed
- `contracts/tribe/sources/tribe.move` — all struct/function changes
- `contracts/tribe/tests/tribe_tests.move` — updated and new tests
