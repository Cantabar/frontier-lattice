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
import { x25519 } from "@noble/curves/ed25519";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { DEFAULT_CONFIG } from "../types.js";

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
 * The client signs this with signPersonalMessage(). The server verifies
 * that the signature was produced by the claimed address and that the
 * timestamp is within the allowed window (5 minutes).
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
 * Verify a SUI wallet personal message signature.
 *
 * @param message    The raw challenge bytes the client signed
 * @param signature  Base64-encoded SUI signature (scheme flag + sig + pubkey)
 * @returns          AuthResult with the verified address or an error
 */
export async function verifyWalletAuth(
  message: Uint8Array,
  signature: string,
): Promise<AuthResult> {
  try {
    // Parse the challenge text
    const text = new TextDecoder().decode(message);
    const parsed = parseChallenge(text);
    if (!parsed) {
      return { valid: false, address: "", error: "Invalid challenge format" };
    }

    const { address: claimedAddress, timestampMs } = parsed;

    // Check timestamp freshness
    const now = Date.now();
    if (Math.abs(now - timestampMs) > CHALLENGE_WINDOW_MS) {
      return { valid: false, address: claimedAddress, error: "Challenge expired" };
    }

    // Verify the signature using the Sui SDK.
    // For standard Ed25519/Secp signatures this is local-only.
    // For zkLogin signatures the SDK makes a GraphQL call which may fail
    // if the SDK's query is out of sync with the Sui GraphQL schema.
    // In that case we fall back to the JSON-RPC endpoint.
    try {
      const publicKey = await verifyPersonalMessageSignature(message, signature, {
        address: claimedAddress,
      });

      const recoveredAddress = publicKey.toSuiAddress();
      if (recoveredAddress !== claimedAddress) {
        return { valid: false, address: claimedAddress, error: "Address mismatch" };
      }

      return { valid: true, address: claimedAddress };
    } catch (sdkErr) {
      // Check if this is a zkLogin GraphQL schema mismatch.
      // The SDK's built-in query may reference fields that don't exist
      // on the node's GraphQL schema (e.g. "error" vs "errors").
      const errMsg = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
      if (errMsg.includes("ZkLoginVerifyResult") || errMsg.includes("ZkLogin")) {
        // 1. Try direct GraphQL with the correct schema fields
        const gqlResult = await verifyZkLoginViaGraphql(
          message,
          signature,
          claimedAddress,
        );
        if (gqlResult !== null) return gqlResult;

        // 2. Try JSON-RPC fallback
        const rpcResult = await verifyZkLoginViaRpc(
          message,
          signature,
          claimedAddress,
        );
        if (rpcResult !== null) return rpcResult;
      }
      // Not a zkLogin issue or all fallbacks unavailable — propagate
      throw sdkErr;
    }
  } catch (err) {
    return {
      valid: false,
      address: "",
      error: err instanceof Error ? err.message : "Verification failed",
    };
  }
}

/**
 * Fallback 1: verify a zkLogin signature via a direct GraphQL call to the
 * Sui GraphQL endpoint with the correct schema fields.
 *
 * The `@mysten/sui` SDK's built-in query requests `error` (singular) on
 * `ZkLoginVerifyResult`, but the current schema uses `errors` (plural).
 * This function bypasses the SDK and issues the query directly.
 *
 * Returns an AuthResult on success/failure, or `null` if the GraphQL
 * endpoint is unavailable so the caller can fall through to JSON-RPC.
 */
async function verifyZkLoginViaGraphql(
  message: Uint8Array,
  signature: string,
  expectedAddress: string,
): Promise<AuthResult | null> {
  try {
    const graphqlUrl = DEFAULT_CONFIG.suiGraphqlUrl;
    const messageB64 = Buffer.from(message).toString("base64");

    const query = `
      query VerifyZkLogin($bytes: Base64!, $signature: Base64!, $intentScope: ZkLoginIntentScope!, $author: SuiAddress!) {
        verifyZkLoginSignature(bytes: $bytes, signature: $signature, intentScope: $intentScope, author: $author) {
          success
          errors
        }
      }
    `;

    const res = await fetch(graphqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: {
          bytes: messageB64,
          signature,
          intentScope: "PERSONAL_MESSAGE",
          author: expectedAddress,
        },
      }),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as {
      data?: {
        verifyZkLoginSignature?: { success: boolean; errors: string[] };
      };
      errors?: { message: string }[];
    };

    // GraphQL-level errors (schema mismatch, etc.) — fall through
    if (json.errors?.length) return null;

    const result = json.data?.verifyZkLoginSignature;
    if (!result) return null;

    if (result.success && result.errors.length === 0) {
      return { valid: true, address: expectedAddress };
    }

    const errText = result.errors.join("; ") || "zkLogin verification failed";
    return { valid: false, address: expectedAddress, error: errText };
  } catch {
    return null; // Network error — let caller fall through to RPC
  }
}

/**
 * Fallback 2: verify a zkLogin signature via the Sui JSON-RPC endpoint
 * `sui_verifyZkLoginSignature` (available since Feb 2025).
 *
 * Returns an AuthResult on success/failure, or `null` if the RPC endpoint
 * is not available (older node) so the caller can fall through.
 */
async function verifyZkLoginViaRpc(
  message: Uint8Array,
  signature: string,
  expectedAddress: string,
): Promise<AuthResult | null> {
  try {
    const rpcUrl = DEFAULT_CONFIG.suiRpcUrl;
    const messageB64 = Buffer.from(message).toString("base64");

    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sui_verifyZkLoginSignature",
        params: {
          bytes: messageB64,
          signature,
          intentScope: "PersonalMessage",
          author: expectedAddress,
        },
      }),
    });

    if (!res.ok) return null; // RPC not available

    const json = (await res.json()) as {
      result?: { success: boolean; errors?: string[] };
      error?: { message: string };
    };

    if (json.error) {
      // Method not found = older node without this endpoint
      if (json.error.message?.includes("not found")) return null;
      return { valid: false, address: expectedAddress, error: json.error.message };
    }

    if (json.result?.success) {
      return { valid: true, address: expectedAddress };
    }

    const errors = json.result?.errors?.join("; ") ?? "zkLogin verification failed";
    return { valid: false, address: expectedAddress, error: errors };
  } catch {
    return null; // Network error — let caller handle
  }
}
