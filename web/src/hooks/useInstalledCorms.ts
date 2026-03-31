/**
 * Hook to discover installed corms on the player's network nodes.
 *
 * Queries on-chain CormStateCreatedEvent emissions from the corm_state
 * package, matches `network_node_id` against the player's owned
 * NetworkNode structures, then batch-reads each CormState object to get
 * current phase/stability/corruption.
 */

import { useMemo } from "react";
import { useSuiClientQuery, useSuiClientQueries } from "@mysten/dapp-kit";
import { useStructures } from "./useStructures";
import { config } from "../config";

export interface InstalledCorm {
  /** On-chain CormState shared object ID. */
  cormStateId: string;
  /** The network node this corm is bound to. */
  networkNodeId: string;
  /** Human-readable node name (from the player's structures). */
  nodeName: string;
  /** Current corm phase (0–6). */
  phase: number;
  /** Stability meter (0–100). */
  stability: number;
  /** Corruption meter (0–100). */
  corruption: number;
}

export function useInstalledCorms() {
  // Events are typed under the original package ID (stable across upgrades),
  // not the upgraded published-at address used for function calls.
  const cormStateOriginal = config.originalIds.cormState;
  const enabled = cormStateOriginal !== "0x0";

  const { structures, isLoading: structuresLoading } = useStructures();

  // Player's NetworkNode IDs + name lookup
  const nodeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of structures) {
      if (s.moveType === "NetworkNode") {
        map.set(s.id, s.name || "Unnamed Node");
      }
    }
    return map;
  }, [structures]);

  const hasNodes = nodeMap.size > 0;

  // Step 1: Query CormStateCreatedEvent to discover corm → node mappings
  const { data: eventData, isLoading: eventsLoading } = useSuiClientQuery(
    "queryEvents",
    {
      query: {
        MoveEventType: `${cormStateOriginal}::corm_state::CormStateCreatedEvent`,
      },
      limit: 200,
      order: "descending",
    },
    { enabled: enabled && hasNodes },
  );

  // Extract cormStateId for each of the player's nodes
  const cormEntries = useMemo(() => {
    if (!eventData?.data) return [];
    const entries: { cormStateId: string; networkNodeId: string }[] = [];
    const seen = new Set<string>();

    for (const ev of eventData.data) {
      const parsed = ev.parsedJson as Record<string, unknown> | undefined;
      const nodeId = parsed?.network_node_id as string | undefined;
      const stateId = parsed?.corm_state_id as string | undefined;
      if (!nodeId || !stateId) continue;
      if (!nodeMap.has(nodeId)) continue;
      // Dedupe by node — first event per node (most recent) wins
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      entries.push({ cormStateId: stateId, networkNodeId: nodeId });
    }
    return entries;
  }, [eventData, nodeMap]);

  // Step 2: Batch-read CormState objects for current values
  const stateResults = useSuiClientQueries({
    queries:
      cormEntries.length > 0
        ? cormEntries.map((e) => ({
            method: "getObject" as const,
            params: { id: e.cormStateId, options: { showContent: true } },
          }))
        : [],
    combine: (results) => ({
      data: results.map((r) => r.data),
      isLoading: results.some((r) => r.isLoading),
    }),
  });

  const installedCorms = useMemo(() => {
    if (!stateResults.data) return [];
    const list: InstalledCorm[] = [];

    stateResults.data.forEach((obj, i) => {
      const entry = cormEntries[i];
      if (!obj?.data) return;
      const fields = (
        obj.data.content as { fields?: Record<string, unknown> }
      )?.fields;

      list.push({
        cormStateId: entry.cormStateId,
        networkNodeId: entry.networkNodeId,
        nodeName: nodeMap.get(entry.networkNodeId) || "Unnamed Node",
        phase: fields ? Number(fields.phase ?? 0) : 0,
        stability: fields ? Number(fields.stability ?? 0) : 0,
        corruption: fields ? Number(fields.corruption ?? 0) : 0,
      });
    });

    return list;
  }, [stateResults.data, cormEntries, nodeMap]);

  return {
    installedCorms,
    /** Set of network node IDs that already have a corm installed. */
    installedNodeIds: useMemo(
      () => new Set(cormEntries.map((e) => e.networkNodeId)),
      [cormEntries],
    ),
    isLoading:
      structuresLoading ||
      (enabled && hasNodes && eventsLoading) ||
      stateResults.isLoading,
  };
}
