/**
 * Shadow Location Network — server-side cryptographic utilities.
 *
 * Responsibilities:
 *   - Generate random AES-256-GCM Tribe Location Keys (TLK)
 *   - Wrap / unwrap TLK using X25519 ECDH + HKDF
 *   - Verify SUI wallet personal message signatures for API auth
 *
 * The server NEVER sees plaintext location data. It only handles
 * TLK lifecycle and signature verification.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import { x25519, ed25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2b";
import { verifyTransactionSignature } from "@mysten/sui/verify";
import { parseSerializedSignature } from "@mysten/sui/cryptography";

// ============================================================
// TLK Generation
// ============================================================

/** Generate a random 256-bit AES key for tribe location encryption. */
export function generateTlk(): Buffer {
  return randomBytes(32);
}

// ============================================================
// X25519 Key Wrapping (ECIES-style)
//
// To wrap a TLK for a tribe member:
//   1. Generate ephemeral X25519 keypair
//   2. ECDH with member's X25519 public key → shared secret
//   3. HKDF-SHA256(shared secret) → wrapping key
//   4. AES-256-GCM encrypt the TLK with the wrapping key
//   5. Output: ephemeral_pub ‖ nonce ‖ ciphertext ‖ tag
//
// The member unwraps by performing ECDH with their X25519 secret
// key and the ephemeral public key, then decrypting.
// ============================================================

const WRAP_INFO = Buffer.from("frontier-corm-tlk-wrap-v1");

/** Derive a 32-byte wrapping key from an X25519 shared secret via HMAC-SHA256. */
function deriveWrappingKey(sharedSecret: Uint8Array): Buffer {
  // Simplified HKDF-extract + expand (single block) using HMAC-SHA256
  const prk = createHmac("sha256", WRAP_INFO).update(sharedSecret).digest();
  return prk; // 32 bytes — sufficient for AES-256
}

/**
 * Wrap a TLK for a specific member's X25519 public key.
 *
 * @param tlk          Raw 32-byte AES key
 * @param memberX25519Pub  Member's X25519 public key (32 bytes)
 * @returns Opaque wrapped key blob (ephemeral_pub ‖ nonce ‖ ciphertext ‖ tag)
 */
export function wrapTlk(tlk: Buffer, memberX25519Pub: Uint8Array): Buffer {
  // Ephemeral keypair
  const ephPriv = x25519.utils.randomPrivateKey();
  const ephPub = x25519.getPublicKey(ephPriv);

  // ECDH → shared secret
  const shared = x25519.getSharedSecret(ephPriv, memberX25519Pub);
  const wrappingKey = deriveWrappingKey(shared);

  // AES-256-GCM encrypt the TLK
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(tlk), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Pack: ephPub(32) + nonce(12) + ciphertext(32) + tag(16) = 92 bytes
  return Buffer.concat([ephPub, nonce, ciphertext, tag]);
}

/**
 * Unwrap a TLK using the member's X25519 private key.
 * (Server-side utility for testing / key rotation; normally done client-side.)
 */
