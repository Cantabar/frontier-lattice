# Phase 5 Execution Notes — Integration Polish

**Dates**: March 11, 2026 (Days 19–20 of hackathon)
**Status**: Complete — 36 total tests passing (12 + 13 + 11), optimizer operational

---

## What was built

### On-Chain: Cross-Module Integration (3 new entry points)

| Module | New Function | Purpose |
|--------|-------------|---------|
| `tribe` | `withdraw_from_treasury<C>()` | Composable treasury withdrawal for Leader/Officer — returns `Coin<C>` |
| `contract_board` | `create_job_from_treasury<C>()` | Create jobs funded from tribe treasury (Tribe → Contract Board bridge) |
| `forge_planner` | `fulfill_order_with_rep<C>()` | Fulfill manufacturing order + award reputation (Forge → Tribe bridge) |

### On-Chain: New Event

| Event | Module | Fields |
|-------|--------|--------|
| `TreasuryWithdrawEvent` | `tribe` | tribe_id, amount, withdrawn_by |

### Off-Chain: Forge Optimizer

`app/src/optimizer/` — TypeScript CLI for recipe tree resolution, gap analysis, and delivery job generation.

| File | Purpose |
|------|---------|
| `blueprint-loader.ts` | Reads `industry_blueprints.json` + `types.json`, builds recipe graph (221 blueprints, 201 craftable outputs) |
| `recipe-resolver.ts` | Recursive dependency tree resolution with cycle detection and multi-run support |
| `gap-analyzer.ts` | Given inventory + recipe tree → shopping list of missing resources |
| `job-generator.ts` | For each missing resource → `CompletionType::Delivery` job parameters |
| `index.ts` | CLI: `npx tsx app/src/optimizer/index.ts --target 77852 --quantity 5 --inventory '{...}'` |

### Test Coverage (36 tests total)

**tribe (12 tests, +2 new):**
- Previous 10 tests unchanged
- `withdraw_from_treasury_success` — deposit 1000, withdraw 400, verify balance 600
- `withdraw_from_treasury_insufficient_fails` — abort EInsufficientFunds (4) when withdrawing more than balance

**contract_board (13 tests, +1 new):**
- Previous 12 tests unchanged
- `create_job_from_treasury_success` — deposit 2000 to treasury, create job with 1000 escrow from treasury, verify treasury reduced and job created correctly

**forge_planner (11 tests, +1 new):**
- Previous 10 tests unchanged
- `fulfill_order_with_rep_success` — full flow: create order → fulfill with rep → verify fulfiller reputation = 75 and bounty transferred

---

## Key technical decisions

### 1. `withdraw_from_treasury` as a composable primitive

**Problem**: The plan calls for treasury-funded jobs. Two approaches: (a) add `create_job_from_treasury` that internally accesses the tribe treasury, or (b) expose a general `withdraw_from_treasury` function and have the contract board call it.

**Decision**: Both. `withdraw_from_treasury` is a general-purpose composable primitive in `tribe.move` that any authorized caller (Leader/Officer) can use. `create_job_from_treasury` in `contract_board.move` is a convenience wrapper that calls it.

**Benefit**: The withdrawal function is reusable for any future treasury-funded operation (not just jobs). A PTB can also call `withdraw_from_treasury` → `create_job` directly without the convenience wrapper.

### 2. Leader/Officer direct withdrawal (no voting required)

**Problem**: The tribe module has a voting mechanism (`propose_treasury_spend` → `vote_on_proposal` → `execute_proposal`) for treasury withdrawals. Should treasury-funded jobs require voting?

**Decision**: `withdraw_from_treasury` bypasses voting for operational use. The voting mechanism remains for arbitrary spends (e.g. paying an external address). Treasury-funded jobs are an authorized operational action by tribe leadership, analogous to how a company officer can authorize purchase orders within their authority.

**Benefit**: Practical for hackathon scope. A future governance upgrade could add spending limits or require votes above a threshold amount.

### 3. Off-chain optimizer reads static data only

**Problem**: The plan describes reading inventory from on-chain StorageUnit objects. The StorageUnit contract doesn't expose public getters accessible from external packages.

**Decision**: The optimizer reads `industry_blueprints.json` for recipes and accepts inventory as CLI input (`--inventory` flag). On-chain recipe registry seeding is handled separately (the optimizer's recipe format maps 1:1 to the on-chain `add_recipe` parameters).

**Benefit**: Zero on-chain dependency for the optimization logic. The optimizer works without a running Sui node. When on-chain inventory queries become available, a thin adapter can fetch inventory and pass it to the same gap analysis engine.

### 4. Recursive resolution with cycle detection

**Problem**: Blueprint data could theoretically contain circular dependencies (item A requires item B which requires item A).

**Decision**: The resolver tracks visited nodes in a set. When a cycle is detected, the node is treated as a leaf material (cannot be crafted further). After resolving children, the node is unmarked from visited, allowing the same item to appear in different branches of the tree.

**Benefit**: Prevents infinite recursion on malformed data while allowing legitimate diamond dependencies (item X needed by both item Y and item Z).

---

## Cross-module integration map (final state)

```
Tribe ──withdraw_from_treasury──→ Contract Board (treasury-funded jobs)
Tribe ──TribeCap membership──→ Contract Board (auth gate for all job ops)
Tribe ──TribeCap membership──→ Forge Planner (auth gate for all order ops)
Tribe ──RepUpdateCap──→ Contract Board (confirm_completion_with_rep)
Tribe ──RepUpdateCap──→ Forge Planner (fulfill_order_with_rep)
Tribe ──reputation_of──→ Contract Board (min_reputation gate on accept_job)

Contract Board ←──delivery jobs──── Forge Optimizer (off-chain bridge)
Forge Planner ←──recipe data──── industry_blueprints.json (static data)

Indexer ←──events──── Tribe (8 event types + TreasuryWithdrawEvent)
Indexer ←──events──── Contract Board (5 event types)
Indexer ←──events──── Forge Planner (6 event types)
```

---

## Files created/modified

```
contracts/tribe/
  sources/tribe.move                  (+withdraw_from_treasury, +TreasuryWithdrawEvent)
  tests/tribe_tests.move              (+2 tests)

contracts/contract_board/
  sources/contract_board.move         (+create_job_from_treasury)
  tests/contract_board_tests.move     (+1 test)

contracts/forge_planner/
  sources/forge_planner.move          (+fulfill_order_with_rep, +RepUpdateCap import)
  tests/forge_planner_tests.move      (+1 test, +RepUpdateCap import)

app/
  package.json                        (new)
  tsconfig.json                       (new)
  src/optimizer/
    blueprint-loader.ts               (new)
    recipe-resolver.ts                (new)
    gap-analyzer.ts                   (new)
    job-generator.ts                  (new)
    index.ts                          (new — CLI entry point)
```
