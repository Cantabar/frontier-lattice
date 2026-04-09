# Build Plan Contract — Bucket-Based Manufacturing Orders

## Problem Statement

The existing `multi_input` contract requires exact item types and quantities. A poster picks a target item, the BOM expands to fixed slots, and fillers must deliver those exact items. This is inflexible: fillers cannot substitute equivalent materials at different manufacturing tiers, and shared raw materials that feed multiple recipe branches cannot be contributed efficiently.

## Goal

A new contract type — `build_plan` — where:

- The poster specifies a target item (e.g. MAUL) and a budget/bounty
- The contract stores **buckets** representing the leaf-level mineral demands of each recipe branch
- Fillers can deliver items at **any manufacturing tier** (raw ore, base components, batched, packaged, or finished sub-assemblies)
- Each item has a precomputed **footprint vector** that subtracts from one or more buckets
- Higher-tier items reduce multiple buckets simultaneously (because they represent completed work across sub-branches)
- Shared single-output materials (e.g. Feldspar Crystal Shards used by both RA and TC paths) require **routing** — the filler specifies which bucket to credit
- True multi-output items (raw ores that refine into two minerals) can reduce multiple buckets in one fill
- The contract completes when all buckets reach zero

## Current State

### Contracts (`trustless_contracts::multi_input`)

- `multi_input.move` — shared object with `Table<u64, SlotState>` (type_id → required/filled)
- `fill_slot` checks item type_id against slot map, rejects unknown types
- Bounty payout proportional to `fill_units / total_required`
- Lifecycle: create → fill → complete/cancel/expire/cleanup
- Reuses `contract_utils` for deadline/access/escrow helpers

### Web (`web/src/components/forge/`)

- `CreateMultiInputContractModal` — picks target item, expands BOM at chosen depth via `lib/bom.ts`, sends parallel `typeIds[]` and `quantities[]` vectors
- `MultiInputContractCard` / `MultiInputContractDetail` — display slot progress bars
- `FillSlotModal` — filler picks a slot type_id and delivers from their SSU
- `lib/sui.ts` — `buildCreateMultiInputContract`, `buildFillMultiInputSlot`, cancel/expire builders
- `hooks/useMultiInputContracts.ts` — reads contracts from creation events, live state from `getObject`, slot fills from `SlotFilledEvent` aggregation
- `lib/bom.ts` — `expandToBomDepth()` produces a flat `Map<typeId, quantity>` at a chosen depth

### Indexer (`indexer/src/`)

- Subscribes to 5 multi_input events via `checkpoint-subscriber.ts`
- Archives with denormalized fields in `event-archiver.ts`
- `types.ts` defines `MultiInputContractCreatedEvent`, `SlotFilledEvent`, etc.
- Cleanup worker handles cancel/expire for stale multi_input contracts

## Proposed Changes

### 1. Contracts — New `build_plan` module

New file: `contracts/trustless_contracts/sources/build_plan.move`

This is a **new module** alongside `multi_input`, not a replacement. The existing `multi_input` contract remains for "I need exactly these items" use cases.

#### On-chain data model

```
BucketState { remaining: u64 }

ItemBucketKey { type_id: u64, bucket_id: u64 }  // composite Table key

BuildPlanContract<C> {
    id: UID,
    version: u64,
    poster_id: ID,
    poster_address: address,
    description: String,
    destination_ssu_id: ID,
    target_type_id: u64,          // what's being built (e.g. MAUL 82430)
    target_quantity: u64,

    // Buckets — leaf-level mineral demand pools
    bucket_ids: vector<u64>,                    // enumeration (e.g. 0..5)
    bucket_labels: vector<u64>,                 // human-readable: type_id of the canonical mineral
    buckets: Table<u64, BucketState>,           // bucket_id → remaining demand

    // Item acceptance — which items can fill which buckets and at what weight
    accepted_type_ids: vector<u64>,             // all accepted item type_ids
    item_bucket_weights: Table<ItemBucketKey, u64>,  // (type_id, bucket_id) → weight per unit
    // For each item, which buckets it can contribute to
    item_bucket_list: Table<u64, vector<u64>>,  // type_id → [bucket_ids]
    // Whether an item requires explicit routing (single-output shared item)
    item_requires_routing: Table<u64, bool>,    // type_id → needs filler to choose bucket

    total_value_required: u64,    // sum of all bucket caps (for bounty math)
    total_value_filled: u64,
    bounty: Balance<C>,
    bounty_amount: u64,
    fills: Table<ID, u64>,        // contributor Character ID → total value contributed
    deadline_ms: u64,
    allowed_characters: vector<ID>,
    allowed_tribes: vector<u32>,
}
```

#### Fill function

Two entry points:

- `fill(contract, ssu, poster, filler, item, clock, ctx)` — for items that either (a) only hit one bucket, or (b) are multi-output and hit all their buckets automatically
- `fill_routed(contract, ssu, poster, filler, item, target_bucket_id, clock, ctx)` — for shared single-output items where the filler must choose which bucket to credit

Fill logic:

