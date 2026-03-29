/**
 * Shadow Location Network — React hook for ZK location filtering.
 *
 * Provides:
 *   - Region filter: prove a batch of PODs lie within a 3D bounding box
 *   - Proximity filter: prove a batch of PODs are within distance of a point
 *   - Query helpers to fetch previously-verified results from the server
 *
 * Usage:
 *   const { proveRegion, queryRegion, isProving, error } = useZkLocationFilter();
 */

import { useState, useCallback } from "react";
import { useLocationPods, type DecryptedPod } from "./useLocationPods";
import {
  generateRegionProof,
  generateProximityProof,
  generateMutualProximityProof,
  type ZkProof,
} from "../lib/zkProver";
import {
  submitZkProof,
  getZkRegionResults,
  getZkProximityResults,
  getZkMutualProximityResult,
  type ZkFilteredResult,
  type MutualProximityResult,
} from "../lib/api";
import {
  getRegionBounds,
  getConstellationBounds,
  type BoundingBox,
} from "../lib/regions";

// ============================================================
// Types
// ============================================================

export interface RegionBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

export interface ProximityParams {
  refX: number;
  refY: number;
  refZ: number;
  maxDistance: number;
}

export interface ProveResult {
  /** Number of proofs successfully generated and submitted */
  submitted: number;
  /** Number of proofs that failed (location outside filter bounds) */
  failed: number;
}

export interface UseZkLocationFilterReturn {
  /** Whether a prove/query operation is in progress */
  isProving: boolean;
  /** Last error encountered */
  error: string | null;

  /**
   * Generate and submit region-filter proofs for a set of decrypted PODs.
   * PODs whose coordinates fall outside the bounds will be skipped (no error).
   */
  proveRegion: (
    pods: DecryptedPod[],
    tribeId: string,
    bounds: RegionBounds,
  ) => Promise<ProveResult>;

  /**
   * Generate and submit region-filter proofs for a named game region.
   * Looks up the canonical bounding box and tags the structure on success.
   */
  proveRegionById: (
    pods: DecryptedPod[],
    tribeId: string,
    regionId: number,
  ) => Promise<ProveResult>;

  /**
   * Generate and submit region-filter proofs for a named constellation.
   * Looks up the canonical bounding box and tags the structure on success.
   */
  proveConstellationById: (
    pods: DecryptedPod[],
    tribeId: string,
    constellationId: number,
  ) => Promise<ProveResult>;

  /**
   * Generate and submit proximity-filter proofs for a set of decrypted PODs.
   * PODs outside the distance threshold will be skipped.
   */
  proveProximity: (
    pods: DecryptedPod[],
    tribeId: string,
    params: ProximityParams,
  ) => Promise<ProveResult>;

  /**
   * Generate and submit a mutual proximity proof proving two decrypted PODs
   * are within `maxDistance` of each other. Used for witnessed contract
   * proximity requirements.
   */
  proveMutualProximity: (
    podA: DecryptedPod,
    podB: DecryptedPod,
    tribeId: string,
    maxDistance: number,
  ) => Promise<{ submitted: boolean }>;

  /** Query the server for PODs with verified region-filter proofs. */
  queryRegion: (
    tribeId: string,
    bounds: RegionBounds,
  ) => Promise<ZkFilteredResult[]>;

  /** Query the server for PODs with verified proximity-filter proofs. */
  queryProximity: (
    tribeId: string,
    params: ProximityParams,
  ) => Promise<ZkFilteredResult[]>;

  /** Query the server for a verified mutual proximity proof between two structures. */
  queryMutualProximity: (
    tribeId: string,
    structureIdA: string,
    structureIdB: string,
  ) => Promise<MutualProximityResult>;
}

// ============================================================
// Hook
// ============================================================

const BN254_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function fieldStr(coord: number): string {
  const v = BigInt(coord);
  return (v >= 0n ? v : v + BN254_PRIME).toString();
}

