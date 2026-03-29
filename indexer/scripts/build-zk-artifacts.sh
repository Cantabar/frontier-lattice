#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CIRCUITS_DIR="$ROOT_DIR/circuits"
BUILD_DIR="$CIRCUITS_DIR/build"
ARTIFACTS_DIR="$CIRCUITS_DIR/artifacts"
PTAU_FILE="$CIRCUITS_DIR/powersOfTau28_hez_final_16.ptau"

function require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

function setup_ptau() {
  if [[ -f "$PTAU_FILE" ]]; then
    echo "[zk] Using existing PTAU: $PTAU_FILE"
    return
  fi

  mkdir -p "$BUILD_DIR/ptau"
  local pot0="$BUILD_DIR/ptau/pot16_0000.ptau"
  local pot1="$BUILD_DIR/ptau/pot16_0001.ptau"

  echo "[zk] No PTAU found, generating local Powers of Tau (bn128, 2^16)..."
  npx snarkjs powersoftau new bn128 16 "$pot0" -v
  npx snarkjs powersoftau contribute "$pot0" "$pot1" \
    --name="frontier-corm-local" \
    -v \
    -e="frontier-corm-$(date +%s)"
  npx snarkjs powersoftau prepare phase2 "$pot1" "$PTAU_FILE"
  echo "[zk] PTAU generated at $PTAU_FILE"
}

function build_circuit() {
  local circuit_name="$1"
  local circuit_src="$CIRCUITS_DIR/${circuit_name}.circom"
  local out_dir="$BUILD_DIR/$circuit_name"
  local r1cs="$out_dir/${circuit_name}.r1cs"
  local zkey0="$out_dir/${circuit_name}_0000.zkey"
  local zkey_final="$out_dir/${circuit_name}_final.zkey"
  local wasm="$out_dir/${circuit_name}_js/${circuit_name}.wasm"

  mkdir -p "$out_dir"

  echo "[zk] Compiling $circuit_name.circom..."
  circom "$circuit_src" --r1cs --wasm --sym --output "$out_dir"

  echo "[zk] Groth16 setup for $circuit_name..."
  npx snarkjs groth16 setup "$r1cs" "$PTAU_FILE" "$zkey0"
  npx snarkjs zkey contribute "$zkey0" "$zkey_final" \
    --name="frontier-corm-local" \
    -v \
    -e="frontier-corm-${circuit_name}-$(date +%s)"
  npx snarkjs zkey export verificationkey "$zkey_final" "$ARTIFACTS_DIR/${circuit_name}_vkey.json"

  cp "$wasm" "$ARTIFACTS_DIR/${circuit_name}.wasm"
  cp "$zkey_final" "$ARTIFACTS_DIR/${circuit_name}_final.zkey"
}

require_cmd circom
require_cmd npx

mkdir -p "$BUILD_DIR" "$ARTIFACTS_DIR"
setup_ptau

build_circuit "region_filter"
build_circuit "proximity_filter"
build_circuit "mutual_proximity_filter"

echo "[zk] Done. Artifacts written to:"
echo "  - $ARTIFACTS_DIR"
