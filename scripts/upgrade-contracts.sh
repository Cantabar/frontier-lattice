#!/usr/bin/env bash
set -euo pipefail

# Upgrade already-published Move packages on SUI testnet.
#
# Uses the UpgradeCap stored in each package's Published.toml to authorize
# the upgrade. The SUI CLI auto-updates Published.toml on success (bumps
# version, updates published-at). Env vars are updated with the new
# package IDs.
#
# Prerequisites:
#   - SUI CLI installed with a 'testnet' env configured
#   - Active wallet is the SAME wallet that originally published (owns the UpgradeCaps)
#   - Packages already published (Published.toml exists with upgrade-capability)
#
# Usage:
#   ./scripts/upgrade-contracts.sh stillness                    # upgrade all packages
#   ./scripts/upgrade-contracts.sh utopia corm_state            # upgrade one package
#   ./scripts/upgrade-contracts.sh stillness corm_auth corm_state  # upgrade specific packages

VALID_ENVS=("utopia" "stillness")

if [ $# -lt 1 ]; then
  echo "Usage: $0 <environment> [package ...]"
  echo "  Environments: ${VALID_ENVS[*]}"
  echo "  Packages (optional, default=all): tribe corm_auth trustless_contracts witnessed_contracts corm_state assembly_metadata"
  exit 1
fi

ENV="$1"
shift

# Validate environment name
VALID=false
for e in "${VALID_ENVS[@]}"; do
  if [ "$e" = "$ENV" ]; then VALID=true; break; fi
done
if [ "$VALID" = false ]; then
  echo "ERROR: Invalid environment '$ENV'. Must be one of: ${VALID_ENVS[*]}" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env.${ENV}"
WEB_ENV_FILE="$PROJECT_ROOT/web/.env.${ENV}"
GAS_BUDGET=1000000000  # 1 SUI
SUI_RPC="https://fullnode.testnet.sui.io:443"

# All packages in dependency order (leaf dependencies first).
# corm_auth has no internal deps; tribe depends only on world.
# corm_state depends on corm_auth. trustless_contracts and witnessed_contracts
# depend on corm_auth + world. assembly_metadata depends on corm_auth + world.
ALL_PACKAGES=("tribe" "corm_auth" "trustless_contracts" "witnessed_contracts" "corm_state" "assembly_metadata")
declare -A ENV_VAR_MAP=(
  [tribe]="PACKAGE_TRIBE"
  [corm_auth]="PACKAGE_CORM_AUTH"
  [trustless_contracts]="PACKAGE_TRUSTLESS_CONTRACTS"
  [witnessed_contracts]="PACKAGE_WITNESSED_CONTRACTS"
  [corm_state]="PACKAGE_CORM_STATE"
  [assembly_metadata]="PACKAGE_ASSEMBLY_METADATA"
)
declare -A VITE_VAR_MAP=(
  [tribe]="VITE_TRIBE_PACKAGE_ID"
  [corm_auth]="VITE_CORM_AUTH_PACKAGE_ID"
  [trustless_contracts]="VITE_TRUSTLESS_CONTRACTS_PACKAGE_ID"
  [witnessed_contracts]="VITE_WITNESSED_CONTRACTS_PACKAGE_ID"
  [corm_state]="VITE_CORM_STATE_PACKAGE_ID"
  [assembly_metadata]="VITE_ASSEMBLY_METADATA_PACKAGE_ID"
)

# Determine which packages to upgrade
if [ $# -gt 0 ]; then
  PACKAGES=("$@")
  # Validate provided package names
  for pkg in "${PACKAGES[@]}"; do
    FOUND=false
    for valid_pkg in "${ALL_PACKAGES[@]}"; do
      if [ "$pkg" = "$valid_pkg" ]; then FOUND=true; break; fi
    done
    if [ "$FOUND" = false ]; then
      echo "ERROR: Unknown package '$pkg'. Valid packages: ${ALL_PACKAGES[*]}" >&2
      exit 1
    fi
  done
else
  PACKAGES=("${ALL_PACKAGES[@]}")
fi

write_env_var() {
  local var="$1" val="$2" file="$3"
  if grep -q "^${var}=" "$file" 2>/dev/null; then
    sed -i "s|^${var}=.*|${var}=${val}|" "$file"
  else
    [ -s "$file" ] && [ -n "$(tail -c1 "$file")" ] && echo >> "$file"
    echo "${var}=${val}" >> "$file"
  fi
}

# Map environment names to the build-env used in Published.toml
case "$ENV" in
  stillness) BUILD_ENV="testnet_stillness" ;;
  utopia)    BUILD_ENV="testnet_utopia" ;;
  *)         BUILD_ENV="$ENV" ;;
