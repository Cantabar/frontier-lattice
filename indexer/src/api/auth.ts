/**
 * Shared authentication helper for Location API routes.
 *
 * Supports three auth schemes:
 *   - `SuiSig <base64_message>.<base64_signature>` — wallet personal-message signature
 *   - `TxSig <base64_challenge>.<base64_tx_bytes>.<base64_signature>` — wallet transaction signature
 *   - `Bearer <token>` — session token (obtained via POST /session)
 *
 * TxSig exists as a fallback for wallets (e.g. EveVault) whose
 * signPersonalMessage implementation is broken or unavailable.
 * Every Sui wallet must support signTransaction, making TxSig
 * universally compatible.
 *
 * Both location-routes and zk-routes import this instead of duplicating the logic.
 */

import type { Request, Response } from "express";
import type pg from "pg";
import { verifyWalletAuth, verifyTxAuth } from "../location/crypto.js";
import { validateSession } from "../location/session.js";

/**
 * Extract and verify the caller's wallet address from the Authorization header.
 *
 * On success returns the verified address string.
 * On failure sends a 401 JSON response and returns `null`.
 */
export async function authenticate(
  req: Request,
  res: Response,
  pool: pg.Pool,
): Promise<string | null> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: "Missing authorization header" });
    return null;
  }

  // ---- Bearer token (session) ----
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (!token) {
      res.status(401).json({ error: "Empty Bearer token" });
      return null;
    }

    const address = await validateSession(pool, token);
    if (!address) {
      res.status(401).json({ error: "Invalid or expired session token" });
      return null;
    }

    return address;
  }

  // ---- SuiSig (wallet signature) ----
  if (authHeader.startsWith("SuiSig ")) {
    const payload = authHeader.slice(7); // strip "SuiSig "
    const dotIdx = payload.indexOf(".");
    if (dotIdx === -1) {
      res.status(401).json({ error: "Malformed SuiSig token" });
      return null;
    }

    const messageB64 = payload.slice(0, dotIdx);
    const signature = payload.slice(dotIdx + 1);
    const message = Buffer.from(messageB64, "base64");

    const result = await verifyWalletAuth(message, signature);
    if (!result.valid) {
      res.status(401).json({ error: result.error ?? "Signature verification failed" });
      return null;
    }

    return result.address;
  }

  // ---- TxSig (transaction signature) ----
  if (authHeader.startsWith("TxSig ")) {
    const payload = authHeader.slice(6); // strip "TxSig "
    const parts = payload.split(".");
    if (parts.length !== 3) {
      res.status(401).json({ error: "Malformed TxSig token — expected challenge.txBytes.signature" });
      return null;
    }

    const [challengeB64, txBytesB64, signature] = parts;
    const challenge = Buffer.from(challengeB64, "base64");
    const txBytes = Buffer.from(txBytesB64, "base64");

    const result = await verifyTxAuth(challenge, txBytes, signature);
    if (!result.valid) {
      res.status(401).json({ error: result.error ?? "TxSig verification failed" });
      return null;
    }

    return result.address;
  }

  res.status(401).json({ error: "Unsupported authorization scheme — use SuiSig, TxSig, or Bearer" });
  return null;
}
