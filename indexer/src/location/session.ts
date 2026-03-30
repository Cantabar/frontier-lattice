/**
 * Shadow Location Network — session token management.
 *
 * After a one-time wallet signature verification, the server issues an
 * opaque session token. Subsequent API calls send `Bearer <token>` instead
 * of re-signing.
 *
 * Tokens are random 32-byte hex strings. Only the SHA-256 hash is persisted
 * so a database leak does not expose valid tokens.
 */

import { randomBytes, createHash } from "node:crypto";
import type pg from "pg";

// ============================================================
// Constants
// ============================================================

/** Session lifetime in milliseconds (1 hour). */
const SESSION_TTL_MS = 60 * 60 * 1000;

/**
 * Probability (0–1) that a validation call triggers lazy cleanup of
 * expired sessions. Keeps the table tidy without a dedicated cron.
 */
const CLEANUP_PROBABILITY = 0.05;

// ============================================================
// Helpers
// ============================================================

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ============================================================
// Public API
// ============================================================

export interface SessionResult {
  token: string;
  expiresAt: string; // ISO 8601
}

/**
 * Create a new session for the given wallet address.
 *
 * @returns The raw token (to be sent to the client) and its expiry.
 */
export async function createSession(
  pool: pg.Pool,
  address: string,
): Promise<SessionResult> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await pool.query(
    `INSERT INTO location_sessions (token_hash, address, expires_at)
     VALUES ($1, $2, $3)`,
    [tokenHash, address, expiresAt.toISOString()],
  );

  return { token, expiresAt: expiresAt.toISOString() };
}

/**
 * Validate a session token.
 *
 * @returns The wallet address if valid, or `null` if expired / not found.
 */
export async function validateSession(
  pool: pg.Pool,
  token: string,
): Promise<string | null> {
  const tokenHash = hashToken(token);

  const { rows } = await pool.query<{ address: string; expires_at: Date }>(
    `SELECT address, expires_at FROM location_sessions
     WHERE token_hash = $1`,
    [tokenHash],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  if (new Date(row.expires_at) < new Date()) {
    // Expired — delete and return null
    await pool.query(
      `DELETE FROM location_sessions WHERE token_hash = $1`,
      [tokenHash],
    );
    return null;
  }

  // Lazy cleanup of other expired sessions
  if (Math.random() < CLEANUP_PROBABILITY) {
    pool.query(`DELETE FROM location_sessions WHERE expires_at < NOW()`).catch(() => {
      // Non-critical — swallow errors
    });
  }

  return row.address;
}