1. Look up item's bucket list from `item_bucket_list`
2. If `item_requires_routing[type_id]` is true, assert `target_bucket_id` is in the list and only credit that one bucket
3. Otherwise, iterate all buckets in the list and credit each: `min(qty * weight, bucket.remaining)`
4. Sum total value credited across all buckets
5. Payout: `total_value_credited * bounty_amount / total_value_required`
6. Deposit item to poster's SSU via CormAuth (same as multi_input)
7. Check completion: all buckets at 0 remaining

#### Events

```
BuildPlanCreatedEvent {
    contract_id, poster_id, description, destination_ssu_id,
    target_type_id, target_quantity,
    bucket_ids, bucket_labels, bucket_caps,    // parallel vectors
    accepted_type_ids,                         // all accepted items
    total_value_required, bounty_amount, deadline_ms,
    allowed_characters, allowed_tribes,
}

BucketFilledEvent {
    contract_id, filler_id,
    type_id,                    // item delivered
    bucket_credits: vector<u64>,  // parallel to bucket_ids: value credited per bucket
    total_value_credited: u64,
    payout_amount: u64,
    total_remaining: u64,       // sum of all bucket remainders
}

BuildPlanCompletedEvent { contract_id, poster_id, total_filled, total_bounty_paid }
BuildPlanCancelledEvent { contract_id, poster_id, bounty_returned }
BuildPlanExpiredEvent   { contract_id, poster_id, bounty_returned }
```

#### Cancel / Expire / Cleanup

Same pattern as `multi_input`: poster cancel, anyone expire after deadline, anyone cleanup after completion. Destructures the shared object, returns remaining bounty, drops all Tables.

#### Test file

New file: `contracts/trustless_contracts/tests/build_plan_tests.move`

Test cases:

- Create with multiple buckets, verify caps
- Fill with a single-bucket item (e.g. Nickel-Iron Veins → RA.NickelIron only)
- Fill with a multi-bucket finished item (e.g. Reinforced Alloys reduces RA.NickelIron + RA.FeldsparShards)
- Fill with a routed shared item (e.g. Feldspar Crystal Shards → choose RA vs TC bucket)
- Reject `fill()` (non-routed) for an item that requires routing
- Reject `fill_routed()` with an invalid bucket_id for the item
- Overfill capped to bucket remaining
- Completion triggers dust sweep + completion event
- Bounty math: proportional payout across mixed fills
- Cancel returns remaining bounty
- Expire after deadline
- Access control (character/tribe allowlists)

#### Upgrade considerations

This is a new module added to the existing `trustless_contracts` package. Requires a **package upgrade** (not a publish). The `UpgradeCap` from the original publish is needed. No existing struct layouts change. `contract_utils` helpers are reused as-is.

### 2. Web — BOM Expansion + UI

#### `lib/bom.ts` — New `expandToBuckets()` function

New export alongside existing `expandToBomDepth()`. Given a target item, quantity, and recipe map:

1. Walk the full recipe tree to leaf minerals
2. Group leaves by their recipe-branch ancestry (the path from root to leaf)
3. For each leaf grouping, create a **bucket** with the total required quantity as the cap
4. For every intermediate and finished item in the tree, compute its **footprint vector**: which buckets it reduces and by how much per unit
5. Flag items that appear in multiple buckets via different single-output paths as `requiresRouting = true`
6. Flag items that naturally split across buckets via multi-output recipes as `requiresRouting = false`

Return shape:

```ts
interface BucketDef {
  bucketId: number;
  label: string;          // e.g. "RA → Nickel-Iron Veins"
  labelTypeId: number;    // canonical mineral type_id
  cap: number;
}

interface ItemFootprint {
  typeId: number;
  weights: Map<number, number>;  // bucket_id → weight per unit
  requiresRouting: boolean;
}

interface BucketExpansion {
  buckets: BucketDef[];
  items: ItemFootprint[];
  totalValueRequired: number;
}
```

The BOM expansion uses only the **Mini Printer** recipes (not Field Printer) per the design decision to exclude the Field Printer path. The existing `buildRecipeMap()` will need a variant or filter parameter to select the preferred facility recipes.

#### `lib/sui.ts` — New transaction builders

- `buildCreateBuildPlanContract(params)` — encodes bucket definitions and item footprints as parallel vectors for the `build_plan::create` entry function
- `buildFillBuildPlan(params)` — calls `build_plan::fill` for auto-routed items
- `buildFillBuildPlanRouted(params)` — calls `build_plan::fill_routed` with a `target_bucket_id`
- `buildCancelBuildPlan(params)` / `buildExpireBuildPlan(params)` — standard lifecycle

#### New components

- `CreateBuildPlanModal` — replaces `CreateMultiInputContractModal` for the build-plan flow. Picker for target item + quantity. Calls `expandToBuckets()` to preview the generated buckets. Shows bucket list with caps and accepted item count per bucket. Bounty / deadline / SSU / access control fields same as multi_input.
- `BuildPlanCard` — order card showing target item, overall progress (sum of bucket fills / total value), bucket count, bounty, deadline.
- `BuildPlanDetail` — detail modal showing per-bucket progress bars with remaining demand in both value-units and human-readable equivalent quantities. Fill button opens fill modal.
- `FillBuildPlanModal` — filler picks an item from their SSU inventory. The modal checks whether the item requires routing. If not routed, submits `fill`. If routed, shows a bucket picker (only buckets that accept this item and have remaining capacity) and submits `fill_routed`.

