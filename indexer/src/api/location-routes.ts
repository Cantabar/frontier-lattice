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
  upsertMemberPublicKey,
  getMembersWithoutTlk,
  upsertLocationPodWithNode,
  getDerivedPodsByNetworkNode,
  deleteStaleDerivedPods,
  getFilterProofsForStructure,
  getLocationTagsByStructure,
} from "../db/location-queries.js";
import { getConnectedAssemblies } from "../location/sui-rpc.js";

// ================================================================
// Solo mode helpers
// ================================================================

const SOLO_PREFIX = "solo:";

/** Check whether a tribeId represents a solo (personal) namespace. */
export function isSoloTribeId(tribeId: string): boolean {
  return tribeId.startsWith(SOLO_PREFIX);
}

/** Extract the wallet address from a solo tribeId. Returns null if not a solo ID. */
export function parseSoloAddress(tribeId: string): string | null {
  if (!isSoloTribeId(tribeId)) return null;
  return tribeId.slice(SOLO_PREFIX.length);
}

/** Build the synthetic solo tribeId for a given wallet address. */
export function buildSoloTribeId(address: string): string {
  return `${SOLO_PREFIX}${address}`;
}

/**
 * Enforce that the authenticated address owns the solo namespace.
 * Returns true if the check passes, false if a 403 was sent.
 */
