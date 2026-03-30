#!/usr/bin/env bash
set -euo pipefail

# Publish all Move packages to SUI testnet for a specific game-world environment.
#
# Each environment (utopia, stillness) has its own world-contracts deployment,
# so corm contracts must be published separately per environment.
#
# Prerequisites:
#   - SUI CLI installed with a 'testnet' env configured:
#       sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
#   - Active wallet funded with SUI on testnet
#   - World package already deployed on testnet (auto-read from web/.env.{ENV})
#
# Usage:
#   ./scripts/publish-contracts.sh utopia
#   ./scripts/publish-contracts.sh stillness
#   WORLD_PACKAGE_ID=0x... ./scripts/publish-contracts.sh utopia

VALID_ENVS=("utopia" "stillness")

if [ $# -lt 1 ]; then
  echo "Usage: $0 <environment> [--force-republish]"
  echo "  Environments: ${VALID_ENVS[*]}"
  echo "  --force-republish  Ignore existing Published.toml entries and re-publish all packages"
  exit 1
fi

ENV="$1"
FORCE_REPUBLISH=0
if [ "${2:-}" = "--force-republish" ]; then
  FORCE_REPUBLISH=1
  echo "Force-republish mode: will ignore existing Published.toml entries"
fi

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
PUB_FILE="$PROJECT_ROOT/Pub.${ENV}.toml"
GAS_BUDGET=1000000000  # 1 SUI (actual publish cost is ~0.5 SUI)
SUI_RPC="https://fullnode.testnet.sui.io:443"

PACKAGES=("tribe" "corm_auth" "trustless_contracts" "witnessed_contracts" "corm_state" "assembly_metadata")
ENV_VARS=("PACKAGE_TRIBE" "PACKAGE_CORM_AUTH" "PACKAGE_TRUSTLESS_CONTRACTS" "PACKAGE_WITNESSED_CONTRACTS" "PACKAGE_CORM_STATE" "PACKAGE_ASSEMBLY_METADATA")
VITE_VARS=("VITE_TRIBE_PACKAGE_ID" "VITE_CORM_AUTH_PACKAGE_ID" "VITE_TRUSTLESS_CONTRACTS_PACKAGE_ID" "VITE_WITNESSED_CONTRACTS_PACKAGE_ID" "VITE_CORM_STATE_PACKAGE_ID" "VITE_ASSEMBLY_METADATA_PACKAGE_ID")

write_env_var() {
  local var="$1" val="$2" file="$3"
  if grep -q "^${var}=" "$file" 2>/dev/null; then
    sed -i "s|^${var}=.*|${var}=${val}|" "$file"
  else
    # Ensure file ends with a newline before appending
    [ -s "$file" ] && [ -n "$(tail -c1 "$file")" ] && echo >> "$file"
    echo "${var}=${val}" >> "$file"
  fi
}

echo "=== Publishing contracts for environment: $ENV ==="

# ── Create .env.{ENV} from template if missing ─────────────────────
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$PROJECT_ROOT/.env.${ENV}.example" ]; then
    cp "$PROJECT_ROOT/.env.${ENV}.example" "$ENV_FILE"
    echo "Created $ENV_FILE from .env.${ENV}.example"
  else
    touch "$ENV_FILE"
    echo "Created empty $ENV_FILE"
  fi
fi

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

# ── Resolve world package ID ──────────────────────────────────────
WORLD_PKG_ID="${WORLD_PACKAGE_ID:-}"
if [ -z "$WORLD_PKG_ID" ] && [ -f "$WEB_ENV_FILE" ]; then
  WORLD_PKG_ID=$(grep '^VITE_WORLD_PACKAGE_ID=' "$WEB_ENV_FILE" 2>/dev/null | cut -d= -f2 || true)
  if [ -n "$WORLD_PKG_ID" ]; then
    echo "Read world package ID from $WEB_ENV_FILE"
  fi
fi
if [ -z "$WORLD_PKG_ID" ] && [ -f "$ENV_FILE" ]; then
  WORLD_PKG_ID=$(grep '^VITE_WORLD_PACKAGE_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)
fi
if [ -z "$WORLD_PKG_ID" ] || [ "$WORLD_PKG_ID" = "0x0" ]; then
  echo ""
  echo "World package ID is required. The world-contracts must be deployed to"
  echo "testnet before publishing frontier-corm contracts."
  read -rp "Enter the world package ID (0x...): " WORLD_PKG_ID
fi
if [ -z "$WORLD_PKG_ID" ]; then
  echo "ERROR: World package ID is required." >&2
  exit 1
fi
echo "Using world package: $WORLD_PKG_ID"
write_env_var "VITE_WORLD_PACKAGE_ID" "$WORLD_PKG_ID" "$ENV_FILE"

# ── Verify world package exists on testnet ─────────────────────────
echo "Verifying world package on testnet..."
WORLD_CHECK=$(curl -s "$SUI_RPC" -X POST \
  -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"sui_getObject\",\"params\":[\"$WORLD_PKG_ID\"]}" \
  | jq -r '.result.data.objectId // empty')
if [ -z "$WORLD_CHECK" ]; then
  echo "ERROR: World package $WORLD_PKG_ID not found on testnet." >&2
  exit 1
fi
echo "World package verified on testnet"

# ── Get chain ID and SUI version ──────────────────────────────────
CHAIN_ID=$(curl -s "$SUI_RPC" -X POST \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getChainIdentifier","params":[]}' \
  | jq -r '.result')
SUI_VERSION=$(sui --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo "1.65.2")
WORLD_GIT_URL="https://github.com/evefrontier/world-contracts.git"
WORLD_GIT_SUBDIR="contracts/world"
WORLD_GIT_REV="main"

echo "Chain ID: $CHAIN_ID"

# ── Map environment names to world-contracts convention ────────────
# The world-contracts repo (github.com/evefrontier/world-contracts) uses
# "testnet_stillness" / "testnet_utopia" as environment names in its
# Published.toml. Our corm packages must use matching names so that
# `sui client publish --environment` can resolve the world dependency
# as already-published rather than bundling it inline.
case "$ENV" in
  stillness) BUILD_ENV="testnet_stillness" ;;
  utopia)    BUILD_ENV="testnet_utopia" ;;
  *)         BUILD_ENV="$ENV" ;;