#### New hook: `useBuildPlanContracts.ts`

- `useActiveBuildPlanContracts()` — queries `BuildPlanCreatedEvent`
- `useBuildPlanContractObject(id)` — live state from `getObject`
- `useBuildPlanBucketFills(id)` — aggregates `BucketFilledEvent` per bucket

#### Forge Planner page integration

`pages/ForgePlanner.tsx` Orders tab currently shows multi-input contracts. Add a toggle or second section for Build Plan orders. The "New Order" button should offer a choice: "Fixed Slots (Multi-Input)" or "Flexible Build Plan".

### 3. Indexer — Event Subscription + Archival

#### `types.ts` — New event interfaces

```ts
interface BuildPlanCreatedEvent {
  contract_id: string;
  poster_id: string;
  description: string;
  destination_ssu_id: string;
  target_type_id: string;
  target_quantity: string;
  bucket_ids: string[];
  bucket_labels: string[];
  bucket_caps: string[];
  accepted_type_ids: string[];
  total_value_required: string;
  bounty_amount: string;
  deadline_ms: string;
  allowed_characters: string[];
  allowed_tribes: number[];
}

interface BucketFilledEvent {
  contract_id: string;
  filler_id: string;
  type_id: string;
  bucket_credits: string[];
  total_value_credited: string;
  payout_amount: string;
  total_remaining: string;
}

interface BuildPlanCompletedEvent {
  contract_id: string;
  poster_id: string;
  total_filled: string;
  total_bounty_paid: string;
}

interface BuildPlanCancelledEvent {
  contract_id: string;
  poster_id: string;
  bounty_returned: string;
}

interface BuildPlanExpiredEvent {
  contract_id: string;
  poster_id: string;
  bounty_returned: string;
}
```

Add these 5 names to `EVENT_TYPES` array.

#### `checkpoint-subscriber.ts`

Add `build_plan` module event mappings in `buildEventTypeFilters()`, same pattern as the existing `multi_input` block.

#### `event-archiver.ts`

Add cases in `extractDenormalizedFields()` for each new event type. Same `primaryId = contract_id` / `characterId = poster_id|filler_id` pattern.

#### `cleanup-worker.ts`

Add `BuildPlanContract` to the cleanup worker's stale-contract scan. Query for `BuildPlanContract<C>` objects past deadline, submit `build_plan::expire` transactions. Same pattern as multi_input cleanup.

### 4. Data Flow Summary

**Creation:**

1. Web: user picks target item → `expandToBuckets()` computes buckets + footprints
2. Web: `buildCreateBuildPlanContract()` encodes as parallel vectors in a PTB
3. Chain: `build_plan::create()` builds Tables, escrows bounty, emits `BuildPlanCreatedEvent`
4. Indexer: archives event

**Filling:**

1. Web: filler selects an item from SSU inventory
2. Web: checks `item.requiresRouting` — if true, shows bucket picker; if false, auto-routes
3. Web: builds `fill` or `fill_routed` PTB
4. Chain: subtracts footprint from buckets, pays proportional bounty, emits `BucketFilledEvent`
5. Indexer: archives event
6. Web: `useBuildPlanBucketFills` updates bucket progress display

**Completion:**

1. Chain: last fill that zeroes all buckets triggers dust sweep + `BuildPlanCompletedEvent`
2. Indexer: archives completion event

## Open Questions

1. **Recipe filtering:** The BOM expansion needs to select Mini Printer recipes over Field Printer recipes for the same output. `blueprints.json` includes facility data — filter by `facilityFamily` or `facilityTypeId`.
2. **Multi-output ore routing:** Raw ores (Feldspar Crystals → Hydrocarbon Residue + Silica Grains) produce two outputs that feed different branches. The footprint should reduce two buckets simultaneously. The BOM optimizer needs to trace multi-output recipe yields to compute the correct split weights. This is more complex than single-output expansion and may be deferred to a v2.
3. **Scale factor:** All weights are u64 on-chain. Need a consistent scale factor (e.g. 1000) to avoid precision loss from integer division in intermediate recipe ratios. The BOM optimizer should apply this uniformly.
4. **On-chain storage cost:** Each accepted item type adds entries to `item_bucket_weights` and `item_bucket_list` Tables. A full MAUL expansion might have 20-30 accepted item types × 6 buckets = ~100-180 Table entries. This is within Sui's practical limits but worth monitoring gas costs.
5. **Existing multi_input coexistence:** Both contract types live in the same package. The Forge Planner UI offers both options. No migration needed.
6. **Frame / Echo Chamber / Still Knot buckets:** These are separate recipe branches with their own mineral demands. The BOM expansion should produce buckets for these paths too. The total bucket count for a MAUL is likely 8-12 (3 material paths × 2-3 minerals each + frame sub-components).
