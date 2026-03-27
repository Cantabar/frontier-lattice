/**
 * Attestation — BCS encoding and Ed25519 signing for BuildAttestation.
 *
 * Produces the exact byte layout that `witness_utils::unpack_build_attestation`
 * expects on-chain. The signature follows SUI's PersonalMessage format
 * (matching `sig_verify::verify_signature`).
 */

import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

// ============================================================
// BuildAttestation BCS schema
// ============================================================

/**
 * BCS-encoded fields in the exact order the Move contract deserialises.
 *
 * All `ID` fields are encoded as 32-byte addresses (SUI object IDs).
 * `address` fields are also 32 bytes.
 */
export interface BuildAttestationData {
  contractId: string;     // hex object ID
  witnessAddress: string; // hex SUI address
  builderCharacterId: string;
  builderAddress: string;
  structureId: string;
  structureTypeId: bigint;
  ownerCapId: string;
  extensionAuthorized: boolean;
  anchorTxDigest: Uint8Array;
  anchorCheckpointSeq: bigint;
  extensionTxDigest: Uint8Array;
  deadlineMs: bigint;
}

/**
 * Encode a BuildAttestation to BCS bytes matching the Move
 * `unpack_build_attestation` deserialization order.
 */
export function encodeBuildAttestation(data: BuildAttestationData): Uint8Array {
  const Address = bcs.Address;
  const writer = bcs.writer();

  writer.write(Address, data.contractId);
  writer.write(Address, data.witnessAddress);
  writer.write(Address, data.builderCharacterId);
  writer.write(Address, data.builderAddress);
  writer.write(Address, data.structureId);
  writer.write(bcs.u64(), data.structureTypeId);
  writer.write(Address, data.ownerCapId);
  writer.write(bcs.bool(), data.extensionAuthorized);
  writer.write(bcs.vector(bcs.u8()), data.anchorTxDigest);
  writer.write(bcs.u64(), data.anchorCheckpointSeq);
  writer.write(bcs.vector(bcs.u8()), data.extensionTxDigest);
  writer.write(bcs.u64(), data.deadlineMs);

  return writer.toBytes();
}

// ============================================================
// Ed25519 Signing (SUI PersonalMessage format)
// ============================================================

/**
 * Sign a BCS-encoded attestation using the SUI PersonalMessage intent
 * protocol. Returns the full SUI signature (flag + sig + pubkey).
 *
 * This matches what `sig_verify::verify_signature` expects on-chain:
 *   intent = 0x030000 (PersonalMessage, V0, Sui)
 *   digest = blake2b256(intent || message)
 *   signature = Ed25519.sign(digest, privateKey)
 *   fullSig = 0x00 || signature(64) || publicKey(32)
 */
export function signAttestation(
  attestationBytes: Uint8Array,
  keypair: Ed25519Keypair,
): Uint8Array {
  const { signature } = keypair.signPersonalMessage(attestationBytes);
  // signPersonalMessage returns base64; decode to raw bytes
  return Buffer.from(signature, "base64");
}

/**
 * Load an Ed25519Keypair from a base64-encoded secret key.
 */
export function loadKeypair(base64SecretKey: string): Ed25519Keypair {
  return Ed25519Keypair.fromSecretKey(Buffer.from(base64SecretKey, "base64"));
}
