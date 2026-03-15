/**
 * Hook for reading Tribe object data from Sui RPC.
 *
 * Members and reputation are stored in on-chain Tables (dynamic fields).
 * We resolve them with getDynamicFields + getDynamicFieldObject queries.
 */

import { useState, useEffect, useRef } from "react";
import { useSuiClientQuery } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { useSuiClient } from "@mysten/dapp-kit";
import type { TribeData, TribeMember, Role } from "../lib/types";
import { extractCoinTypeFromObjectType } from "../lib/coinUtils";
import { config } from "../config";

/** How long (ms) to keep polling for a missing-but-expected object. */
const POLL_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 2_000;

function parseRole(raw: unknown): Role {
  // Plain string (e.g. "Leader")
  if (typeof raw === "string") {
    if (raw === "Leader") return "Leader";
    if (raw === "Officer") return "Officer";
    return "Member";
  }
  if (typeof raw === "object" && raw !== null) {
    // Move 2024 enum format: { variant: "Leader" } or { variant: "Leader", fields: {} }
    if ("variant" in raw) {
      const v = (raw as { variant: string }).variant;
      if (v === "Leader") return "Leader";
      if (v === "Officer") return "Officer";
      return "Member";
    }
    // Legacy format: { Leader: {} }
    if ("Leader" in raw) return "Leader";
    if ("Officer" in raw) return "Officer";
  }
  return "Member";
}

export function useTribe(tribeId: string | undefined) {
  const client = useSuiClient();

  // Track whether we should be polling for a missing object
  const [polling, setPolling] = useState(false);
  const pollStartRef = useRef<number>(0);

  const { data, isLoading, error } = useSuiClientQuery(
    "getObject",
    {
      id: tribeId!,
      options: { showContent: true },
    },
    {
      enabled: !!tribeId,
      refetchInterval: polling ? POLL_INTERVAL_MS : false,
    },
  );

  // Start polling when we have a tribeId but the object isn't found yet
  const objectMissing = !!tribeId && !isLoading && !!data && !data.data;

  useEffect(() => {
    if (objectMissing && !polling) {
      setPolling(true);
      pollStartRef.current = Date.now();
    }
    // Object appeared — stop polling
    if (data?.data && polling) {
      setPolling(false);
    }
  }, [objectMissing, data, polling]);

  // Auto-stop polling after timeout
  useEffect(() => {
    if (!polling) return;
    const remaining = POLL_TIMEOUT_MS - (Date.now() - pollStartRef.current);
    if (remaining <= 0) {
      setPolling(false);
      return;
    }
    const timer = setTimeout(() => setPolling(false), remaining);
    return () => clearTimeout(timer);
  }, [polling]);

  /** True while we are still polling for a missing-but-expected object. */
  const isPending = polling && objectMissing;

  const objectType = (data?.data?.content as { type?: string })?.type ?? "";
  const parsedCoinType = extractCoinTypeFromObjectType(objectType) ?? config.coinType;

  const fields = (data?.data?.content as { fields?: Record<string, unknown> })?.fields;
  const membersTableId = (fields?.members as { fields?: { id?: { id: string } } })?.fields?.id?.id;
  const repTableId = (fields?.reputation as { fields?: { id?: { id: string } } })?.fields?.id?.id;

  // Fetch member dynamic fields from the members Table
  const { data: members } = useQuery({
    queryKey: ["tribeMembers", tribeId, membersTableId],
    queryFn: async (): Promise<TribeMember[]> => {
      if (!membersTableId || !repTableId) return [];

      // Get member entries from the members table
      const memberFields = await client.getDynamicFields({ parentId: membersTableId });
      const repFields = await client.getDynamicFields({ parentId: repTableId });

      // Build a reputation lookup: character_id -> score
      const repMap = new Map<string, number>();
      for (const rf of repFields.data) {
        const repObj = await client.getDynamicFieldObject({ parentId: repTableId, name: rf.name });
        const repContent = repObj.data?.content as { fields?: Record<string, unknown> } | undefined;
        const charId = String((rf.name as { value?: unknown }).value ?? rf.name);
        const score = Number(repContent?.fields?.value ?? 0);
        repMap.set(charId, score);
      }

      // Build member list
      const result: TribeMember[] = [];
      for (const mf of memberFields.data) {
        const memberObj = await client.getDynamicFieldObject({ parentId: membersTableId, name: mf.name });
        const memberContent = memberObj.data?.content as { fields?: Record<string, unknown> } | undefined;
        const charId = String((mf.name as { value?: unknown }).value ?? mf.name);
        const role = parseRole(memberContent?.fields?.value);
        result.push({
          characterId: charId,
          role,
          reputation: repMap.get(charId) ?? 0,
        });
      }

      return result;
    },
    enabled: !!membersTableId && !!repTableId,
  });

  const tribe: TribeData | null = (() => {
    if (!fields) return null;
    return {
      id: data!.data!.objectId,
      name: fields.name as string,
      inGameTribeId: Number(fields.in_game_tribe_id ?? 0),
      leaderCharacterId: fields.leader_character_id as string,
      memberCount: Number(fields.member_count),
      treasuryBalance: String(
        (fields.treasury as { fields?: { value?: string } })?.fields?.value ?? "0",
      ),
      voteThreshold: Number(fields.vote_threshold),
      members: members ?? [],
      coinType: parsedCoinType,
    };
  })();

  return { tribe, isLoading, isPending, error };
}