export function unwrapTlk(wrappedKey: Buffer, memberX25519Priv: Uint8Array): Buffer {
  const ephPub = wrappedKey.subarray(0, 32);
  const nonce = wrappedKey.subarray(32, 44);
  const ciphertext = wrappedKey.subarray(44, 76);
  const tag = wrappedKey.subarray(76, 92);

  const shared = x25519.getSharedSecret(memberX25519Priv, ephPub);
  const wrappingKey = deriveWrappingKey(shared);

  const decipher = createDecipheriv("aes-256-gcm", wrappingKey, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ============================================================
// Wallet Signature Verification
// ============================================================

/**
 * Challenge format (human-readable, multi-line):
 *
 *   CORM Location Network \u2014 Identity Verification
 *
 *   This signature proves you own this wallet.
 *   No transaction will be submitted and no funds will be spent.
 *   Address: <address>
 *   Timestamp: <timestamp_ms>
 *
 * Legacy format (still accepted for backward compatibility):
 *   frontier-corm:<address>:<timestamp_ms>
 *
 * The client signs a no-op transaction with signTransaction(). The server
 * verifies the transaction signature and that the challenge timestamp is
 * within the allowed window (5 minutes).
 */
const CHALLENGE_WINDOW_MS = 5 * 60 * 1000;

export interface AuthResult {
  valid: boolean;
  address: string;
  error?: string;
}

/** Parse the human-readable or legacy challenge text into address + timestamp. */
function parseChallenge(text: string): { address: string; timestampMs: number } | null {
  // New multi-line format: look for "Address: ..." and "Timestamp: ..." lines
  const addressMatch = text.match(/^Address:\s*(.+)$/m);
  const timestampMatch = text.match(/^Timestamp:\s*(\d+)$/m);
  if (addressMatch && timestampMatch) {
    return { address: addressMatch[1].trim(), timestampMs: Number(timestampMatch[1]) };
  }

  // Legacy format: "frontier-corm:<address>:<timestamp_ms>"
  const parts = text.split(":");
  if (parts.length === 3 && parts[0] === "frontier-corm") {
    return { address: parts[1], timestampMs: Number(parts[2]) };
  }

  return null;
}

/**
 * Verify a TxSig authorization: transaction signature + separate challenge.
 *
 * The transaction signature proves wallet ownership (cryptographic identity).
 * The challenge provides freshness (timestamp) and address binding.
 *
 * @param challenge  Raw challenge bytes (address + timestamp)
 * @param txBytes    BCS-encoded transaction bytes from signTransaction
 * @param signature  Base64-encoded SUI signature (scheme flag + sig + pubkey)
 * @returns          AuthResult with the verified address or an error
 */
export async function verifyTxAuth(
  challenge: Uint8Array,
  txBytes: Uint8Array,
  signature: string,
): Promise<AuthResult> {
  try {
    // 1. Parse the challenge for claimed address + timestamp
    const text = new TextDecoder().decode(challenge);
    const parsed = parseChallenge(text);
    if (!parsed) {
      return { valid: false, address: "", error: "Invalid challenge format" };
    }

    const { address: claimedAddress, timestampMs } = parsed;

    // 2. Check timestamp freshness
    const now = Date.now();
    if (Math.abs(now - timestampMs) > CHALLENGE_WINDOW_MS) {
      return { valid: false, address: claimedAddress, error: "Challenge expired" };
    }

    // 3. Verify the transaction signature and extract the signer address
    try {
      const publicKey = await verifyTransactionSignature(txBytes, signature, {
        address: claimedAddress,
      });
      const recoveredAddress = publicKey.toSuiAddress();
      if (recoveredAddress !== claimedAddress) {
        return { valid: false, address: claimedAddress, error: "Address mismatch" };
      }
      return { valid: true, address: claimedAddress };
    } catch (sdkErr) {
      // Fallback: manual Ed25519 verification against the transaction digest.
      // Some wallets may produce signatures that the SDK wrapper rejects
      // but are cryptographically valid.
      try {
        const parsedSig = parseSerializedSignature(signature);
        if (
          parsedSig.signatureScheme === "ED25519" ||
          parsedSig.signatureScheme === "Secp256k1" ||
          parsedSig.signatureScheme === "Secp256r1"
        ) {
          // Transaction intent prefix: [0, 0, 0] (scope=0 for TransactionData)
          const intentPrefix = new Uint8Array([0, 0, 0]);
          const intentMessage = new Uint8Array(intentPrefix.length + txBytes.length);
          intentMessage.set(intentPrefix);
          intentMessage.set(txBytes, intentPrefix.length);
          const digest = blake2b(intentMessage, { dkLen: 32 });

          if (parsedSig.signatureScheme === "ED25519") {
            const valid = ed25519.verify(parsedSig.signature, digest, parsedSig.publicKey);
            if (valid) {
              return { valid: true, address: claimedAddress };
            }
          }
          // Secp256k1/r1 manual fallback could be added here if needed
        }
      } catch {
        // Manual fallback also failed — propagate original error
      }
      throw sdkErr;
    }
  } catch (err) {
    return {
      valid: false,
      address: "",
      error: err instanceof Error ? err.message : "TxSig verification failed",
    };
  }
}