esac
echo "Build environment: $BUILD_ENV (maps to world-contracts Published.toml entry)"

# ── Generate Pub.{ENV}.toml with world dependency pinned ───────────
rm -f "$PUB_FILE"
cat > "$PUB_FILE" <<EOF
# generated by publish-contracts.sh for $ENV
build-env = "$ENV"
chain-id = "$CHAIN_ID"

[[published]]
source = { git = "$WORLD_GIT_URL", subdir = "$WORLD_GIT_SUBDIR", rev = "$WORLD_GIT_REV" }
published-at = "$WORLD_PKG_ID"
original-id = "$WORLD_PKG_ID"
version = 1
toolchain-version = "$SUI_VERSION"
build-config = { flavor = "sui", edition = "2024" }
EOF
echo "Generated $PUB_FILE"

# ── Clear stale package IDs ────────────────────────────────────────
# Clear from both the root env file and the web env file. Without the
# web env file cleanup, a stale VITE_CORM_CONFIG_ID (created under a
# previous package deployment) survives a republish and causes
# TypeMismatch errors at runtime.
STALE_VARS=("${ENV_VARS[@]}" "${VITE_VARS[@]}" VITE_TRIBE_REGISTRY_ID VITE_CORM_CONFIG_ID VITE_METADATA_REGISTRY_ID)
echo "Clearing stale contract IDs from $ENV_FILE..."
for var in "${STALE_VARS[@]}"; do
  if grep -q "^${var}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${var}=.*|${var}=|" "$ENV_FILE"
  fi