esac

echo "=== Upgrading contracts for environment: $ENV ==="
echo "Build environment: $BUILD_ENV"
echo "Packages to upgrade: ${PACKAGES[*]}"
echo ""

# ── Ensure SUI client is pointing at testnet ───────────────────────
if ! sui client envs 2>/dev/null | grep -q 'testnet'; then
  echo "Adding testnet env to SUI client..."
  sui client new-env --alias testnet --rpc "$SUI_RPC" 2>/dev/null
fi
sui client switch --env testnet 2>/dev/null
echo "Switched to testnet env"

# ── Verify gas is available ────────────────────────────────────────
echo "Checking gas balance..."
GAS_COUNT=$(sui client gas --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
if [ "$GAS_COUNT" = "0" ]; then
  echo "ERROR: No gas coins found. Fund your active wallet on testnet first." >&2
  echo "  Active address: $(sui client active-address)" >&2
  exit 1
fi
echo "Gas available ($GAS_COUNT coin objects)"
echo ""

# ── Track results for summary ─────────────────────────────────────
declare -A OLD_IDS
declare -A NEW_IDS

# ── Upgrade each package ──────────────────────────────────────────
for pkg in "${PACKAGES[@]}"; do
  pkg_path="$PROJECT_ROOT/contracts/$pkg"
  var="${ENV_VAR_MAP[$pkg]}"
  vite_var="${VITE_VAR_MAP[$pkg]}"
  published_toml="$pkg_path/Published.toml"

  echo "Upgrading $pkg..."

  # ── Read UpgradeCap from Published.toml ──────────────────────────
  if [ ! -f "$published_toml" ]; then
    echo "  ERROR: No Published.toml found for $pkg. Has it been published?" >&2
    exit 1
  fi

  UPGRADE_CAP=$(sed -n '/^\[published\.'"$BUILD_ENV"'\]/,/^\[/{/upgrade-capability/s/.*"\(0x[^"]*\)".*/\1/p;}' "$published_toml")
  OLD_PUBLISHED_AT=$(sed -n '/^\[published\.'"$BUILD_ENV"'\]/,/^\[/{/published-at/s/.*"\(0x[^"]*\)".*/\1/p;}' "$published_toml")

  if [ -z "$UPGRADE_CAP" ]; then
    echo "  ERROR: No upgrade-capability found in Published.toml for env '$BUILD_ENV'." >&2
    echo "  Available entries:" >&2
    grep '^\[published\.' "$published_toml" >&2 || true
    exit 1
  fi

  OLD_IDS[$pkg]="${OLD_PUBLISHED_AT:-unknown}"
  echo "  UpgradeCap: $UPGRADE_CAP"
  echo "  Old package: ${OLD_PUBLISHED_AT:-unknown}"

  # ── Verify UpgradeCap exists on chain and is owned by active wallet ─
  ACTIVE_ADDR=$(sui client active-address)
  CAP_OWNER=$(curl -s "$SUI_RPC" -X POST \
    -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"sui_getObject\",\"params\":[\"$UPGRADE_CAP\",{\"showOwner\":true}]}" \
    | jq -r '.result.data.owner.AddressOwner // empty')
  if [ -z "$CAP_OWNER" ]; then
    echo "  ERROR: UpgradeCap $UPGRADE_CAP not found on chain or not an owned object." >&2
    exit 1
  fi
  if [ "$CAP_OWNER" != "$ACTIVE_ADDR" ]; then
    echo "  ERROR: UpgradeCap is owned by $CAP_OWNER but active address is $ACTIVE_ADDR." >&2
    echo "  You must use the same wallet that originally published this package." >&2
    exit 1
  fi

  # ── Run the upgrade ──────────────────────────────────────────────
  sui client upgrade "$pkg_path" \
    --upgrade-capability "$UPGRADE_CAP" \
    --gas-budget "$GAS_BUDGET" \
    --build-env "$BUILD_ENV" \
    --json > /tmp/upgrade-result.json 2>&1 || true

  # Strip non-JSON lines (e.g. [warning] messages)
  sed -n '/^{/,$p' /tmp/upgrade-result.json > /tmp/upgrade-result-clean.json

  # Extract new package ID from upgrade transaction result
  NEW_PACKAGE_ID=$(jq -r '(.objectChanges // [])[] | select(.type == "published") | .packageId // empty' /tmp/upgrade-result-clean.json 2>/dev/null)

  if [ -z "$NEW_PACKAGE_ID" ] || [ "$NEW_PACKAGE_ID" = "null" ]; then
    # Fallback: read the updated Published.toml (SUI CLI updates it on success)
    if [ -f "$published_toml" ]; then
      NEW_PACKAGE_ID=$(sed -n '/^\[published\.'"$BUILD_ENV"'\]/,/^\[/{/published-at/s/.*"\(0x[^"]*\)".*/\1/p;}' "$published_toml")
    fi
  fi

  if [ -z "$NEW_PACKAGE_ID" ] || [ "$NEW_PACKAGE_ID" = "null" ] || [ "$NEW_PACKAGE_ID" = "${OLD_PUBLISHED_AT:-}" ]; then
    echo "  ERROR: Upgrade failed for $pkg." >&2
    echo "  Output:" >&2
    cat /tmp/upgrade-result.json >&2 2>/dev/null || true
    exit 1
  fi

  NEW_IDS[$pkg]="$NEW_PACKAGE_ID"
  echo "  New package: $NEW_PACKAGE_ID"

  # ── Update env vars ──────────────────────────────────────────────
  write_env_var "$var" "$NEW_PACKAGE_ID" "$ENV_FILE"
  write_env_var "$vite_var" "$NEW_PACKAGE_ID" "$ENV_FILE"
  if [ -f "$WEB_ENV_FILE" ]; then
    write_env_var "$vite_var" "$NEW_PACKAGE_ID" "$WEB_ENV_FILE"
  fi

  # corm_state aliases
  if [ "$pkg" = "corm_state" ]; then
    write_env_var "CORM_STATE_PACKAGE_ID" "$NEW_PACKAGE_ID" "$ENV_FILE"
    write_env_var "VITE_CORM_COIN_TYPE" "${NEW_PACKAGE_ID}::corm_coin::CORM_COIN" "$ENV_FILE"
    if [ -f "$WEB_ENV_FILE" ]; then
      write_env_var "VITE_CORM_COIN_TYPE" "${NEW_PACKAGE_ID}::corm_coin::CORM_COIN" "$WEB_ENV_FILE"
    fi
  fi
  if [ "$pkg" = "witnessed_contracts" ]; then
    write_env_var "WITNESSED_CONTRACTS_PACKAGE_ID" "$NEW_PACKAGE_ID" "$ENV_FILE"
  fi

  echo ""
done

rm -f /tmp/upgrade-result.json /tmp/upgrade-result-clean.json

# ── Summary ────────────────────────────────────────────────────────
echo "=== Upgrade Summary ($ENV) ==="
for pkg in "${PACKAGES[@]}"; do
  echo "  $pkg: ${OLD_IDS[$pkg]:-?} → ${NEW_IDS[$pkg]:-?}"
done
echo ""
echo "Package IDs written to:"
echo "  $ENV_FILE"
[ -f "$WEB_ENV_FILE" ] && echo "  $WEB_ENV_FILE"
echo ""
echo "Post-upgrade steps:"
echo "  1. If this is the first upgrade after adding version tracking,"
echo "     call the migration functions for each shared object:"
echo "       sui client call --package <NEW_CORM_AUTH_PKG> --module corm_auth --function migrate_registry --args <WITNESS_REGISTRY_ID> <ADMIN_CAP_ID>"
echo "       sui client call --package <NEW_CORM_STATE_PKG> --module corm_state --function migrate_config --args <CORM_CONFIG_ID> <ADMIN_CAP_ID>"
echo "       sui client call --package <NEW_CORM_STATE_PKG> --module corm_state --function migrate_state --args <CORM_STATE_ID> <ADMIN_CAP_ID>"
echo "       sui client call --package <NEW_CORM_STATE_PKG> --module corm_coin --function migrate_authority --args <COIN_AUTHORITY_ID> <ADMIN_CAP_ID>"
echo "  2. Redeploy services: make deploy-env ENV=$ENV"
