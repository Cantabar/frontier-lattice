pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/**
 * MutualProximityFilter — proves two Poseidon-committed locations
 * are within a distance threshold of each other.
 *
 * Use case: a tribe member who has decrypted both PODs via the TLK
 * generates this proof to satisfy a witnessed contract's proximity
 * requirement (e.g. "build within 10 ly of structure X") without
 * revealing either location.
 *
 * Public inputs:
 *   locationHash1        — Poseidon4 commitment for structure A
 *   locationHash2        — Poseidon4 commitment for structure B
 *   maxDistanceSquared   — distance² threshold (e.g. 10² = 100)
 *
 * Private witnesses:
 *   x1, y1, z1, salt1   — plaintext coords + salt for structure A
 *   x2, y2, z2, salt2   — plaintext coords + salt for structure B
 */
template MutualProximityFilter(bitSize) {
  // Public inputs
  signal input locationHash1;
  signal input locationHash2;
  signal input maxDistanceSquared;

  // Private witnesses — structure A
  signal input x1;
  signal input y1;
  signal input z1;
  signal input salt1;

  // Private witnesses — structure B
  signal input x2;
  signal input y2;
  signal input z2;
  signal input salt2;

  // Verify Poseidon commitment for structure A
  component hash1 = Poseidon(4);
  hash1.inputs[0] <== x1;
  hash1.inputs[1] <== y1;
  hash1.inputs[2] <== z1;
  hash1.inputs[3] <== salt1;
  hash1.out === locationHash1;

  // Verify Poseidon commitment for structure B
  component hash2 = Poseidon(4);
  hash2.inputs[0] <== x2;
  hash2.inputs[1] <== y2;
  hash2.inputs[2] <== z2;
  hash2.inputs[3] <== salt2;
  hash2.out === locationHash2;

  // Distance² = (x1 - x2)² + (y1 - y2)² + (z1 - z2)²
  signal dx <== x1 - x2;
  signal dy <== y1 - y2;
  signal dz <== z1 - z2;

  signal dxSq <== dx * dx;
  signal dySq <== dy * dy;
  signal dzSq <== dz * dz;
  signal distanceSquared <== dxSq + dySq + dzSq;

  // distanceSquared <= maxDistanceSquared
  component withinDistance = LessEqThan(bitSize);
  withinDistance.in[0] <== distanceSquared;
  withinDistance.in[1] <== maxDistanceSquared;
  withinDistance.out === 1;
}

component main {public [
  locationHash1,
  locationHash2,
  maxDistanceSquared
]} = MutualProximityFilter(252);