function enforceSoloOwnership(
  tribeId: string,
  authenticatedAddress: string,
  res: Response,
): boolean {
  if (!isSoloTribeId(tribeId)) return true; // not a solo namespace — no enforcement
  const ownerAddress = parseSoloAddress(tribeId);
  if (ownerAddress?.toLowerCase() !== authenticatedAddress.toLowerCase()) {
    res.status(403).json({ error: "You can only access your own solo location namespace" });
    return false;
  }
  return true;
}

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

    // Solo namespace: only the owner can submit PODs
    if (!enforceSoloOwnership(tribeId, address, res)) return;

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
  // GET /tribe/:tribeId — List all PODs for a tribe (or solo namespace)
  // ================================================================
  router.get("/tribe/:tribeId", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const tribeId = req.params.tribeId as string;

    // Solo namespace: only the owner can read
    if (!enforceSoloOwnership(tribeId, address, res)) return;

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

    // Solo namespace: only the owner can read
    if (!enforceSoloOwnership(tribeId, address, res)) return;

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
  // GET /pod/:structureId/proof — Shareable proof bundle for a POD
  //
  // Returns the public (non-encrypted) POD metadata, any associated
  // ZK filter proofs, and location tags. Owner-only — the proof bundle
  // is intended to be copied and shared with external applications.
  // ================================================================
  router.get("/pod/:structureId/proof", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const structureId = req.params.structureId as string;
    const tribeId = req.query.tribeId as string;
    if (!tribeId) {
      res.status(400).json({ error: "tribeId query param required" });
      return;
    }

    // Solo namespace: only the owner can read
    if (!enforceSoloOwnership(tribeId, address, res)) return;

    try {
      const pod = await getLocationPod(pool, structureId, tribeId);
      if (!pod) {
        res.status(404).json({ error: "POD not found" });
        return;
      }

      if (pod.owner_address.toLowerCase() !== address.toLowerCase()) {
        res.status(403).json({ error: "Only the POD owner can export a proof bundle" });
        return;
      }

      // Fetch associated ZK proofs and public tags
      const [filterProofs, locationTags] = await Promise.all([
        getFilterProofsForStructure(pool, structureId, tribeId),
        getLocationTagsByStructure(pool, structureId),
      ]);

      res.json({
        structure_id: pod.structure_id,
        owner_address: pod.owner_address,
        tribe_id: pod.tribe_id,
        location_hash: pod.location_hash,
        signature: pod.signature,
        pod_version: pod.pod_version,
        tlk_version: pod.tlk_version,
        created_at: pod.created_at,
        updated_at: pod.updated_at,
        zk_proofs: filterProofs.map((fp) => ({
          filter_type: fp.filter_type,
          filter_key: fp.filter_key,
          public_signals: fp.public_signals,
          proof_json: fp.proof_json,
          verified_at: fp.verified_at,
        })),
        location_tags: locationTags.map((t) => ({
          tag_type: t.tag_type,
          tag_id: t.tag_id,
          location_hash: t.location_hash,
          verified_at: t.verified_at,
        })),
      });
    } catch (err) {
      console.error("[locations] Failed to build proof bundle:", err);
      res.status(500).json({ error: "Failed to build proof bundle" });
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
  // GET /keys/:tribeId/status — Check TLK initialisation state for a tribe or solo namespace
  //
  // Returns whether a TLK has been initialised for the tribe and whether
  // the calling member has a wrapped copy. Does NOT return key material.
  // ================================================================
  router.get("/keys/:tribeId/status", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const tribeId = req.params.tribeId as string;

    // Solo namespace: only the owner can check status
    if (!enforceSoloOwnership(tribeId, address, res)) return;

    try {
      const latestVersion = await getLatestTlkVersion(pool, tribeId);
      const initialized = latestVersion > 0;
      let hasWrappedKey = false;

      if (initialized) {
        const memberTlk = await getTlkForMember(pool, tribeId, address);
        hasWrappedKey = !!memberTlk;
      }

      res.json({
        tribe_id: tribeId,
        initialized,
        tlk_version: latestVersion,
        has_wrapped_key: hasWrappedKey,
      });
    } catch (err) {
      console.error("[locations] Failed to fetch TLK status:", err);
      res.status(500).json({ error: "Failed to fetch TLK status" });
    }
  });

  // ================================================================
  // GET /keys/:tribeId — Fetch the caller's wrapped TLK
  // ================================================================
  router.get("/keys/:tribeId", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const tribeId = req.params.tribeId as string;

    // Solo namespace: only the owner can fetch their key
    if (!enforceSoloOwnership(tribeId, address, res)) return;

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

  // ================================================================
  // POST /keys/register — Register caller's X25519 public key for TLK distribution
  //
  // Body: { tribeId, x25519Pub (base64) }
  //
  // Members call this on page load so that existing TLK holders can
  // wrap the key for them.
  // ================================================================
  router.post("/keys/register", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const { tribeId, x25519Pub } = req.body as {
      tribeId: string;
      x25519Pub: string; // base64-encoded 32-byte X25519 public key
    };

    if (!tribeId || !x25519Pub) {
      res.status(400).json({ error: "tribeId and x25519Pub required" });
      return;
    }

    try {
      const pubBuf = Buffer.from(x25519Pub, "base64");
      if (pubBuf.length !== 32) {
        res.status(400).json({ error: "Invalid X25519 public key length — expected 32 bytes" });
        return;
      }

      await upsertMemberPublicKey(pool, tribeId, address, pubBuf);
      res.json({ tribe_id: tribeId, member: address, registered: true });
    } catch (err) {
      console.error("[locations] Failed to register public key:", err);
      res.status(500).json({ error: "Failed to register public key" });
    }
  });

  // ================================================================
  // GET /keys/pending/:tribeId — List members who need a wrapped TLK
  //
  // Returns members who have registered an X25519 public key but do
  // not yet have a wrapped TLK at the current version.
  // ================================================================
  router.get("/keys/pending/:tribeId", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const tribeId = req.params.tribeId as string;

    try {
      const pending = await getMembersWithoutTlk(pool, tribeId);
      res.json({
        tribe_id: tribeId,
        count: pending.length,
        members: pending.map((m) => ({
          address: m.member_address,
          x25519Pub: m.x25519_pub.toString("base64"),
          registeredAt: m.registered_at,
        })),
      });
    } catch (err) {
      console.error("[locations] Failed to fetch pending members:", err);
      res.status(500).json({ error: "Failed to fetch pending members" });
    }
  });

  // ================================================================
  // POST /network-node-pod — Register a Network Node's location
  //
  // Creates a primary POD for the Network Node, then derives PODs
  // for every structure connected to that node (same location data).
  // ================================================================
  router.post("/network-node-pod", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const {
      networkNodeId,
      tribeId,
      locationHash,
      encryptedBlob,
      nonce,
      signature,
      podVersion,
      tlkVersion,
    } = req.body;

    if (
      !networkNodeId ||
      !tribeId ||
      !locationHash ||
      !encryptedBlob ||
      !nonce ||
      !signature
    ) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // Solo namespace: only the owner can register
    if (!enforceSoloOwnership(tribeId, address, res)) return;

    try {
      const blobBuf = Buffer.from(encryptedBlob, "base64");
      const nonceBuf = Buffer.from(nonce, "base64");
      const ver = podVersion ?? 1;
      const tlkVer = tlkVersion ?? 1;

      // 1. Upsert primary POD for the Network Node itself
      await upsertLocationPodWithNode(pool, {
        structureId: networkNodeId,
        ownerAddress: address,
        tribeId,
        locationHash,
        encryptedBlob: blobBuf,
        nonce: nonceBuf,
        signature,
        podVersion: ver,
        tlkVersion: tlkVer,
        networkNodeId: null, // primary — not derived
      });

      // 2. Resolve connected assemblies from on-chain
      let connectedIds: string[];
      try {
        connectedIds = await getConnectedAssemblies(networkNodeId);
      } catch (err) {
        console.warn(
          `[locations] Could not fetch connected assemblies for ${networkNodeId}:`,
          err,
        );
        connectedIds = [];
      }

      // 3. Upsert derived PODs for each connected structure
      for (const assemblyId of connectedIds) {
        await upsertLocationPodWithNode(pool, {
          structureId: assemblyId,
          ownerAddress: address,
          tribeId,
          locationHash,
          encryptedBlob: blobBuf,
          nonce: nonceBuf,
          signature,
          podVersion: ver,
          tlkVersion: tlkVer,
          networkNodeId,
        });
      }

      // 4. Clean up stale derived PODs (structures that disconnected)
      await deleteStaleDerivedPods(pool, networkNodeId, tribeId, connectedIds);

      res.json({
        networkNodeId,
        tribeId,
        structureCount: connectedIds.length,
      });
    } catch (err) {
      console.error("[locations] Failed to register Network Node POD:", err);
      res.status(500).json({ error: "Failed to register Network Node location" });
    }
  });

  // ================================================================
  // POST /network-node-pod/refresh — Re-derive PODs for a Network Node
  //
  // Fetches current connected_assembly_ids, copies the node's POD to
  // any new structures, and removes stale derived PODs.
  // ================================================================
  router.post("/network-node-pod/refresh", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const { networkNodeId, tribeId } = req.body;
    if (!networkNodeId || !tribeId) {
      res.status(400).json({ error: "networkNodeId and tribeId required" });
      return;
    }

    // Solo namespace: only the owner can refresh
    if (!enforceSoloOwnership(tribeId, address, res)) return;

    try {
      // 1. Fetch the primary (Network Node) POD
      const nodePod = await getLocationPod(pool, networkNodeId, tribeId);
      if (!nodePod) {
        res.status(404).json({
          error: "No location POD found for this Network Node and tribe",
        });
        return;
      }

      // 2. Resolve current connected assemblies
      let connectedIds: string[];
      try {
        connectedIds = await getConnectedAssemblies(networkNodeId);
      } catch (err) {
        console.warn(
          `[locations] Could not fetch connected assemblies for ${networkNodeId}:`,
          err,
        );
        connectedIds = [];
      }

      // 3. Upsert derived PODs
      for (const assemblyId of connectedIds) {
        await upsertLocationPodWithNode(pool, {
          structureId: assemblyId,
          ownerAddress: nodePod.owner_address,
          tribeId,
          locationHash: nodePod.location_hash,
          encryptedBlob: nodePod.encrypted_blob,
          nonce: nodePod.nonce,
          signature: nodePod.signature,
          podVersion: nodePod.pod_version,
          tlkVersion: nodePod.tlk_version,
          networkNodeId,
        });
      }

      // 4. Delete stale derived PODs
      const deleted = await deleteStaleDerivedPods(
        pool,
        networkNodeId,
        tribeId,
        connectedIds,
      );

      res.json({
        networkNodeId,
        tribeId,
        structureCount: connectedIds.length,
        staleRemoved: deleted,
      });
    } catch (err) {
      console.error("[locations] Failed to refresh Network Node PODs:", err);
      res.status(500).json({ error: "Failed to refresh Network Node location" });
    }
  });

  // ================================================================
  // POST /keys/solo-init — Initialize a Personal Location Key (PLK)
  //
  // Body: { x25519Pub (base64) }
  //
  // Generates a PLK (functionally identical to a TLK) and wraps it
  // only to the caller. The synthetic tribeId is `solo:<address>`.
  // ================================================================
  router.post("/keys/solo-init", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const { x25519Pub } = req.body as { x25519Pub: string };

    if (!x25519Pub) {
      res.status(400).json({ error: "x25519Pub required" });
      return;
    }

    const soloTribeId = buildSoloTribeId(address);

    try {
      // Check if PLK already exists
      const existingVersion = await getLatestTlkVersion(pool, soloTribeId);
      if (existingVersion > 0) {
        res.status(409).json({ error: "Personal Location Key already initialised", tlk_version: existingVersion });
        return;
      }

      const pubBuf = Buffer.from(x25519Pub, "base64");
      if (pubBuf.length !== 32) {
        res.status(400).json({ error: "Invalid X25519 public key length — expected 32 bytes" });
        return;
      }

      const tlk = generateTlk();
      const wrapped = wrapTlk(tlk, pubBuf);
      await upsertTlk(pool, soloTribeId, address, wrapped, 1);

      // Also register the public key for consistency
      await upsertMemberPublicKey(pool, soloTribeId, address, pubBuf);

      res.json({ tribe_id: soloTribeId, tlk_version: 1, solo: true });
    } catch (err) {
      console.error("[locations] Failed to init solo PLK:", err);
      res.status(500).json({ error: "Failed to initialise Personal Location Key" });
    }
  });

  // ================================================================
  // GET /solo — List the caller's solo location PODs
  //
  // Convenience endpoint — equivalent to GET /tribe/solo:<address>
  // but the caller doesn't need to construct the synthetic tribeId.
  // ================================================================
  router.get("/solo", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const soloTribeId = buildSoloTribeId(address);

    try {
      const pods = await getLocationPodsByTribe(pool, soloTribeId);
      res.json({
        pods: pods.map(serialisePod),
        tribe_id: soloTribeId,
        count: pods.length,
        solo: true,
      });
    } catch (err) {
      console.error("[locations] Failed to list solo PODs:", err);
      res.status(500).json({ error: "Failed to fetch solo PODs" });
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
