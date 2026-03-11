# Phase 3 Execution Notes — Forge Planner

**Dates**: March 11, 2026 (Days 11–16 of hackathon)
**Status**: Complete — 10/10 tests passing

---

## What was built

`contracts/forge_planner/` — an on-chain recipe registry and manufacturing order system for tribe-coordinated production.

### Objects

| Object | Type | Purpose |
|--------|------|---------|
| `RecipeRegistry<phantom C>` | Shared | Per-tribe recipe catalog mapping output type_id → inputs |
| `ManufacturingOrder<phantom C>` | Shared | Active production order with bounty escrow, deleted on terminal state |

### `RecipeRegistry<C>` fields

- `tribe_id: ID`
- `recipes: Table<u64, Recipe>` — output type_id → Recipe
- `recipe_count: u64`

### `Recipe` struct

- `output_type_id: u64`
- `output_quantity: u32`
- `inputs: vector<InputRequirement>` — each has `type_id: u64`, `quantity: u32`
- `run_time: u64` — abstract time units (matches EVE Frontier blueprint data)

### `ManufacturingOrder<C>` fields

- `tribe_id: ID`, `registry_id: ID`
- `creator_id: ID`, `creator_address: address`
- `description: String`
- `output_type_id: u64`, `output_quantity: u32`
- `run_count: u64`
- `required_inputs: vector<InputRequirement>` — snapshot scaled by run_count
- `bounty: Balance<C>`, `bounty_amount: u64`
- `status: OrderStatus` — Active (only on-chain state)

### Entry points

**RecipeRegistry:**
- `create_registry<C>(tribe, cap, ctx)` — creates shared registry for tribe
- `add_recipe<C>(registry, tribe, cap, output_type_id, output_quantity, inputs, run_time)` — one recipe per output type_id
- `remove_recipe<C>(registry, tribe, cap, output_type_id)` — remove to update

**ManufacturingOrder:**
- `create_order<C>(registry, tribe, cap, character, description, output_type_id, run_count, bounty_coin, ctx)` — resolves recipe, scales inputs by run_count, locks bounty
- `fulfill_order<C>(order, creator_cap, fulfiller_character, ctx)` — creator confirms, bounty → fulfiller, order deleted
- `cancel_order<C>(order, cap, ctx)` — creator cancels, bounty returned, order deleted

### Events

- `RecipeRegistryCreatedEvent` — registry_id, tribe_id
- `RecipeAddedEvent` — registry_id, tribe_id, output_type_id, output_quantity, input_count, run_time
- `RecipeRemovedEvent` — registry_id, tribe_id, output_type_id
- `OrderCreatedEvent` — order_id, tribe_id, creator_id, output_type_id, output_quantity, run_count, bounty_amount
- `OrderFulfilledEvent` — order_id, tribe_id, creator_id, fulfiller_id, output_type_id, output_quantity, bounty_amount
- `OrderCancelledEvent` — order_id, tribe_id, creator_id, output_type_id, bounty_amount

### Test coverage (10 tests)

- `create_registry_success` — registry created, shared, correct tribe_id and count
- `add_recipe_success` — recipe added, count incremented, view functions correct
- `add_duplicate_recipe_fails` — abort ERecipeAlreadyExists (1)
- `add_recipe_as_member_fails` — abort ENotAuthorized (0) when non-officer tries
- `remove_recipe_success` — recipe removed, count decremented, has_recipe returns false
- `create_order_success` — order created with scaled inputs (2 runs × recipe), bounty locked
- `create_order_missing_recipe_fails` — abort ERecipeNotFound (2)
- `fulfill_order_success` — full flow: create → fulfill, bounty transferred to fulfiller
- `cancel_order_success` — creator cancels, bounty returned
- `cancel_order_non_creator_fails` — abort ENotOrderCreator (6)

---

## Key technical decisions

### 1. `RecipeRegistry<phantom C>` as a separate shared object

