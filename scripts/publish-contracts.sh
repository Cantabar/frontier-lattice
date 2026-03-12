#!/usr/bin/env bash
set -euo pipefail

# Publish all Move packages to SUI localnet and write package IDs to .env
# Called by mprocs contracts-publish or run standalone.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"
PUB_FILE="$PROJECT_ROOT/Pub.local.toml"
GAS_BUDGET=2000000000  # 2 SUI — publishing with deps needs more than 0.5

PACKAGES=("tribe" "contract_board" "forge_planner")
ENV_VARS=("PACKAGE_TRIBE" "PACKAGE_CONTRACT_BOARD" "PACKAGE_FORGE_PLANNER")

write_env_var() {
  local var="$1" val="$2" file="$3"
  if grep -q "^${var}=" "$file" 2>/dev/null; then
    sed -i '' "s|^${var}=.*|${var}=${val}|" "$file"
  else
    echo "${var}=${val}" >> "$file"
  fi
}

echo "Waiting for SUI localnet..."
until curl -so /dev/null -w '%{http_code}' http://127.0.0.1:9000 >/dev/null 2>&1; do
  sleep 2
done

# Ensure the client is pointing at localnet
if ! sui client envs 2>/dev/null | grep -q 'local'; then
  echo "Adding local env to SUI client..."
  sui client new-env --alias local --rpc http://127.0.0.1:9000 2>/dev/null
fi
sui client switch --env local 2>/dev/null
echo "Switched to local env"

# Wait for faucet to be ready, then request gas
echo "Waiting for faucet..."
until curl -so /dev/null http://127.0.0.1:9123 2>/dev/null; do
  sleep 2
done
echo "Requesting faucet funds..."
sui client faucet 2>&1 || true

# Wait for coins to arrive
echo "Waiting for gas coins..."
until sui client gas --json 2>/dev/null | jq -e 'length > 0' >/dev/null 2>&1; do
  sleep 2
done
echo "Gas available"

# Remove stale ephemeral publication file (--force-regenesis means new chain each time)
rm -f "$PUB_FILE"

for i in "${!PACKAGES[@]}"; do
  pkg="${PACKAGES[$i]}"
  var="${ENV_VARS[$i]}"
  pkg_path="$PROJECT_ROOT/contracts/$pkg"

  echo "Publishing $pkg..."
  sui client test-publish "$pkg_path" \
    --gas-budget "$GAS_BUDGET" \
    --build-env localnet \
    --with-unpublished-dependencies \
    > /dev/null 2>&1 || {
    echo "ERROR: test-publish failed for $pkg" >&2
    # Retry without suppressing output so the error is visible
    sui client test-publish "$pkg_path" \
      --gas-budget "$GAS_BUDGET" \
      --build-env localnet \
      --with-unpublished-dependencies 2>&1 || true
    exit 1
  }

  # test-publish records the package ID in Pub.local.toml — read it from there
  PACKAGE_ID=$(grep -A1 "$pkg_path" "$PUB_FILE" | grep 'published-at' | sed 's/.*"\(0x[^"]*\)".*/\1/')
  echo "  $var=$PACKAGE_ID"
  write_env_var "$var" "$PACKAGE_ID" "$ENV_FILE"
done

echo ""
echo "All contracts published. Package IDs written to $ENV_FILE"
