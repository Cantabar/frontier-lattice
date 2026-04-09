# Problem
When an `ItemForCoin` contract is canceled (or expired/cleaned up), remaining items are always returned to the poster's **player inventory** via `release_items_to_owned` (`contract_utils.move:206`). When the poster is the SSU owner, the in-game UI shows the **owner inventory** instead — so the returned items are invisible to them.
The root cause is that `release_items_to_owned` unconditionally calls `ssu.deposit_to_owned()` (player inventory). It should call `ssu.deposit_item()` (owner inventory) when the poster is the SSU owner.
## Current State
* `contract_utils.move` already has `deposit_to_destination()` (line 180) which routes items based on `use_owner_inventory: bool` — but this is only used in the fill path for `coin_for_item` and `item_for_item`.
* `release_items_to_owned()` (line 206) always deposits to player inventory. Used by cancel/expire/cleanup in `item_for_coin` and `item_for_item`.
* `coin_for_item` and `item_for_item` contracts have a `use_owner_inventory` field on their structs. `item_for_coin` does not.
* Sui compatible upgrades forbid changing existing public function signatures or struct layouts.
## Proposed Changes
### 1. `contract_utils.move` — Add `release_items_to_owner_inventory` helper
New `public(package)` function that withdraws from open inventory and deposits via `ssu.deposit_item()` (owner inventory). Mirrors `release_items_to_owned` but targets the other inventory.
### 2. `item_for_coin.move` — Add `_to_owner` function variants
Since we cannot change existing function signatures on upgrade, add three new public functions:
* `cancel_to_owner(contract, poster_character, source_ssu, ctx)` — same as `cancel` but calls `release_items_to_owner_inventory`
* `expire_to_owner(contract, poster_character, source_ssu, clock, ctx)` — same as `expire`
* `cleanup_to_owner(contract, poster_character, source_ssu, ctx)` — same as `cleanup`
Existing `cancel`/`expire`/`cleanup` remain unchanged for backwards compatibility.
### 3. `item_for_coin_tests.move` — Add tests
* `test_cancel_to_owner_returns_to_owner_inventory` — SSU owner creates contract, cancels via `cancel_to_owner`, verify items land in `storage_unit.owner_cap_id()` key (owner inventory).
* `test_expire_to_owner_returns_to_owner_inventory` — same pattern for expire.
### 4. `web/src/lib/sui.ts` — Update PTB builders
Update `buildCancelItemContract`, `buildExpireItemContract`, and `buildCleanupCompletedItemContract` to accept a `useOwnerInventory` flag. When true and variant is `ItemForCoin`, call the `_to_owner` Move function instead of the default.
### 5. Update design doc
Document the new `_to_owner` variants in `contracts/design-doc.md` under the trustless_contracts section.
## Out of scope
`item_for_item` has the same bug in its cancel/expire/cleanup — it ignores the stored `use_owner_inventory` flag when returning offered items. This should be addressed in a follow-up with the same pattern (or by reading the stored field in the existing functions since the struct already has it).
