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
  echo "Usage: $0 <environment>"
  echo "  Environments: ${VALID_ENVS[*]}"
  exit 1
fi

ENV="$1"

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
GAS_BUDGET=2000000000  # 2 SUI
SUI_RPC="https://fullnode.testnet.sui.io:443"

PACKAGES=("tribe" "corm_auth" "trustless_contracts" "corm_state")
ENV_VARS=("PACKAGE_TRIBE" "PACKAGE_CORM_AUTH" "PACKAGE_TRUSTLESS_CONTRACTS" "PACKAGE_CORM_STATE")
VITE_VARS=("VITE_TRIBE_PACKAGE_ID" "VITE_CORM_AUTH_PACKAGE_ID" "VITE_TRUSTLESS_CONTRACTS_PACKAGE_ID" "VITE_CORM_STATE_PACKAGE_ID")

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
WORLD_PATH=$(cd "$PROJECT_ROOT/../world-contracts/contracts/world" && pwd)

echo "Chain ID: $CHAIN_ID"

# ── Generate Pub.{ENV}.toml with world dependency pinned ───────────
rm -f "$PUB_FILE"
cat > "$PUB_FILE" <<EOF
# generated by publish-contracts.sh for $ENV
build-env = "$ENV"
chain-id = "$CHAIN_ID"

[[published]]
source = { local = "$WORLD_PATH" }
published-at = "$WORLD_PKG_ID"
original-id = "$WORLD_PKG_ID"
version = 1
toolchain-version = "$SUI_VERSION"
build-config = { flavor = "sui", edition = "2024" }
EOF
echo "Generated $PUB_FILE"

# ── Clear stale package IDs ────────────────────────────────────────
echo "Clearing stale contract IDs from $ENV_FILE..."
for var in "${ENV_VARS[@]}" "${VITE_VARS[@]}" VITE_TRIBE_REGISTRY_ID; do
  if grep -q "^${var}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${var}=.*|${var}=|" "$ENV_FILE"
  fi
done

# ── Publish each package ──────────────────────────────────────────
for i in "${!PACKAGES[@]}"; do
  pkg="${PACKAGES[$i]}"
  var="${ENV_VARS[$i]}"
  pkg_path="$PROJECT_ROOT/contracts/$pkg"

  echo ""
  echo "Publishing $pkg..."
  sui client publish "$pkg_path" \
    --gas-budget "$GAS_BUDGET" \
    --build-env "$ENV" \
    --with-unpublished-dependencies \
    --json > /tmp/publish-result.json 2>&1 || {
    echo "ERROR: publish failed for $pkg" >&2
    cat /tmp/publish-result.json >&2
    exit 1
  }

  # Extract package ID from publish transaction result
  PACKAGE_ID=$(jq -r '.objectChanges[] | select(.type == "published") | .packageId' /tmp/publish-result.json)
  if [ -z "$PACKAGE_ID" ] || [ "$PACKAGE_ID" = "null" ]; then
    # Fallback: try reading from Pub.{ENV}.toml
    PACKAGE_ID=$(grep -A1 "$pkg_path" "$PUB_FILE" | grep 'published-at' | sed 's/.*"\(0x[^"]*\)".*/\1/')
  fi

  if [ -z "$PACKAGE_ID" ] || [ "$PACKAGE_ID" = "null" ]; then
    echo "ERROR: Could not extract package ID for $pkg" >&2
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
done

rm -f /tmp/publish-result.json

echo ""
echo "All contracts published to testnet ($ENV). Package IDs written to:"
echo "  $ENV_FILE"
[ -f "$WEB_ENV_FILE" ] && echo "  $WEB_ENV_FILE"
