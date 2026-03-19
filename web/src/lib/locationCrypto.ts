/**
 * Shadow Location Network — client-side cryptographic utilities.
 *
 * Runs entirely in the browser. The server never sees plaintext coordinates.
 *
 * Capabilities:
 *   - Poseidon hash commitment (location_hash)
 *   - AES-256-GCM encrypt/decrypt of location fields using the TLK
 *   - X25519 TLK unwrap (ECIES-style, matching server wrapTlk format)
 *   - Ed25519 → X25519 public key conversion for key distribution
 *   - Auth challenge construction for API requests
 */

// poseidon-lite is a transitive dep of @mysten/sui — tree-shakeable, ~50KB
import { poseidon4 } from "poseidon-lite/poseidon4";
import { x25519 } from "@noble/curves/ed25519";
import { edwardsToMontgomeryPub } from "@noble/curves/ed25519";

// ============================================================
// Types
// ============================================================

export interface LocationData {
  solarSystemId: number;
  x: number;
  y: number;
  z: number;
}

export interface LocationPodPayload {
  structureId: string;
  tribeId: string;
  locationHash: string;
  encryptedBlob: string; // base64
  nonce: string;         // base64
  signature: string;     // base64 SUI signature
  podVersion: number;
  tlkVersion: number;
}

// ============================================================
// Poseidon Commitment
// ============================================================

/**
 * Compute the Poseidon hash commitment for a location + salt.
 *
 * Poseidon4(x, y, z, salt) → bigint, hex-encoded as the location_hash.
 * This is ZK-friendly: the same hash works inside a circom SNARK in Phase 2.
 */
export function computeLocationHash(
  x: number,
  y: number,
  z: number,
  salt: bigint,
): string {
  const hash = poseidon4([BigInt(x), BigInt(y), BigInt(z), salt]);
  return "0x" + hash.toString(16).padStart(64, "0");
}

/** Generate a random 256-bit salt for the Poseidon commitment. */
export function generateSalt(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let result = 0n;
  for (const b of bytes) {
    result = (result << 8n) | BigInt(b);
  }
  return result;
}

// ============================================================
// AES-256-GCM Encrypt / Decrypt (Web Crypto API)
// ============================================================

/**
 * Encrypt location data with the tribe location key (TLK).
 * Returns { ciphertext, nonce } as Uint8Arrays.
 */
export async function encryptLocation(
  location: LocationData,
  salt: bigint,
  tlk: Uint8Array,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      solarSystemId: location.solarSystemId,
      x: location.x,
      y: location.y,
      z: location.z,
      salt: salt.toString(),
    }),
  );

  const key = await crypto.subtle.importKey(
    "raw",
    tlk.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as Uint8Array<ArrayBuffer> },
    key,
    plaintext as Uint8Array<ArrayBuffer>,
  );

  return {
    ciphertext: new Uint8Array(ciphertextBuf),
    nonce,
  };
}

/**
 * Decrypt location data using the tribe location key (TLK).
 */
export async function decryptLocation(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  tlk: Uint8Array,
): Promise<LocationData & { salt: string }> {
  const key = await crypto.subtle.importKey(
    "raw",
    tlk.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const plaintextBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce as Uint8Array<ArrayBuffer> },
    key,
    ciphertext as Uint8Array<ArrayBuffer>,
  );

  return JSON.parse(new TextDecoder().decode(plaintextBuf));
}

// ============================================================
// Signature-Derived X25519 Keypair
//
// Standard SUI wallets only expose signPersonalMessage — never
// the raw Ed25519 private key.  To derive a stable X25519 keypair
// that any wallet can reproduce:
//   1. Sign a fixed deterministic message via signPersonalMessage.
//   2. SHA-256 the full SUI signature blob → 32-byte seed.
//   3. Use the seed as an X25519 private key.
//
// Ed25519 signatures are deterministic (RFC 8032), so the same
// wallet always produces the same derived X25519 keypair.
// ============================================================

/** The fixed message signed by the wallet to derive the X25519 keypair. */
export const X25519_KEYGEN_MESSAGE = "frontier-corm:x25519-keygen:v1";

/** Encode the keygen message as bytes for signPersonalMessage. */
export function getKeygenMessageBytes(): Uint8Array {
  return new TextEncoder().encode(X25519_KEYGEN_MESSAGE);
}

/**
 * Derive an X25519 keypair from a wallet signature.
 *
 * @param signatureB64  The base64-encoded SUI signature returned by signPersonalMessage
 * @returns  X25519 public and private keys (32 bytes each)
 */
export async function deriveX25519Keypair(
  signatureB64: string,
): Promise<{ x25519Pub: Uint8Array; x25519Priv: Uint8Array }> {
  const sigBytes = base64ToBytes(signatureB64);
  const hash = await crypto.subtle.digest("SHA-256", sigBytes as Uint8Array<ArrayBuffer>);
  const x25519Priv = new Uint8Array(hash);
  const x25519Pub = x25519.getPublicKey(x25519Priv);
  return { x25519Pub, x25519Priv };
}

// ============================================================
// X25519 TLK Unwrap
//
// The server wraps TLKs as: ephPub(32) ‖ nonce(12) ‖ ciphertext(32) ‖ tag(16)
// We perform ECDH with our X25519 private key + ephemeral public key,
// derive a wrapping key, then AES-256-GCM decrypt the TLK.
// ============================================================