export function useZkLocationFilter(): UseZkLocationFilterReturn {
  const { getAuthHeader } = useLocationPods();
  const [isProving, setIsProving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Prove Region ----
  const proveRegion = useCallback(
    async (
      pods: DecryptedPod[],
      tribeId: string,
      bounds: RegionBounds,
    ): Promise<ProveResult> => {
      setIsProving(true);
      setError(null);
      let submitted = 0;
      let failed = 0;

      try {
        const authHeader = await getAuthHeader();

        // Deduplicate: for derived PODs, only prove the Network Node.
        // The server propagates proofs to all connected structures.
        const seen = new Set<string>();
        const dedupedPods = pods.filter((pod) => {
          if (pod.networkNodeId) {
            // This is a derived POD — skip it, the Network Node proof covers it
            return false;
          }
          if (seen.has(pod.structureId)) return false;
          seen.add(pod.structureId);
          return true;
        });

        for (const pod of dedupedPods) {
          try {
            const proof: ZkProof = await generateRegionProof({
              locationHash: pod.locationHash,
              x: pod.location.x,
              y: pod.location.y,
              z: pod.location.z,
              salt: BigInt(pod.location.salt),
              regionXMin: bounds.xMin,
              regionXMax: bounds.xMax,
              regionYMin: bounds.yMin,
              regionYMax: bounds.yMax,
              regionZMin: bounds.zMin,
              regionZMax: bounds.zMax,
            });

            await submitZkProof(authHeader, {
              structureId: pod.structureId,
              tribeId,
              filterType: "region",
              publicSignals: proof.publicSignals,
              proof: proof.proof,
            });

            submitted++;
          } catch {
            // Proof generation fails when the location is outside bounds — expected
            failed++;
          }
        }

        return { submitted, failed };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Region proof batch failed";
        setError(msg);
        throw err;
      } finally {
        setIsProving(false);
      }
    },
    [getAuthHeader],
  );

  // ---- Prove Region by ID (named game region) ----
  const proveRegionById = useCallback(
    async (
      pods: DecryptedPod[],
      tribeId: string,
      regionId: number,
    ): Promise<ProveResult> => {
      const bounds = getRegionBounds(regionId);
      if (!bounds) throw new Error(`Unknown region ID: ${regionId}`);
      return proveNamedRegion(pods, tribeId, bounds, { regionId });
    },
    [getAuthHeader],
  );

  // ---- Prove Constellation by ID ----
  const proveConstellationById = useCallback(
    async (
      pods: DecryptedPod[],
      tribeId: string,
      constellationId: number,
    ): Promise<ProveResult> => {
      const bounds = getConstellationBounds(constellationId);
      if (!bounds) throw new Error(`Unknown constellation ID: ${constellationId}`);
      return proveNamedRegion(pods, tribeId, bounds, { constellationId });
    },
    [getAuthHeader],
  );

  // ---- Shared helper for named region/constellation proofs ----
  async function proveNamedRegion(
    pods: DecryptedPod[],
    tribeId: string,
    bounds: BoundingBox,
    tag: { regionId?: number; constellationId?: number },
  ): Promise<ProveResult> {
    setIsProving(true);
    setError(null);
    let submitted = 0;
    let failed = 0;

    try {
      const authHeader = await getAuthHeader();

      const seen = new Set<string>();
      const dedupedPods = pods.filter((pod) => {
        if (pod.networkNodeId) return false;
        if (seen.has(pod.structureId)) return false;
        seen.add(pod.structureId);
        return true;
      });

      for (const pod of dedupedPods) {
        try {
          const proof = await generateRegionProof({
            locationHash: pod.locationHash,
            x: pod.location.x,
            y: pod.location.y,
            z: pod.location.z,
            salt: BigInt(pod.location.salt),
            regionXMin: Number(bounds.xMin),
            regionXMax: Number(bounds.xMax),
            regionYMin: Number(bounds.yMin),
            regionYMax: Number(bounds.yMax),
            regionZMin: Number(bounds.zMin),
            regionZMax: Number(bounds.zMax),
          });

          await submitZkProof(authHeader, {
            structureId: pod.structureId,
            tribeId,
            filterType: "region",
            publicSignals: proof.publicSignals,
            proof: proof.proof,
            ...(tag.regionId != null ? { regionId: tag.regionId } : {}),
            ...(tag.constellationId != null ? { constellationId: tag.constellationId } : {}),
          });

          submitted++;
        } catch {
          failed++;
        }
      }

      return { submitted, failed };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Named region proof batch failed";
      setError(msg);
      throw err;
    } finally {
      setIsProving(false);
    }
  }

  // ---- Prove Proximity ----
  const proveProximity = useCallback(
    async (
      pods: DecryptedPod[],
      tribeId: string,
      params: ProximityParams,
    ): Promise<ProveResult> => {
      setIsProving(true);
      setError(null);
      let submitted = 0;
      let failed = 0;

      try {
        const authHeader = await getAuthHeader();

        // Deduplicate: skip derived PODs — server propagates from Network Node
        const seen = new Set<string>();
        const dedupedPods = pods.filter((pod) => {
          if (pod.networkNodeId) return false;
          if (seen.has(pod.structureId)) return false;
          seen.add(pod.structureId);
          return true;
        });

        for (const pod of dedupedPods) {
          try {
            const proof: ZkProof = await generateProximityProof({
              locationHash: pod.locationHash,
              x: pod.location.x,
              y: pod.location.y,
              z: pod.location.z,
              salt: BigInt(pod.location.salt),
              refX: params.refX,
              refY: params.refY,
              refZ: params.refZ,
              maxDistance: params.maxDistance,
            });

            await submitZkProof(authHeader, {
              structureId: pod.structureId,
              tribeId,
              filterType: "proximity",
              publicSignals: proof.publicSignals,
              proof: proof.proof,
            });

            submitted++;
          } catch {
            failed++;
          }
        }

        return { submitted, failed };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Proximity proof batch failed";
        setError(msg);
        throw err;
      } finally {
        setIsProving(false);
      }
    },
    [getAuthHeader],
  );

  // ---- Query Region ----
  const queryRegion = useCallback(
    async (
      tribeId: string,
      bounds: RegionBounds,
    ): Promise<ZkFilteredResult[]> => {
      const authHeader = await getAuthHeader();
      const result = await getZkRegionResults(authHeader, {
        tribeId,
        xMin: fieldStr(bounds.xMin),
        xMax: fieldStr(bounds.xMax),
        yMin: fieldStr(bounds.yMin),
        yMax: fieldStr(bounds.yMax),
        zMin: fieldStr(bounds.zMin),
        zMax: fieldStr(bounds.zMax),
      });
      return result.results;
    },
    [getAuthHeader],
  );

  // ---- Query Proximity ----
  const queryProximity = useCallback(
    async (
      tribeId: string,
      params: ProximityParams,
    ): Promise<ZkFilteredResult[]> => {
      const authHeader = await getAuthHeader();
      const maxDistSq = (BigInt(Math.ceil(params.maxDistance)) ** 2n).toString();
      const result = await getZkProximityResults(authHeader, {
        tribeId,
        refX: fieldStr(params.refX),
        refY: fieldStr(params.refY),
        refZ: fieldStr(params.refZ),
        maxDistSq,
      });
      return result.results;
    },
    [getAuthHeader],
  );

  // ---- Prove Mutual Proximity ----
  const proveMutualProximity = useCallback(
    async (
      podA: DecryptedPod,
      podB: DecryptedPod,
      tribeId: string,
      maxDistance: number,
    ): Promise<{ submitted: boolean }> => {
      setIsProving(true);
      setError(null);

      try {
        const authHeader = await getAuthHeader();

        const proof = await generateMutualProximityProof({
          locationHash1: podA.locationHash,
          x1: podA.location.x,
          y1: podA.location.y,
          z1: podA.location.z,
          salt1: BigInt(podA.location.salt),
          locationHash2: podB.locationHash,
          x2: podB.location.x,
          y2: podB.location.y,
          z2: podB.location.z,
          salt2: BigInt(podB.location.salt),
          maxDistance,
        });

        await submitZkProof(authHeader, {
          structureId: podA.structureId,
          tribeId,
          filterType: "mutual_proximity",
          publicSignals: proof.publicSignals,
          proof: proof.proof,
          referenceStructureId: podB.structureId,
        });

        return { submitted: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Mutual proximity proof failed";
        setError(msg);
        throw err;
      } finally {
        setIsProving(false);
      }
    },
    [getAuthHeader],
  );

  // ---- Query Mutual Proximity ----
  const queryMutualProximity = useCallback(
    async (
      tribeId: string,
      structureIdA: string,
      structureIdB: string,
    ): Promise<MutualProximityResult> => {
      const authHeader = await getAuthHeader();
      return getZkMutualProximityResult(authHeader, {
        tribeId,
        structureIdA,
        structureIdB,
      });
    },
    [getAuthHeader],
  );

  return {
    isProving,
    error,
    proveRegion,
    proveRegionById,
    proveConstellationById,
    proveProximity,
    proveMutualProximity,
    queryRegion,
    queryProximity,
    queryMutualProximity,
  };
}