done
if [ -f "$WEB_ENV_FILE" ]; then
  echo "Clearing stale contract IDs from $WEB_ENV_FILE..."
  for var in "${STALE_VARS[@]}"; do
    if grep -q "^${var}=" "$WEB_ENV_FILE" 2>/dev/null; then
      sed -i "s|^${var}=.*|${var}=|" "$WEB_ENV_FILE"
    fi
  done
fi

# ── Publish each package ──────────────────────────────────────────
for i in "${!PACKAGES[@]}"; do
  pkg="${PACKAGES[$i]}"
  var="${ENV_VARS[$i]}"
  pkg_path="$PROJECT_ROOT/contracts/$pkg"

  echo ""
  echo "Publishing $pkg..."

  # Check if already published for this environment.
  # Pass --force-republish to override stale Published.toml entries from
  # broken prior deploys (e.g. packages that bundled world inline).
  PUBLISHED_TOML="$pkg_path/Published.toml"
  ALREADY_PUBLISHED_ID=""
  if [ "$FORCE_REPUBLISH" != "1" ] && [ -f "$PUBLISHED_TOML" ]; then
    ALREADY_PUBLISHED_ID=$(sed -n '/^\[published\.'"$BUILD_ENV"'\]/,/^\[/{ /published-at/s/.*"\(0x[^"]*\)".*/\1/p; }' "$PUBLISHED_TOML")
  fi

  if [ -n "$ALREADY_PUBLISHED_ID" ]; then
    echo "  Already published for $BUILD_ENV: $ALREADY_PUBLISHED_ID (from Published.toml)"
    PACKAGE_ID="$ALREADY_PUBLISHED_ID"
  else
    # Clear stale Published.toml entry for this env so the CLI doesn't
    # refuse to publish ("already published" error).
    if [ -f "$PUBLISHED_TOML" ]; then
      sed -i '/^\[published\.'"$BUILD_ENV"'\]/,/^\[/{/^\[published\.'"$BUILD_ENV"'\]/d;/^\[/!d}' "$PUBLISHED_TOML"
      # Remove the file if it's now empty (only comments/whitespace)
      if ! grep -q '^\[' "$PUBLISHED_TOML" 2>/dev/null; then
        rm -f "$PUBLISHED_TOML"
      fi
    fi

    sui client publish "$pkg_path" \
      --gas-budget "$GAS_BUDGET" \
      --environment "$BUILD_ENV" \
      --with-unpublished-dependencies \
      --json > /tmp/publish-result.json 2>&1 || true
    # Note: CLI may return non-zero even on success (e.g. version mismatch warnings).
    # We check the JSON output for the actual result instead of the exit code.

    # Extract package ID from publish transaction result
    # Strip non-JSON lines (e.g. [warning] messages, build output) before parsing
    sed -n '/^{/,$p' /tmp/publish-result.json > /tmp/publish-result-clean.json
    PACKAGE_ID=$(jq -r '(.objectChanges // [])[] | select(.type == "published") | .packageId // empty' /tmp/publish-result-clean.json 2>/dev/null)
    if [ -z "$PACKAGE_ID" ] || [ "$PACKAGE_ID" = "null" ]; then
      # Fallback: try reading from Published.toml (created by successful publish)
      if [ -f "$pkg_path/Published.toml" ]; then
        PACKAGE_ID=$(sed -n '/^\[published\.'"$BUILD_ENV"'\]/,/^\[/{ /published-at/s/.*"\(0x[^"]*\)".*/\1/p; }' "$pkg_path/Published.toml")
      fi
    fi
  fi

  if [ -z "$PACKAGE_ID" ] || [ "$PACKAGE_ID" = "null" ]; then
    echo "ERROR: Could not extract package ID for $pkg" >&2
    echo "  Publish output:" >&2
    cat /tmp/publish-result.json >&2 2>/dev/null || true
    exit 1
  fi

  # ── Verify the published package doesn't bundle world modules ────
  # If the world dependency wasn't resolved correctly, the package will
  # contain character/access/etc. modules that produce TypeMismatch
  # errors at runtime. Catch this immediately.
  PUBLISHED_MODULES=$(
    curl -s "$SUI_RPC" -X POST \
      -H 'Content-Type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"sui_getObject\",\"params\":[\"$PACKAGE_ID\",{\"showContent\":true}]}" \
    | jq -r '.result.data.content.disassembled | keys[]' 2>/dev/null
  )
  if echo "$PUBLISHED_MODULES" | grep -qw 'character'; then
    echo "ERROR: Package $pkg ($PACKAGE_ID) contains bundled world modules!" >&2
    echo "  This means the world dependency was not resolved as published." >&2
    echo "  Published modules: $PUBLISHED_MODULES" >&2
    echo "  Expected world package: $WORLD_PKG_ID" >&2
    exit 1
  fi

  vite_var="${VITE_VARS[$i]}"
  echo "  $var=$PACKAGE_ID"
  write_env_var "$var" "$PACKAGE_ID" "$ENV_FILE"
  write_env_var "$vite_var" "$PACKAGE_ID" "$ENV_FILE"

  # Also update the web env file so vite picks up the IDs
  if [ -f "$WEB_ENV_FILE" ]; then
    write_env_var "$vite_var" "$PACKAGE_ID" "$WEB_ENV_FILE"
  fi

  # ── Extract shared object IDs created during init ────────────────
  if [ "$pkg" = "tribe" ]; then
    echo "  Querying TribeRegistry shared object ID..."
    TRIBE_REGISTRY_ID=$(
      curl -s "$SUI_RPC" -X POST \
        -H 'Content-Type: application/json' \
        -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"suix_queryEvents\",\"params\":[{\"MoveEventType\":\"${PACKAGE_ID}::tribe::TribeRegistryCreatedEvent\"},null,1,false]}" \
      | jq -r '.result.data[0].parsedJson.registry_id'
    )
    if [ -n "$TRIBE_REGISTRY_ID" ] && [ "$TRIBE_REGISTRY_ID" != "null" ]; then
      echo "  VITE_TRIBE_REGISTRY_ID=$TRIBE_REGISTRY_ID"
      write_env_var "VITE_TRIBE_REGISTRY_ID" "$TRIBE_REGISTRY_ID" "$ENV_FILE"
      if [ -f "$WEB_ENV_FILE" ]; then
        write_env_var "VITE_TRIBE_REGISTRY_ID" "$TRIBE_REGISTRY_ID" "$WEB_ENV_FILE"
      fi
    else
      echo "  WARNING: Could not extract TribeRegistry ID from publish events" >&2
    fi
  fi

  if [ "$pkg" = "assembly_metadata" ]; then
    echo "  Querying MetadataRegistry shared object ID..."
    METADATA_REGISTRY_ID=$(
      curl -s "$SUI_RPC" -X POST \
        -H 'Content-Type: application/json' \
        -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"suix_queryEvents\",\"params\":[{\"MoveEventType\":\"${PACKAGE_ID}::assembly_metadata::MetadataRegistryCreatedEvent\"},null,1,false]}" \
      | jq -r '.result.data[0].parsedJson.registry_id'
    )
    if [ -n "$METADATA_REGISTRY_ID" ] && [ "$METADATA_REGISTRY_ID" != "null" ]; then
      echo "  VITE_METADATA_REGISTRY_ID=$METADATA_REGISTRY_ID"
      write_env_var "VITE_METADATA_REGISTRY_ID" "$METADATA_REGISTRY_ID" "$ENV_FILE"
      if [ -f "$WEB_ENV_FILE" ]; then
        write_env_var "VITE_METADATA_REGISTRY_ID" "$METADATA_REGISTRY_ID" "$WEB_ENV_FILE"
      fi
    else
      echo "  WARNING: Could not extract MetadataRegistry ID from publish events" >&2
    fi
  fi
