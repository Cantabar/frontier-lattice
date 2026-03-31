# Contract Version Tracking & Upgrade Strategy

## Overview

All CORM Move contracts include version tracking to support safe post-publish
upgrades on SUI. This document describes the versioning scheme, the upgrade
procedure, and the constraints imposed by SUI's Move runtime.

## SUI Upgrade Constraints

SUI enforces **strict struct layout compatibility** on upgrades:

- You **cannot** add, remove, or reorder fields in existing structs.
- You **can** add new public functions to existing modules.
- You **can** add entirely new modules to a package.
- New state must be attached via **dynamic fields** on existing objects.

Each `sui move upgrade` bumps the on-chain package version automatically. Old
package versions continue to exist; shared objects created under V1 remain
accessible to V2 code.

## Versioning Scheme

### Long-lived shared objects — struct-field pattern (tribe)

`TribeRegistry` and `Tribe` are shared objects that persist for the lifetime of
the application. They carry a `version: u64` field and every **mutating** public
function asserts `version == CURRENT_VERSION` before proceeding.

When a new package version changes the expected schema:

1. Bump `CURRENT_VERSION` in the module source.
2. All existing mutating calls will abort until migration is run.
3. Call `migrate_registry` / `migrate_tribe` (admin-gated) to update the
   object's version and attach any new dynamic fields.
4. Operations resume under the new schema.

View functions are **never** version-gated — they remain readable regardless of
migration state.

### Long-lived shared objects — dynamic-field pattern (corm_auth, corm_state, corm_coin)

These packages were published without `version` struct fields. Since SUI
forbids adding fields to existing structs on compatible upgrades, version is
tracked via a `VersionKey` dynamic field on each shared object's UID.

**Pattern:**

- A `VersionKey` struct (`has copy, drop, store {}`) is the dynamic-field key.
- `CURRENT_VERSION: u64` constant per module.
- `assert_version(obj)` reads the dynamic field, defaulting to 1 if absent
  (backwards-compatible with pre-upgrade objects that don't have the field).
- `migrate_*(obj, admin_cap)` stamps the field if absent, or bumps it from
  `< CURRENT_VERSION` to `CURRENT_VERSION`. Aborts with `EAlreadyMigrated`
  if already at the current version.
- All mutating public functions call `assert_version()` first.
- View functions are ungated.
- Newly created objects stamp the dynamic field at creation time.

**Affected shared objects:**

- `corm_auth::WitnessRegistry` — `migrate_registry()`
- `corm_state::CormState` — `migrate_state()`
- `corm_state::CormConfig` — `migrate_config()`
- `corm_coin::CoinAuthority` — `migrate_authority()`

### Ephemeral contract objects (trustless_contracts)

The 6 trustless contract types (`CoinForCoin`, `CoinForItem`, `ItemForCoin`,
`ItemForItem`, `MultiInput`, `Transport`) are short-lived: created → filled →
destroyed. Version **gating** on fill/cancel/expire would lock escrowed funds
after an upgrade, so these contracts are **not** version-gated.

Instead, each contract struct carries a `version: u64` stamped at creation time.
This serves as:

- A schema tag for the indexer (which fields to expect).
- A diagnostic marker for debugging.

When deploying a breaking change to contract logic, deploy the new code and let
existing contracts finish under the old logic. New contracts will be stamped with
the updated version.

### Admin capabilities

Each package has its own admin capability for authorizing migrations:

- `corm_auth::CormAdminCap` — created on `corm_auth` package publish.
- `tribe::TribeAdminCap` — created on `tribe` package publish.

These are transferred to the publisher address at init time.

## Upgrade Procedure

### Pre-upgrade checklist

1. Verify the change does not violate SUI struct layout rules.
2. If new state is needed on existing shared objects, plan dynamic field
   additions and write the corresponding migration function.
3. Bump `CURRENT_VERSION` in the relevant module(s).
4. Write migration functions that:
   - Assert `obj.version == CURRENT_VERSION - 1` (prevents double-migrate).
   - Attach new dynamic fields.
   - Set `obj.version = CURRENT_VERSION`.

### Deployment steps

1. `sui move build` and `sui move test` locally.
2. `sui client upgrade` against testnet (or `make upgrade-contracts ENV=<env>`).
3. Call migration functions using the admin cap:
   - `tribe::migrate_registry(&mut registry, &admin_cap)`
   - `tribe::migrate_tribe(&mut tribe, &admin_cap)` (for each tribe)
   - `corm_auth::migrate_registry(&mut witness_registry, &admin_cap)`
   - `corm_state::migrate_config(&mut config, &admin_cap)`
   - `corm_state::migrate_state(&mut state, &admin_cap)` (for each CormState)
   - `corm_coin::migrate_authority(&mut authority, &admin_cap)`
4. Verify operations resume correctly.

### Rollback

SUI upgrades are **irreversible** — you cannot revert to a previous package
version. If a migration is incorrect:

- Deploy another upgrade that fixes the issue.
- The migration function can be re-written to handle the broken state.
- Ephemeral contracts are unaffected (no version gating).

## Version History

| Version | Date       | Description                          |
|---------|------------|--------------------------------------|
| 1       | 2026-03-20 | Initial version tracking (pre-publish) |
