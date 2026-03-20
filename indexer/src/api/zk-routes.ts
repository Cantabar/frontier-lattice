/**
 * Shadow Location Network — ZK proof API routes.
 *
 * Endpoints:
 *   POST /submit      Submit a Groth16 proof for a structure × filter.
 *   GET  /region      Query PODs with verified region-filter proofs.
 *   GET  /proximity   Query PODs with verified proximity-filter proofs.
 *   GET  /tags        Public (no auth) query for structure location tags.
 *
 * Mount under /api/v1/locations/proofs in the main Express server.
 */

import { Router, type Request, type Response } from "express";
import type pg from "pg";
import { verifyWalletAuth } from "../location/crypto.js";
import {
  verifyFilterProof,
  buildFilterKey,
} from "../location/zk-verifier.js";
import {
  upsertFilterProof,
  getFilterProofsByKey,
  getLocationPod,
  getDerivedPodsByNetworkNode,
  upsertDerivedFilterProof,
  upsertLocationTag,
  getLocationTagsByStructure,
  getStructuresByTag,
} from "../db/location-queries.js";
import {
  getRegionBounds,
  getConstellationBounds,
  getRegion,
  getConstellation,
  boundsToFieldStrings,
} from "../location/region-data.js";

export function createZkRouter(pool: pg.Pool): Router {
  const router = Router();

  // ---- Auth (same helper as location-routes) ----
  async function authenticate(req: Request, res: Response): Promise<string | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("SuiSig ")) {
      res.status(401).json({ error: "Missing SuiSig authorization header" });
      return null;
    }

    const payload = authHeader.slice(7);
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
  // POST /submit — Submit a Groth16 proof for a structure × filter
  //
  // Body: {
  //   structureId, tribeId, filterType, publicSignals, proof,
  //   regionId?, constellationId?   ← optional: named region/constellation
  // }
  //
  // When regionId or constellationId is provided, the server validates
  // the proof's public signals match the canonical bounding box for that
  // game region/constellation, and stores a public location tag.
  // ================================================================
  router.post("/submit", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const {
      structureId,
      tribeId,
      filterType,
      publicSignals,
      proof,
      regionId,
      constellationId,
    } = req.body as {
      structureId: string;
      tribeId: string;
      filterType: "region" | "proximity";
      publicSignals: string[];
      proof: Record<string, unknown>;
      regionId?: number;
      constellationId?: number;
    };

    if (
      !structureId ||
      !tribeId ||
      !filterType ||
      !publicSignals?.length ||
      !proof
    ) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    if (filterType !== "region" && filterType !== "proximity") {
      res.status(400).json({ error: "filterType must be 'region' or 'proximity'" });
      return;
    }

    try {
      // 1. Verify the proof cryptographically
      const verifyResult = await verifyFilterProof(filterType, publicSignals, proof);
      if (!verifyResult.valid) {
        res.status(422).json({
          error: "Proof verification failed",
          detail: verifyResult.error,
        });
        return;
      }

      // 2. Confirm the POD exists for this structure × tribe
      const pod = await getLocationPod(pool, structureId, tribeId);
      if (!pod) {
        res.status(404).json({ error: "No location POD found for this structure and tribe" });
        return;
      }

      // 3. Verify the proof's location_hash matches the POD
      // publicSignals[0] is always location_hash
      const proofLocationHash = publicSignals[0];
      if (!proofLocationHash) {
        res.status(400).json({ error: "publicSignals[0] must be location_hash" });
        return;
      }

      // Convert POD hex hash to decimal for comparison
      const podHashDecimal = BigInt(pod.location_hash).toString();
      if (proofLocationHash !== podHashDecimal) {
        res.status(422).json({
          error: "Proof location_hash does not match the stored POD",
        });
        return;
      }

      // 4. If a named region/constellation was specified, validate the proof bounds
      if (filterType === "region" && (regionId != null || constellationId != null)) {
        const tagType = constellationId != null ? "constellation" as const : "region" as const;
        const tagId = constellationId ?? regionId!;
        const bounds = constellationId != null
          ? getConstellationBounds(constellationId)
          : getRegionBounds(regionId!);

        if (!bounds) {
          res.status(400).json({
            error: `Unknown ${tagType} ID: ${tagId}`,
          });
          return;
        }

        // Verify the proof's public signals match the canonical bounds.
        // publicSignals layout: [locationHash, xMin, xMax, yMin, yMax, zMin, zMax]
        const expected = boundsToFieldStrings(bounds);
        const [, pXMin, pXMax, pYMin, pYMax, pZMin, pZMax] = publicSignals;
        if (
          pXMin !== expected.xMin ||
          pXMax !== expected.xMax ||
          pYMin !== expected.yMin ||
          pYMax !== expected.yMax ||
          pZMin !== expected.zMin ||
          pZMax !== expected.zMax
        ) {
          res.status(422).json({
            error: `Proof bounds do not match canonical ${tagType} ${tagId}`,
          });
          return;
        }

        // Store the public location tag
        await upsertLocationTag(pool, structureId, tagType, tagId, pod.location_hash);
      }

      // 5. Store the verified proof in the filter_proofs table
      const filterKey = regionId != null
        ? `region:${regionId}`
        : constellationId != null
          ? `constellation:${constellationId}`
          : buildFilterKey(filterType, publicSignals);
      const id = await upsertFilterProof(pool, {
        structureId,
        tribeId,
        locationHash: pod.location_hash,
        filterType,
        filterKey,
        publicSignals,
        proofJson: proof,
      });

      // 6. Propagate proof to derived structures if this is a Network Node
      let propagatedCount = 0;
      try {
        const derivedPods = await getDerivedPodsByNetworkNode(
          pool,
          structureId,
          tribeId,
        );
        for (const derived of derivedPods) {
          await upsertDerivedFilterProof(pool, {
            structureId: derived.structure_id,
            tribeId,
            locationHash: pod.location_hash,
            filterType,
            filterKey,
            publicSignals,
            proofJson: proof,
            sourceNetworkNodeId: structureId,
          });
          propagatedCount++;
        }
      } catch (propErr) {
        // Non-fatal — the primary proof is still stored
        console.warn(
          "[zk] Failed to propagate proof to derived structures:",
          propErr,
        );
      }

      res.json({
        id,
        structureId,
        tribeId,
        filterType,
        verified: true,
        propagated: propagatedCount,
        ...(regionId != null ? { regionId } : {}),
        ...(constellationId != null ? { constellationId } : {}),
      });
    } catch (err) {
      console.error("[zk] Failed to submit proof:", err);
      res.status(500).json({ error: "Failed to submit proof" });
    }
  });

  // ================================================================
  // GET /region — Query PODs with verified region-filter proofs
  //
  // Query params: tribeId, xMin, xMax, yMin, yMax, zMin, zMax
  // (all values are decimal-encoded biased coordinates)
  // ================================================================
  router.get("/region", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const { tribeId, xMin, xMax, yMin, yMax, zMin, zMax } = req.query as Record<string, string>;
    if (!tribeId || !xMin || !xMax || !yMin || !yMax || !zMin || !zMax) {
      res.status(400).json({ error: "All region bound params required" });
      return;
    }

    try {
      const filterKey = `region:${xMin},${xMax},${yMin},${yMax},${zMin},${zMax}`;
      const proofs = await getFilterProofsByKey(pool, tribeId, "region", filterKey);
      res.json({
        tribe_id: tribeId,
        filter_type: "region",
        count: proofs.length,
        results: proofs,
      });
    } catch (err) {
      console.error("[zk] Failed to query region proofs:", err);
      res.status(500).json({ error: "Failed to query proofs" });
    }
  });

  // ================================================================
  // GET /proximity — Query PODs with verified proximity-filter proofs
  //
  // Query params: tribeId, refX, refY, refZ, maxDistSq
  // ================================================================
  router.get("/proximity", async (req: Request, res: Response) => {
    const address = await authenticate(req, res);
    if (!address) return;

    const { tribeId, refX, refY, refZ, maxDistSq } = req.query as Record<string, string>;
    if (!tribeId || !refX || !refY || !refZ || !maxDistSq) {
      res.status(400).json({ error: "All proximity params required" });
      return;
    }

    try {
      const filterKey = `proximity:${refX},${refY},${refZ},${maxDistSq}`;
      const proofs = await getFilterProofsByKey(pool, tribeId, "proximity", filterKey);
      res.json({
        tribe_id: tribeId,
        filter_type: "proximity",
        count: proofs.length,
        results: proofs,
      });
    } catch (err) {
      console.error("[zk] Failed to query proximity proofs:", err);
      res.status(500).json({ error: "Failed to query proofs" });
    }
  });

  // ================================================================
  // GET /tags — Public (no auth) query for structure location tags
  //
  // Query params (pick one):
  //   ?tagType=region&tagId=10000005    → structures in that region
  //   ?structureId=0x…                  → all tags for that structure
  // ================================================================
  router.get("/tags", async (req: Request, res: Response) => {
    const { tagType, tagId, structureId } = req.query as Record<string, string>;

    try {
      if (structureId) {
        const tags = await getLocationTagsByStructure(pool, structureId);
        res.json({
          structure_id: structureId,
          tags: tags.map((t) => ({
            tag_type: t.tag_type,
            tag_id: t.tag_id,
            location_hash: t.location_hash,
            verified_at: t.verified_at,
          })),
        });
        return;
      }

      if (tagType && tagId) {
        if (tagType !== "region" && tagType !== "constellation") {
          res.status(400).json({ error: "tagType must be 'region' or 'constellation'" });
          return;
        }
        const id = Number(tagId);
        if (Number.isNaN(id)) {
          res.status(400).json({ error: "tagId must be a number" });
          return;
        }

        const tags = await getStructuresByTag(pool, tagType, id);
        res.json({
          tag_type: tagType,
          tag_id: id,
          count: tags.length,
          structures: tags.map((t) => ({
            structure_id: t.structure_id,
            location_hash: t.location_hash,
            verified_at: t.verified_at,
          })),
        });
        return;
      }

      res.status(400).json({ error: "Provide either structureId or tagType+tagId" });
    } catch (err) {
      console.error("[zk] Failed to query location tags:", err);
      res.status(500).json({ error: "Failed to query location tags" });
    }
  });

  return router;
}