**Problem**: The plan describes recipes stored as dynamic fields. However, a
separate shared object is cleaner for the registry pattern — it allows tribe
leaders to manage recipes independently of the Tribe object, avoids adding
more fields to the already-complex Tribe struct, and enables multiple registries
per tribe (e.g. guild specialization) without protocol changes.

**Decision**: `RecipeRegistry<C>` is a standalone shared object with a `tribe_id`
field linking it to its owning tribe. Auth checks verify the TribeCap's tribe_id
matches both the registry's and the Tribe object's.

**Benefit**: Clean separation of concerns. The Tribe module doesn't need to know
about recipes. Multiple registries per tribe is possible but not required.

### 2. Recipe data modelled on EVE Frontier blueprint format

**Problem**: The on-chain recipe format needs to match the off-chain data from
`industry_blueprints.json` so the optimizer can seed the registry.

**Decision**: Recipe fields (`output_type_id`, `output_quantity`, `inputs[]`,
`run_time`) map 1:1 to the blueprint JSON format (`primaryTypeID`, `outputs[].quantity`,
`inputs[]`, `runTime`). `InputRequirement` uses `type_id: u64` and `quantity: u32`
matching the JSON `typeID` and `quantity` fields.

**Benefit**: The off-chain optimizer can read `industry_blueprints.json` and
construct `add_recipe` transactions directly without any data transformation.

### 3. Input scaling at order creation time (snapshot pattern)

**Problem**: When creating an order with `run_count > 1`, should inputs be
resolved dynamically or snapshotted?

**Decision**: Snapshot the scaled inputs (`quantity × run_count`) into the
`ManufacturingOrder` at creation time. This means the required inputs are
immutable once the order is created.

**Benefit**: The order is self-contained — no need to re-read the registry
during fulfillment or cancellation. If a recipe is updated after order creation,
existing orders are unaffected. The off-chain optimizer uses the snapshotted
inputs for gap analysis.

### 4. Creator-confirmed fulfillment (same as Phase 2)

**Problem**: The plan describes resource reservation via StorageUnit extension
pattern. Like Phase 2's completion verification, this requires public getters
on world contract objects that aren't yet available.

**Decision**: Fulfillment is creator-confirmed. The creator calls `fulfill_order`
with the fulfiller's Character to release the bounty. Same pattern as
`confirm_completion` in the Contract Board.

**Benefit**: Consistent pattern across Phase 2 and 3. On-chain verification
can be plugged in later without changing the order lifecycle.

### 5. Bounty instead of resource escrow

**Problem**: The plan describes resource reservation (withdraw → hold → return).
This requires interacting with StorageUnit extensions, which have limited
public access from external packages.

**Decision**: Orders hold a token bounty (like job escrow in Phase 2) rather
than the actual resources. The bounty incentivizes fulfillment; actual resource
movement happens off-chain or through Delivery jobs on the Contract Board.

**Benefit**: Simpler object model. The bounty pattern composes with the Contract
Board: the off-chain optimizer can auto-generate `CompletionType::Delivery` jobs
for missing resources, funded from the tribe treasury or the order creator's wallet.

---

## Files created/modified

```
contracts/forge_planner/
  Move.toml                           (unchanged)
  sources/forge_planner.move          (full implementation, replaced placeholder)
  tests/forge_planner_tests.move      (10 tests)
```

---

## Phase 4 integration notes

The off-chain optimizer (Phase 4/5) will:

1. Read `industry_blueprints.json` and seed the on-chain RecipeRegistry via `add_recipe` transactions
2. Given a build goal (output type_id, quantity):
   - Query the RecipeRegistry for the recipe
   - Recursively resolve the recipe tree (if inputs are themselves craftable)
   - Read inventory from StorageUnit on-chain (items by type_id and quantity)
   - Compute: what you have → what's missing → what needs to be gathered
3. For each missing resource, auto-generate a `CompletionType::Delivery` job on the Contract Board
4. Create a `ManufacturingOrder` on-chain with the appropriate bounty

The `OrderCreatedEvent` and `OrderFulfilledEvent` feed into the Event Indexer
(Phase 4) for verifiable manufacturing history.
