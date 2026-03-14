#!/usr/bin/env bash
set -euo pipefail

# Deploy, configure, and seed the Eve Frontier world contracts on SUI localnet.
# Called by mprocs world-contracts or run standalone.
#
# Usage:  ./scripts/deploy-world-contracts.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORLD_DIR="$PROJECT_ROOT/../world-contracts"

if [ ! -d "$WORLD_DIR/scripts" ]; then
  echo "ERROR: world-contracts repo not found at $WORLD_DIR" >&2
  exit 1
fi

# ── Wait for SUI localnet ───────────────────────────────────────────
echo "Waiting for SUI localnet..."
until curl -so /dev/null -w '%{http_code}' http://127.0.0.1:9000 >/dev/null 2>&1; do
  sleep 2
done
echo "SUI localnet is up"

# ── Ensure 'localnet' env alias exists ──────────────────────────────
sui client new-env --alias localnet --rpc http://127.0.0.1:9000 2>/dev/null || true
sui client switch --env localnet 2>/dev/null

# ── Wait for faucet and request gas ─────────────────────────────────
echo "Waiting for faucet..."
until curl -so /dev/null http://127.0.0.1:9123 2>/dev/null; do
  sleep 2
done

request_gas() {
  local count="${1:-1}"
  for i in $(seq 1 "$count"); do
    sui client faucet 2>&1 || true
    sleep 2
  done
  # Wait for at least one coin to arrive
  until sui client gas --json 2>/dev/null | jq -e 'length > 0' >/dev/null 2>&1; do
    sleep 2
  done
}

echo "Requesting gas (initial)..."
request_gas 3
echo "Gas available"

# ── Set identity for world-contracts scripts ─────────────────────────
ADMIN_ADDRESS=$(sui client active-address)
echo "Active SUI address: $ADMIN_ADDRESS"

# Export the private key (needed by configure & seed steps to sign txns)
ADMIN_PRIVATE_KEY=$(sui keytool export --key-identity "$ADMIN_ADDRESS" --json 2>/dev/null \
  | jq -r '.exportedPrivateKey')

# Write into world-contracts .env so values survive the setup() source step
WORLD_ENV="$WORLD_DIR/.env"
write_env_var() {
  local var="$1" val="$2"
  if grep -q "^${var}=" "$WORLD_ENV" 2>/dev/null; then
    sed -i "s|^${var}=.*|${var}=${val}|" "$WORLD_ENV"
  else
    # Ensure file ends with a newline before appending
    [ -s "$WORLD_ENV" ] && [ -n "$(tail -c1 "$WORLD_ENV")" ] && echo >> "$WORLD_ENV"
    echo "${var}=${val}" >> "$WORLD_ENV"
  fi
}
write_env_var ADMIN_ADDRESS        "$ADMIN_ADDRESS"
write_env_var ADMIN_PRIVATE_KEY    "$ADMIN_PRIVATE_KEY"
write_env_var GOVERNOR_PRIVATE_KEY "$ADMIN_PRIVATE_KEY"
write_env_var SPONSOR_ADDRESSES    "$ADMIN_ADDRESS"

# Generate player keypairs for seeding (idempotent — only if not already set)
if ! grep -q '^PLAYER_A_PRIVATE_KEY=suiprivkey' "$WORLD_ENV" 2>/dev/null; then
  echo "Generating player keypairs for localnet..."
  PLAYER_A_ADDR=$(sui client new-address ed25519 --json 2>/dev/null | jq -r '.address')
  PLAYER_B_ADDR=$(sui client new-address ed25519 --json 2>/dev/null | jq -r '.address')
  PLAYER_A_KEY=$(sui keytool export --key-identity "$PLAYER_A_ADDR" --json 2>/dev/null | jq -r '.exportedPrivateKey')
  PLAYER_B_KEY=$(sui keytool export --key-identity "$PLAYER_B_ADDR" --json 2>/dev/null | jq -r '.exportedPrivateKey')
  write_env_var PLAYER_A_PRIVATE_KEY "$PLAYER_A_KEY"
  write_env_var PLAYER_B_PRIVATE_KEY "$PLAYER_B_KEY"
  sui client switch --address "$ADMIN_ADDRESS" 2>/dev/null
fi

# Fund player accounts (needed each regenesis since --force-regenesis wipes balances)
# Derive addresses from private keys via keytool import (idempotent)
PLAYER_A_KEY=$(grep '^PLAYER_A_PRIVATE_KEY=' "$WORLD_ENV" | cut -d= -f2)
PLAYER_B_KEY=$(grep '^PLAYER_B_PRIVATE_KEY=' "$WORLD_ENV" | cut -d= -f2)
PLAYER_A_ADDR=$(sui keytool import "$PLAYER_A_KEY" ed25519 --json 2>/dev/null | jq -r '.suiAddress')
PLAYER_B_ADDR=$(sui keytool import "$PLAYER_B_KEY" ed25519 --json 2>/dev/null | jq -r '.suiAddress')
echo "Funding player accounts ($PLAYER_A_ADDR, $PLAYER_B_ADDR)..."
for ADDR in "$PLAYER_A_ADDR" "$PLAYER_B_ADDR"; do
  sui client switch --address "$ADDR" 2>/dev/null
  sui client faucet 2>&1 || true
  sleep 2
done
sui client switch --address "$ADMIN_ADDRESS" 2>/dev/null
sleep 5

# ── Deploy, configure, seed ─────────────────────────────────────────
echo "=== Deploying world contracts ==="
bash "$WORLD_DIR/scripts/deploy-world.sh" localnet

echo "=== Configuring world ==="
bash "$WORLD_DIR/scripts/configure-world.sh" localnet

# Top up gas before the many seed transactions
echo "Requesting additional gas for seeding..."
request_gas 5

echo "=== Seeding world ==="
bash "$WORLD_DIR/scripts/seed-world.sh" localnet

echo "World contracts deployed, configured, and seeded."