done

rm -f /tmp/publish-result.json /tmp/publish-result-clean.json

# ── Create CormConfig (post-deploy admin setup) ──────────────────
# The permissionless `install` function requires a shared CormConfig
# object on-chain. We create it here using the CormAdminCap (owned by
# the publisher from corm_auth init) and the brain address.
CORM_AUTH_PKG=$(grep '^PACKAGE_CORM_AUTH=' "$ENV_FILE" | cut -d= -f2)
CORM_STATE_PKG=$(grep '^PACKAGE_CORM_STATE=' "$ENV_FILE" | cut -d= -f2)

if [ -n "$CORM_AUTH_PKG" ] && [ -n "$CORM_STATE_PKG" ]; then
  echo ""
  echo "Creating CormConfig..."

  PUBLISHER_ADDR=$(sui client active-address)

  # Find CormAdminCap owned by the publisher
  ADMIN_CAP_ID=$(
    curl -s "$SUI_RPC" -X POST \
      -H 'Content-Type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"suix_getOwnedObjects\",\"params\":[\"$PUBLISHER_ADDR\",{\"filter\":{\"StructType\":\"${CORM_AUTH_PKG}::corm_auth::CormAdminCap\"},\"options\":{\"showType\":true}},null,1]}" \
    | jq -r '.result.data[0].data.objectId'
  )

  if [ -z "$ADMIN_CAP_ID" ] || [ "$ADMIN_CAP_ID" = "null" ]; then
    echo "  WARNING: Could not find CormAdminCap. Skipping CormConfig creation." >&2
  else
    # Resolve brain address from env var or prompt interactively
    BRAIN_ADDRESS="${CORM_BRAIN_ADDRESS:-}"
    if [ -z "$BRAIN_ADDRESS" ] && [ -f "$ENV_FILE" ]; then
      BRAIN_ADDRESS=$(grep '^CORM_BRAIN_ADDRESS=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)
    fi
    if [ -z "$BRAIN_ADDRESS" ]; then
      echo ""
      echo "A brain address is required to create CormConfig. This is the Sui address"
      echo "of the continuity-engine service keypair that will administer all corms."
      read -rp "Enter the brain address (0x...): " BRAIN_ADDRESS
    fi
    if [ -z "$BRAIN_ADDRESS" ]; then
      echo "  WARNING: No brain address provided. Skipping CormConfig creation." >&2
    else
      echo "  CormAdminCap: $ADMIN_CAP_ID"
      echo "  Brain address: $BRAIN_ADDRESS"

      sui client call \
        --package "$CORM_STATE_PKG" \
        --module corm_state \
        --function create_config \
        --args "$ADMIN_CAP_ID" "$BRAIN_ADDRESS" \
        --gas-budget "$GAS_BUDGET" \
        --json > /tmp/create-config-result.json 2>&1 || true
      # Note: CLI may return non-zero even on success (version mismatch warnings)

    sed -n '/^{/,$p' /tmp/create-config-result.json > /tmp/create-config-result-clean.json
    CORM_CONFIG_ID=$(
      jq -r '(.changed_objects // .objectChanges // [])[] | select(.idOperation == "CREATED" or .type == "created") | select(.objectType | contains("CormConfig")) | .objectId' /tmp/create-config-result-clean.json
    )

      if [ -n "$CORM_CONFIG_ID" ] && [ "$CORM_CONFIG_ID" != "null" ]; then
        echo "  VITE_CORM_CONFIG_ID=$CORM_CONFIG_ID"
        write_env_var "VITE_CORM_CONFIG_ID" "$CORM_CONFIG_ID" "$ENV_FILE"
        if [ -f "$WEB_ENV_FILE" ]; then
          write_env_var "VITE_CORM_CONFIG_ID" "$CORM_CONFIG_ID" "$WEB_ENV_FILE"
        fi
      else
        echo "  WARNING: Could not extract CormConfig ID from create_config result" >&2
      fi

      rm -f /tmp/create-config-result.json /tmp/create-config-result-clean.json
    fi
  fi
else
  echo ""
  echo "WARNING: corm_auth or corm_state package not found. Skipping CormConfig creation." >&2
fi

echo ""
echo "All contracts published to testnet ($ENV). Package IDs written to:"
echo "  $ENV_FILE"
[ -f "$WEB_ENV_FILE" ] && echo "  $WEB_ENV_FILE"
