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
import { logger } from "../logger.js";

const log = logger.child({ component: "zk" });
import { authenticate } from "./auth.js";
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
  getMutualProximityProof,
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

  // ---- Auth (shared helper — supports TxSig and Bearer) ----
  async function auth(req: Request, res: Response): Promise<string | null> {
    return authenticate(req, res, pool);
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
    const address = await auth(req, res);
    if (!address) return;

    const {
      structureId,
      tribeId,
      filterType,
      publicSignals,
      proof,
      regionId,
      constellationId,
      referenceStructureId,
    } = req.body as {
      structureId: string;
      tribeId: string;
      filterType: "region" | "proximity" | "mutual_proximity";
      publicSignals: string[];
      proof: Record<string, unknown>;
      regionId?: number;
      constellationId?: number;
      referenceStructureId?: string;
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

    if (filterType !== "region" && filterType !== "proximity" && filterType !== "mutual_proximity") {
      res.status(400).json({ error: "filterType must be 'region', 'proximity', or 'mutual_proximity'" });
      return;
    }

    if (filterType === "mutual_proximity" && !referenceStructureId) {
      res.status(400).json({ error: "referenceStructureId is required for mutual_proximity proofs" });
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

      // 2. Confirm the POD(s) exist for this structure × tribe
      const pod = await getLocationPod(pool, structureId, tribeId);
      if (!pod) {
        res.status(404).json({ error: "No location POD found for this structure and tribe" });
        return;
      }

      // 2b. For mutual_proximity, also confirm the reference POD exists
      let referencePod: typeof pod | undefined;
      if (filterType === "mutual_proximity") {
        referencePod = await getLocationPod(pool, referenceStructureId!, tribeId);
        if (!referencePod) {
          res.status(404).json({ error: "No location POD found for the reference structure and tribe" });
          return;
        }
      }

      // 3. Verify the proof's location_hash(es) match the POD(s)
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

      // 3b. For mutual_proximity, verify the second hash matches the reference POD
      if (filterType === "mutual_proximity" && referencePod) {
        const refHash = publicSignals[1];
        const refPodHashDecimal = BigInt(referencePod.location_hash).toString();
        if (refHash !== refPodHashDecimal) {
          res.status(422).json({
            error: "Proof locationHash2 does not match the reference structure's POD",
          });
          return;
        }
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
        ...(filterType === "mutual_proximity" && referencePod
          ? {
              referenceStructureId: referenceStructureId!,
              referenceLocationHash: referencePod.location_hash,
            }
          : {}),
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
        log.warn({ err: propErr }, "Failed to propagate proof to derived structures");
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
        ...(referenceStructureId ? { referenceStructureId } : {}),
      });
    } catch (err) {
      log.error({ err }, "Failed to submit proof");
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
    const address = await auth(req, res);
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
      log.error({ err }, "Failed to query region proofs");
      res.status(500).json({ error: "Failed to query proofs" });
    }
  });

  // ================================================================
  // GET /proximity — Query PODs with verified proximity-filter proofs
  //
  // Query params: tribeId, refX, refY, refZ, maxDistSq
  // ================================================================
  router.get("/proximity", async (req: Request, res: Response) => {
    const address = await auth(req, res);
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
      log.error({ err }, "Failed to query proximity proofs");
      res.status(500).json({ error: "Failed to query proofs" });
    }
  });

  // ================================================================
  // GET /mutual-proximity — Query for a verified mutual proximity proof
  //
  // Query params: tribeId, structureIdA, structureIdB
  // ================================================================
  router.get("/mutual-proximity", async (req: Request, res: Response) => {
    const address = await auth(req, res);
    if (!address) return;

    const { tribeId, structureIdA, structureIdB } = req.query as Record<string, string>;
    if (!tribeId || !structureIdA || !structureIdB) {
      res.status(400).json({ error: "tribeId, structureIdA, and structureIdB are required" });
      return;
    }

    try {
      const proof = await getMutualProximityProof(pool, structureIdA, structureIdB, tribeId);
      if (!proof) {
        res.json({
          tribe_id: tribeId,
          structure_id_a: structureIdA,
          structure_id_b: structureIdB,
          verified: false,
        });
        return;
      }

      res.json({
        tribe_id: tribeId,
        structure_id_a: structureIdA,
        structure_id_b: structureIdB,
        verified: true,
        proof: {
          id: proof.id,
          filter_key: proof.filter_key,
          public_signals: proof.public_signals,
          verified_at: proof.verified_at,
        },
      });
    } catch (err) {
      log.error({ err }, "Failed to query mutual proximity proof");
      res.status(500).json({ error: "Failed to query mutual proximity proof" });
    }
  });

  // ================================================================
  // POST /verify — Public (no auth) cryptographic proof verification
  //
  // Accepts either a single proof or a full PodProofBundle (detected by
  // the presence of a `zk_proofs` array). Returns verification results
  // without storing anything in the database.
  //
  // Single proof body: { filterType, publicSignals, proof }
  // Bundle body:       { zk_proofs: [{ filter_type, public_signals, proof_json }], ... }
  // ================================================================
  router.post("/verify", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;

    try {
      // Detect bundle format (has zk_proofs array)
      if (Array.isArray(body.zk_proofs)) {
        const proofs = body.zk_proofs as {
          filter_type: string;
          public_signals: string[];
          proof_json: Record<string, unknown>;
        }[];

        if (proofs.length === 0) {
          res.status(400).json({ error: "zk_proofs array is empty" });
          return;
        }

        const results = await Promise.all(
          proofs.map(async (p) => {
            const ft = p.filter_type as "region" | "proximity" | "mutual_proximity";
            if (ft !== "region" && ft !== "proximity" && ft !== "mutual_proximity") {
              return { filter_type: p.filter_type, valid: false, error: "Unknown filter type" };
            }
            const result = await verifyFilterProof(ft, p.public_signals, p.proof_json);
            return { filter_type: p.filter_type, valid: result.valid, error: result.error };
          }),
        );

        const allValid = results.every((r) => r.valid);
        res.json({
          format: "bundle",
          valid: allValid,
          proof_count: results.length,
          results,
          ...(body.structure_id ? { structure_id: body.structure_id } : {}),
          ...(body.location_hash ? { location_hash: body.location_hash } : {}),
        });
        return;
      }

      // Single proof format
      const { filterType, publicSignals, proof } = body as {
        filterType: string;
        publicSignals: string[];
        proof: Record<string, unknown>;
      };

      if (!filterType || !publicSignals?.length || !proof) {
        res.status(400).json({
          error: "Provide { filterType, publicSignals, proof } or a PodProofBundle with zk_proofs[]",
        });
        return;
      }

      if (filterType !== "region" && filterType !== "proximity" && filterType !== "mutual_proximity") {
        res.status(400).json({ error: "filterType must be 'region', 'proximity', or 'mutual_proximity'" });
        return;
      }

      const result = await verifyFilterProof(
        filterType as "region" | "proximity" | "mutual_proximity",
        publicSignals,
        proof,
      );

      res.json({
        format: "single",
        valid: result.valid,
        filter_type: filterType,
        error: result.error,
      });
    } catch (err) {
      log.error({ err }, "Failed to verify proof");
      res.status(500).json({ error: "Proof verification failed" });
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
      log.error({ err }, "Failed to query location tags");
      res.status(500).json({ error: "Failed to query location tags" });
    }
  });

  return router;
}