/**
 * Derive the X25519 wrapping key from a shared secret.
 * Must match the server's deriveWrappingKey() exactly.
 */
async function deriveWrappingKey(sharedSecret: Uint8Array): Promise<Uint8Array> {
  const info = new TextEncoder().encode("frontier-corm-tlk-wrap-v1");
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    info,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const prk = await crypto.subtle.sign("HMAC", hmacKey, sharedSecret as Uint8Array<ArrayBuffer>);
  return new Uint8Array(prk);
}

/**
 * Unwrap a TLK blob using the caller's X25519 private key.
 *
 * @param wrappedKeyB64    Base64-encoded wrapped key from the server
 * @param x25519PrivateKey  32-byte X25519 private key (e.g. from deriveX25519Keypair)
 * @returns  The raw 32-byte AES-256 TLK
 */
export async function unwrapTlk(
  wrappedKeyB64: string,
  x25519PrivateKey: Uint8Array,
): Promise<Uint8Array> {
  const wrapped = base64ToBytes(wrappedKeyB64);

  // Parse the packed format
  const ephPub = wrapped.slice(0, 32);
  const nonce = wrapped.slice(32, 44);
  const ciphertext = wrapped.slice(44, 76);
  const tag = wrapped.slice(76, 92);

  // X25519 shared secret
  const shared = x25519.getSharedSecret(x25519PrivateKey, ephPub);
  const wrappingKey = await deriveWrappingKey(shared);

  // AES-256-GCM decrypt — Web Crypto expects ciphertext ‖ tag concatenated
  const key = await crypto.subtle.importKey(
    "raw",
    wrappingKey.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);

  const tlkBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce as Uint8Array<ArrayBuffer> },
    key,
    combined as Uint8Array<ArrayBuffer>,
  );

  return new Uint8Array(tlkBuf);
}

// ============================================================
// X25519 TLK Wrap (client-side, for adding new tribe members)
//
// Mirrors the server's wrapTlk format: ephPub(32) ‖ nonce(12) ‖ ciphertext(32) ‖ tag(16)
// An existing member unwraps their TLK, then wraps it to a new
// member's X25519 public key using this function.
// ============================================================

/**
 * Wrap a plaintext TLK for a specific member's X25519 public key.
 *
 * This is the client-side counterpart of the server's wrapTlk().
 * The output format is identical: ephPub(32) ‖ nonce(12) ‖ ciphertext(32) ‖ tag(16) = 92 bytes.
 *
 * @param tlk             Raw 32-byte AES key (unwrapped from the caller's own wrapped TLK)
 * @param memberX25519Pub Target member's X25519 public key (32 bytes)
 * @returns               Base64-encoded wrapped key blob
 */
export async function wrapTlk(
  tlk: Uint8Array,
  memberX25519Pub: Uint8Array,
): Promise<string> {
  // Generate ephemeral X25519 keypair
  const ephPriv = x25519.utils.randomPrivateKey();
  const ephPub = x25519.getPublicKey(ephPriv);

  // ECDH → shared secret
  const shared = x25519.getSharedSecret(ephPriv, memberX25519Pub);
  const wrappingKey = await deriveWrappingKey(shared);

  // AES-256-GCM encrypt the TLK
  const key = await crypto.subtle.importKey(
    "raw",
    wrappingKey.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as Uint8Array<ArrayBuffer> },
    key,
    tlk as Uint8Array<ArrayBuffer>,
  );

  // Web Crypto returns ciphertext ‖ tag (16 bytes) concatenated
  const ctBuf = new Uint8Array(ciphertextWithTag);
  const ciphertext = ctBuf.slice(0, ctBuf.length - 16);
  const tag = ctBuf.slice(ctBuf.length - 16);

  // Pack: ephPub(32) + nonce(12) + ciphertext(32) + tag(16) = 92 bytes
  const packed = new Uint8Array(32 + 12 + ciphertext.length + 16);
  packed.set(ephPub, 0);
  packed.set(nonce, 32);
  packed.set(ciphertext, 44);
  packed.set(tag, 44 + ciphertext.length);

  return bytesToBase64(packed);
}

// ============================================================
// Ed25519 → X25519 Public Key Conversion
// ============================================================

/**
 * Convert an Ed25519 public key to X25519 (Montgomery form).
 * Used to derive the encryption key for TLK wrapping.
 */
export function ed25519PubToX25519(ed25519Pub: Uint8Array): Uint8Array {
  return edwardsToMontgomeryPub(ed25519Pub);
}

// ============================================================
// Auth Challenge
// ============================================================

/**
 * Build an authentication challenge string for the Location API.
 * Format: "frontier-corm:<address>:<timestamp_ms>"
 */
export function buildAuthChallenge(address: string): Uint8Array {
  const text = `frontier-corm:${address}:${Date.now()}`;
  return new TextEncoder().encode(text);
}

/**
 * Build the SuiSig Authorization header value from a signed challenge.
 */
export function buildAuthHeader(
  challengeBytes: Uint8Array,
  signature: string,
): string {
  const messageB64 = bytesToBase64(challengeBytes);
  return `SuiSig ${messageB64}.${signature}`;
}

// ============================================================
// Base64 Helpers
// ============================================================

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
