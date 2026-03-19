/**
 * Shadow Location Network — API routes for location PODs and tribe key management.
 *
 * All mutation endpoints require a wallet signature challenge for authentication.
 * Read endpoints require tribe membership proof (signed challenge).
 *
 * Mount under /api/v1/locations in the main Express server.
 */

import { Router, type Request, type Response } from "express";
import type pg from "pg";
import { verifyWalletAuth, generateTlk, wrapTlk } from "../location/crypto.js";
// Note: wrapTlk is still used by /keys/init and /keys/rotate (server-generated TLK).
// The /keys/wrap endpoint now accepts client-produced wrapped blobs instead.
import {
  upsertLocationPod,
  getLocationPodsByTribe,
  getLocationPod,
  deleteLocationPod,
  getTlkForMember,
  getLatestTlkVersion,
  upsertTlk,
} from "../db/location-queries.js";

export function createLocationRouter(pool: pg.Pool): Router {
  const router = Router();

  // ================================================================
  // Auth middleware helper — extracts and verifies wallet signature
  // from Authorization header: "SuiSig <base64_message>.<base64_signature>"
  // ================================================================
  async function authenticate(req: Request, res: Response): Promise<string | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("SuiSig ")) {
      res.status(401).json({ error: "Missing SuiSig authorization header" });
      return null;
    }

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

  // ================================================================
  // POST /pod — Submit or update a signed location POD
  // ================================================================
  router.post("/pod", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const {
      structureId,
      tribeId,
      locationHash,
      encryptedBlob,
      nonce,
      signature,
      podVersion,
      tlkVersion,
    } = req.body;

    if (!structureId || !tribeId || !locationHash || !encryptedBlob || !nonce || !signature) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    try {
      const id = await upsertLocationPod(pool, {
        structureId,
        ownerAddress: address,
        tribeId,
        locationHash,
        encryptedBlob: Buffer.from(encryptedBlob, "base64"),
        nonce: Buffer.from(nonce, "base64"),
        signature,
        podVersion: podVersion ?? 1,
        tlkVersion: tlkVersion ?? 1,
      });

      res.json({ id, structureId, tribeId });
    } catch (err) {
      console.error("[locations] Failed to upsert POD:", err);
      res.status(500).json({ error: "Failed to store POD" });
    }
  });

  // ================================================================
  // GET /tribe/:tribeId — List all PODs for a tribe
  // ================================================================
  router.get("/tribe/:tribeId", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const tribeId = req.params.tribeId as string;

    try {
      const pods = await getLocationPodsByTribe(pool, tribeId);
      res.json({
        pods: pods.map(serialisePod),
        tribe_id: tribeId,
        count: pods.length,
      });
    } catch (err) {
      console.error("[locations] Failed to list PODs:", err);
      res.status(500).json({ error: "Failed to fetch PODs" });
    }
  });

  // ================================================================
  // GET /pod/:structureId — Fetch a single POD
  // ================================================================
  router.get("/pod/:structureId", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const structureId = req.params.structureId as string;
    const tribeId = req.query.tribeId as string;
    if (!tribeId) {
      res.status(400).json({ error: "tribeId query param required" });
      return;
    }

    try {
      const pod = await getLocationPod(pool, structureId, tribeId);
      if (!pod) {
        res.status(404).json({ error: "POD not found" });
        return;
      }
      res.json(serialisePod(pod));
    } catch (err) {
      console.error("[locations] Failed to fetch POD:", err);
      res.status(500).json({ error: "Failed to fetch POD" });
    }
  });

  // ================================================================
  // DELETE /pod/:structureId — Revoke a POD (owner only)
  // ================================================================
  router.delete("/pod/:structureId", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const structureId = req.params.structureId as string;

    try {
      const deleted = await deleteLocationPod(pool, structureId, address);
      if (!deleted) {
        res.status(404).json({ error: "POD not found or not owned by caller" });
        return;
      }
      res.json({ deleted: true, structureId });
    } catch (err) {
      console.error("[locations] Failed to delete POD:", err);
      res.status(500).json({ error: "Failed to delete POD" });
    }
  });

  // ================================================================
  // GET /keys/:tribeId — Fetch the caller's wrapped TLK
  // ================================================================
  router.get("/keys/:tribeId", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const tribeId = req.params.tribeId as string;

    try {
      const tlk = await getTlkForMember(pool, tribeId, address);
      if (!tlk) {
        res.status(404).json({ error: "No TLK found — tribe may not have location sharing enabled" });
        return;
      }

      res.json({
        tribe_id: tribeId,
        tlk_version: tlk.tlk_version,
        wrapped_key: tlk.wrapped_key.toString("base64"),
      });
    } catch (err) {
      console.error("[locations] Failed to fetch TLK:", err);
      res.status(500).json({ error: "Failed to fetch TLK" });
    }
  });

  // ================================================================
  // POST /keys/init — Initialise TLK for a tribe (first member to enable location sharing)
  //
  // Body: { tribeId, memberPublicKeys: [{ address, x25519Pub }] }
  //
  // Generates a new TLK and wraps it to all provided member public keys.
  // ================================================================
  router.post("/keys/init", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const { tribeId, memberPublicKeys } = req.body as {
      tribeId: string;
      memberPublicKeys: { address: string; x25519Pub: string }[];
    };

    if (!tribeId || !memberPublicKeys?.length) {
      res.status(400).json({ error: "tribeId and memberPublicKeys required" });
      return;
    }

    try {
      // Check if TLK already exists
      const existingVersion = await getLatestTlkVersion(pool, tribeId);
      if (existingVersion > 0) {
        res.status(409).json({ error: "TLK already initialised for this tribe", tlk_version: existingVersion });
        return;
      }

      const tlk = generateTlk();
      const newVersion = 1;

      for (const member of memberPublicKeys) {
        const x25519Pub = Buffer.from(member.x25519Pub, "base64");
        const wrapped = wrapTlk(tlk, x25519Pub);
        await upsertTlk(pool, tribeId, member.address, wrapped, newVersion);
      }

      res.json({ tribe_id: tribeId, tlk_version: newVersion, members_wrapped: memberPublicKeys.length });
    } catch (err) {
      console.error("[locations] Failed to init TLK:", err);
      res.status(500).json({ error: "Failed to initialise TLK" });
    }
  });

  // ================================================================
  // POST /keys/wrap — Store a client-wrapped TLK for a new member
  //
  // Body: { tribeId, newMemberAddress, wrappedKey }
  //
  // An existing member unwraps their own TLK client-side, wraps it
  // to the new member's X25519 public key, and submits the wrapped
  // blob here. The server never sees the plaintext TLK.
  // ================================================================
  router.post("/keys/wrap", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const { tribeId, newMemberAddress, wrappedKey } = req.body as {
      tribeId: string;
      newMemberAddress: string;
      wrappedKey: string; // base64-encoded wrapped TLK blob (92 bytes)
    };

    if (!tribeId || !newMemberAddress || !wrappedKey) {
      res.status(400).json({ error: "tribeId, newMemberAddress, and wrappedKey required" });
      return;
    }

    try {
      // Verify caller has a TLK (i.e., is an existing location-sharing member)
      const callerTlk = await getTlkForMember(pool, tribeId, address);
      if (!callerTlk) {
        res.status(403).json({ error: "Caller is not a location-sharing member of this tribe" });
        return;
      }

      // Store the client-produced wrapped blob at the current TLK version
      const wrappedBuf = Buffer.from(wrappedKey, "base64");
      if (wrappedBuf.length !== 92) {
        res.status(400).json({ error: "Invalid wrapped key length — expected 92 bytes" });
        return;
      }

      await upsertTlk(pool, tribeId, newMemberAddress, wrappedBuf, callerTlk.tlk_version);

      res.json({
        tribe_id: tribeId,
        tlk_version: callerTlk.tlk_version,
        member: newMemberAddress,
      });
    } catch (err) {
      console.error("[locations] Failed to store wrapped TLK for new member:", err);
      res.status(500).json({ error: "Failed to store wrapped TLK" });
    }
  });

  // ================================================================
  // POST /keys/rotate — Rotate TLK (officer+ only)
  //
  // Body: { tribeId, memberPublicKeys: [{ address, x25519Pub }] }
  //
  // Generates a new TLK, wraps to all current members, increments version.
  // Existing PODs remain readable with old TLK; owners re-encrypt on next login.
  // ================================================================
  router.post("/keys/rotate", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const { tribeId, memberPublicKeys } = req.body as {
      tribeId: string;
      memberPublicKeys: { address: string; x25519Pub: string }[];
    };

    if (!tribeId || !memberPublicKeys?.length) {
      res.status(400).json({ error: "tribeId and memberPublicKeys required" });
      return;
    }

    try {
      const latestVersion = await getLatestTlkVersion(pool, tribeId);
      const newVersion = latestVersion + 1;
      const tlk = generateTlk();

      for (const member of memberPublicKeys) {
        const x25519Pub = Buffer.from(member.x25519Pub, "base64");
        const wrapped = wrapTlk(tlk, x25519Pub);
        await upsertTlk(pool, tribeId, member.address, wrapped, newVersion);
      }

      res.json({
        tribe_id: tribeId,
        tlk_version: newVersion,
        members_wrapped: memberPublicKeys.length,
      });
    } catch (err) {
      console.error("[locations] Failed to rotate TLK:", err);
      res.status(500).json({ error: "Failed to rotate TLK" });
    }
  });

  return router;
}

// ============================================================
// Helpers
// ============================================================

/** Serialise a LocationPodRow for JSON response (Buffer → base64). */
function serialisePod(pod: {
  id: number;
  structure_id: string;
  owner_address: string;
  tribe_id: string;
  location_hash: string;
  encrypted_blob: Buffer;
  nonce: Buffer;
  signature: string;
  pod_version: number;
  tlk_version: number;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: pod.id,
    structure_id: pod.structure_id,
    owner_address: pod.owner_address,
    tribe_id: pod.tribe_id,
    location_hash: pod.location_hash,
    encrypted_blob: pod.encrypted_blob.toString("base64"),
    nonce: pod.nonce.toString("base64"),
    signature: pod.signature,
    pod_version: pod.pod_version,
    tlk_version: pod.tlk_version,
    created_at: pod.created_at,
    updated_at: pod.updated_at,
  };
}
