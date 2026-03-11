#!/usr/bin/env bash
set -euo pipefail

# Frontier Lattice — First-Time Bootstrap
#
# Installs dependencies and prepares the environment for local dev or AWS deploy.
# Safe to run multiple times (idempotent).
#
# Usage:  ./scripts/bootstrap.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Frontier Lattice Bootstrap ==="

# ── .env file ──────────────────────────────────────────────────────
if [ ! -f "$ROOT_DIR/.env" ]; then
  echo "[env] Creating .env from .env.example..."
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "[env] Edit .env with your Sui RPC URL and package IDs."
else
  echo "[env] .env already exists, skipping."
fi

# ── npm install ────────────────────────────────────────────────────
echo "[npm] Installing indexer dependencies..."
npm --prefix "$ROOT_DIR/indexer" ci

echo "[npm] Installing app dependencies..."
npm --prefix "$ROOT_DIR/app" ci

echo "[npm] Installing infra (CDK) dependencies..."
npm --prefix "$ROOT_DIR/infra" ci

# ── Docker check ───────────────────────────────────────────────────
if command -v docker &>/dev/null; then
  echo "[docker] Docker found: $(docker --version)"
else
  echo "[docker] WARNING: Docker not found. Install Docker to use 'make local'."
fi

# ── AWS CLI check ──────────────────────────────────────────────────
if command -v aws &>/dev/null; then
  echo "[aws] AWS CLI found: $(aws --version 2>&1 | head -1)"
  if aws sts get-caller-identity &>/dev/null; then
    ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    echo "[aws] Authenticated as account: $ACCOUNT"
  else
    echo "[aws] WARNING: Not authenticated. Run 'aws configure' or set credentials."
  fi
else
  echo "[aws] WARNING: AWS CLI not found. Install it to deploy to AWS."
fi

echo ""
echo "=== Bootstrap Complete ==="
echo ""
echo "  Local dev:   make local"
echo "  First deploy: make infra-init && make deploy"
echo "  Teardown:    make teardown"
echo ""
