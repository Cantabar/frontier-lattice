/**
 * Identity context: resolves wallet address → Character → TribeCap(s).
 *
 * This is the auth backbone of the UI. All auth-gated components check
 * the identity context to determine which actions are available.
 */

import { createContext, useContext, useEffect, useRef } from "react";
import { useCurrentAccount, useSuiClientQuery } from "@mysten/dapp-kit";
import { config } from "../config";
import { useNotifications } from "./useNotifications";
import type { TribeCapData, Role } from "../lib/types";

export interface Identity {
  /** Connected wallet address */
  address: string;
  /** Character Sui object ID (from world contracts) */
  characterId: string | null;
  /** Character display name from on-chain metadata */
  characterName: string | null;
  /** Character portrait URL from on-chain metadata */
  characterPortraitUrl: string | null;
  /** In-game tribe ID read from the Character object (0 = unassigned) */
  inGameTribeId: number | null;
  /** All TribeCaps owned by this wallet */
  tribeCaps: TribeCapData[];
  /** Loading state */
  isLoading: boolean;
}

export const IdentityContext = createContext<Identity>({
  address: "",
  characterId: null,
  characterName: null,
  characterPortraitUrl: null,
  inGameTribeId: null,
  tribeCaps: [],
  isLoading: true,
});

export function useIdentity() {
  return useContext(IdentityContext);
}

/**
 * Hook that resolves the current wallet's Character and TribeCap objects.
 * Used by the IdentityProvider in main.tsx.
 *
 * Character objects are shared (not wallet-owned). The world contract creates a
 * wallet-owned PlayerProfile that holds a `character_id` pointer. We query for
 * PlayerProfile first, then fetch the shared Character by ID.
 */
export function useIdentityResolver(): Identity {
  const account = useCurrentAccount();
  const address = account?.address ?? "";

  // Step 1: Query owned PlayerProfile objects (wallet-owned pointers to shared Characters)
  const { data: profileData, isLoading: profileLoading } = useSuiClientQuery(
    "getOwnedObjects",
    {
      owner: address,
      filter: {
        StructType: `${config.packages.world}::character::PlayerProfile`,
      },
      options: { showContent: true },
    },
    { enabled: !!address && config.packages.world !== "0x0" },
  );

  // Extract character_id from the first PlayerProfile
  const profileObj = profileData?.data?.[0]?.data;
  const profileFields = (profileObj?.content as { fields?: Record<string, unknown> })?.fields;
  const characterIdFromProfile = profileFields?.character_id as string | undefined ?? null;

  // Step 2: Fetch the shared Character object by ID to get metadata & tribe_id
  const { data: characterObj, isLoading: charLoading } = useSuiClientQuery(
    "getObject",
    {
      id: characterIdFromProfile!,
      options: { showContent: true },
    },
    { enabled: !!characterIdFromProfile },
  );

  // Query owned TribeCap objects
  const { data: capData, isLoading: capLoading } = useSuiClientQuery(
    "getOwnedObjects",
    {
      owner: address,
      filter: {
        StructType: `${config.packages.tribe}::tribe::TribeCap`,
      },
      options: { showContent: true },
    },
    { enabled: !!address && config.packages.tribe !== "0x0" },
  );

  const charData = characterObj?.data;
  const characterId = charData?.objectId ?? null;
  const charFields = (charData?.content as { fields?: Record<string, unknown> })?.fields;
  const inGameTribeId = charFields ? Number(charFields.tribe_id ?? 0) : null;

  // Extract character name & portrait from metadata
  const metadata = (charFields?.metadata as { fields?: { name?: string; url?: string } })?.fields;
  const characterName = metadata?.name || null;
  const characterPortraitUrl = metadata?.url || null;

  const tribeCaps: TribeCapData[] = (capData?.data ?? [])
    .map((obj) => {
      const fields = (obj.data?.content as { fields?: Record<string, unknown> })?.fields;
      if (!fields) return null;
      return {
        id: obj.data!.objectId,
        tribeId: fields.tribe_id as string,
        characterId: fields.character_id as string,
        role: parseRole(fields.role),
      };
    })
    .filter((c): c is TribeCapData => c !== null);

  // ---------------------------------------------------------------------------
  // Diagnostic notifications
  // ---------------------------------------------------------------------------
  const { push, clearBySource } = useNotifications();
  const isLoading = profileLoading || charLoading || capLoading;
  const prevAddressRef = useRef<string>("");
  const pushedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Reset when wallet changes
    if (prevAddressRef.current !== address) {
      clearBySource("identity");
      pushedRef.current.clear();
      prevAddressRef.current = address;
    }

    if (isLoading || !address) return;

    // No Character object found
    if (!characterId && !pushedRef.current.has("no-character")) {
      pushedRef.current.add("no-character");
      push({
        level: "warning",
        title: "No Character Found",
        message:
          "No Character object found for this wallet. Most actions require an on-chain Character.",
        source: "identity",
      });
    }

    // Character exists but no tribe caps
    if (characterId && tribeCaps.length === 0 && !pushedRef.current.has("no-tribe")) {
      pushedRef.current.add("no-tribe");
      push({
        level: "info",
        title: "No Tribe Membership",
        message:
          "You are not a member of any Tribe. Join or create one to unlock tribe features.",
        source: "identity",
      });
    }

    // Unconfigured packages
    const unconfigured = Object.entries(config.packages)
      .filter(([, v]) => v === "0x0")
      .map(([k]) => k);
    if (unconfigured.length > 0 && !pushedRef.current.has("packages")) {
      pushedRef.current.add("packages");
      push({
        level: "warning",
        title: "Unconfigured Packages",
        message: `The following packages are not deployed: ${unconfigured.join(", ")}. Some features will be unavailable.`,
        source: "identity",
      });
    }
  }, [address, characterId, tribeCaps.length, isLoading, push, clearBySource]);

  return {
    address,
    characterId,
    characterName,
    characterPortraitUrl,
    inGameTribeId,
    tribeCaps,
    isLoading,
  };
}

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
