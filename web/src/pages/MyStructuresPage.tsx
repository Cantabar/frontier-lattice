import { useState, useMemo, useEffect } from "react";
import styled from "styled-components";
import { useParams, Navigate, Link } from "react-router-dom";
import { CustomSelect } from "../components/shared/CustomSelect";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { useStructures } from "../hooks/useStructures";
import { useNetworkNodes } from "../hooks/useNetworkNodes";
import { useIdentity } from "../hooks/useIdentity";
import { useStructureLocationIds } from "../hooks/useStructureLocationIds";
import { useCharacterProfile } from "../hooks/useCharacterProfile";
import { useTlkStatus } from "../hooks/useTlkStatus";
import { useLocationPods } from "../hooks/useLocationPods";
import { AuthPromptModal } from "../components/shared/AuthPromptModal";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import { SsuInventoryPanel } from "../components/structures/SsuInventoryPanel";
import { NetworkNodeGroup } from "../components/structures/NetworkNodeGroup";
import { RegisterLocationModal } from "../components/locations/RegisterLocationModal";
import { buildOnlineStructure, buildOfflineStructure, buildAuthorizeExtension, buildUpdateMetadataName } from "../lib/sui";
import { config } from "../config";
import { truncateAddress } from "../lib/format";
import { CopyableId } from "../components/shared/CopyableId";
import { ASSEMBLY_TYPES } from "../lib/types";
import type { AssemblyData, AssemblyTypeFilter, AssemblyStatus } from "../lib/types";
import { useEnergyMap, formatEnergyDisplay } from "../hooks/useEnergyMap";
import { CollapsibleSummary } from "../components/structures/CollapsibleSummary";

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Page = styled.div``;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const CopyLinkButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  background: ${({ theme }) => theme.colors.surface.raised};
  color: ${({ theme }) => theme.colors.text.muted};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const ConnectPrompt = styled.div`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xxl};
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 16px;
`;

const LocationAuthBanner = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  border-radius: ${({ theme }) => theme.radii.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  font-size: 13px;
  border: 1px solid ${({ theme }) => theme.colors.primary.main}44;
  background: ${({ theme }) => theme.colors.primary.main}11;
`;

const LocationAuthText = styled.span`
  flex: 1;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const LocationAuthButton = styled.button`
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 12px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  border: 1px solid ${({ theme }) => theme.colors.primary.main};
  background: transparent;
  color: ${({ theme }) => theme.colors.primary.main};
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.primary.subtle};
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const FilterRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  flex-wrap: wrap;
`;

const Tab = styled.button<{ $active: boolean }>`
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary.subtle : theme.colors.surface.raised};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
  border: 1px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.primary.subtle : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
`;

const StatusSelectWrapper = styled.div`
  margin-left: auto;
`;

const Grid = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const StructureCard = styled.div<{ $clickable?: boolean; $expanded?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid
    ${({ $expanded, theme }) =>
      $expanded ? theme.colors.primary.subtle : theme.colors.surface.border};
  border-radius: ${({ $expanded, theme }) =>
    $expanded
      ? `${theme.radii.md} ${theme.radii.md} 0 0`
      : theme.radii.md};
  transition: border-color 0.15s;
  cursor: ${({ $clickable }) => ($clickable ? "pointer" : "default")};

  &:hover {
    border-color: ${({ $clickable, theme }) =>
      $clickable ? theme.colors.primary.main : theme.colors.surface.borderHover};
  }

  @media (max-width: ${({ theme }) => theme.breakpoints.lg}px) {
    flex-wrap: wrap;
  }
`;

const StructureIcon = styled.img`
  width: 40px;
  height: 40px;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.bg};
  object-fit: contain;
  flex-shrink: 0;
`;

const StructureIconPlaceholder = styled.div`
  width: 40px;
  height: 40px;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.bg};
  flex-shrink: 0;
`;

const StructureInfo = styled.div`
  flex: 0 1 250px;
  min-width: 0;

  @media (max-width: ${({ theme }) => theme.breakpoints.lg}px) {
    flex: 1 1 0%;
  }
`;

const StructureName = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const StructureMeta = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: 2px;
`;

const TagsLeft = styled.div`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  flex-shrink: 0;

  @media (max-width: ${({ theme }) => theme.breakpoints.lg}px) {
    flex-basis: 100%;
    padding-left: calc(40px + ${({ theme }) => theme.spacing.md});
  }
`;

const TagsRight = styled.div`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  flex-shrink: 0;
  margin-left: auto;

  @media (max-width: ${({ theme }) => theme.breakpoints.lg}px) {
    flex-basis: 100%;
    padding-left: calc(40px + ${({ theme }) => theme.spacing.md});
    margin-left: 0;
  }
`;

const TypeBadge = styled.span`
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.secondary.accentMuted};
  color: ${({ theme }) => theme.colors.text.primary};
  width: 140px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;

  @media (max-width: ${({ theme }) => theme.breakpoints.lg}px) {
    width: auto;
  }
`;

const StatusDot = styled.span<{ $status: AssemblyStatus }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  background: ${({ $status, theme }) => {
    switch ($status) {
      case "Online":
        return theme.colors.success;
      case "Offline":
        return theme.colors.text.muted;
      case "Anchored":
        return theme.colors.warning;
      case "Unanchoring":
        return theme.colors.danger;
    }
  }};
`;

const StatusLabel = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  width: 100px;
  flex-shrink: 0;

  @media (max-width: ${({ theme }) => theme.breakpoints.lg}px) {
    width: auto;
  }
`;

const EnergyIndicator = styled.span<{ $connected: boolean }>`
  font-size: 11px;
  color: ${({ $connected, theme }) =>
    $connected ? theme.colors.success : theme.colors.text.muted};
  width: 110px;
  flex-shrink: 0;

  @media (max-width: ${({ theme }) => theme.breakpoints.lg}px) {
    width: auto;
  }
`;

const LocationBadge = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary.main};
  white-space: nowrap;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const AddLocationButton = styled.button`
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  border: 1px solid ${({ theme }) => theme.colors.primary.main};
  background: transparent;
  color: ${({ theme }) => theme.colors.primary.main};
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.primary.subtle};
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const ActionButton = styled.button<{ $variant: "online" | "offline" }>`
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  border: 1px solid
    ${({ $variant, theme }) =>
      $variant === "online" ? theme.colors.success : theme.colors.text.muted};
  background: transparent;
  color: ${({ $variant, theme }) =>
    $variant === "online" ? theme.colors.success : theme.colors.text.secondary};
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    background: ${({ $variant, theme }) =>
      $variant === "online" ? theme.colors.success : theme.colors.text.muted};
    color: ${({ theme }) => theme.colors.surface.raised};
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const ExtensionBadge = styled.span<{ $enabled: boolean }>`
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ $enabled, theme }) =>
    $enabled ? theme.colors.success + "22" : theme.colors.surface.bg};
  color: ${({ $enabled, theme }) =>
    $enabled ? theme.colors.success : theme.colors.text.disabled};
  white-space: nowrap;
`;

const MetadataLabel = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary.main};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
`;

const EditNameButton = styled.button`
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  background: transparent;
  color: ${({ theme }) => theme.colors.text.muted};
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const InlineNameInput = styled.input`
  font-size: 13px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: ${({ theme }) => theme.radii.sm};
  border: 1px solid ${({ theme }) => theme.colors.primary.main};
  background: ${({ theme }) => theme.colors.surface.bg};
  color: ${({ theme }) => theme.colors.text.primary};
  outline: none;
  width: 180px;
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CORM_EXT = "corm_auth::CormAuth";

function hasCormExtension(structure: AssemblyData): boolean {
  return structure.extension?.includes(CORM_EXT) ?? false;
}

function getTypeCategory(typeId: number): string {
  const entry = ASSEMBLY_TYPES[typeId];
  return entry?.short ?? "Unknown";
}

function getTypeLabel(typeId: number): string {
  return ASSEMBLY_TYPES[typeId]?.label ?? `Type ${typeId}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const UNCONNECTED_KEY = "__unconnected__";

/**
 * Redirect component for `/structures` (no character ID in URL).
 * Redirects to `/structures/:characterId` for the logged-in user,
 * or shows a connect prompt.
 */
export function StructuresRedirect() {
  const account = useCurrentAccount();
  const { characterId } = useIdentity();

  if (!account) {
    return (
      <Page>
        <Title>Structures</Title>
        <ConnectPrompt>Connect your wallet to view your structures.</ConnectPrompt>
      </Page>
    );
  }

  if (!characterId) {
    return <LoadingSpinner />;
  }

  return <Navigate to={`/structures/${characterId}`} replace />;
}

export function MyStructuresPage() {
  const { characterId: urlCharacterId } = useParams<{ characterId: string }>();
  const account = useCurrentAccount();
  const { characterId: myCharacterId, tribeCaps } = useIdentity();
  const targetCharacterId = urlCharacterId ?? null;
  const isOwner = !!myCharacterId && myCharacterId === targetCharacterId;
  const tribeId = isOwner ? (tribeCaps[0]?.tribeId ?? null) : null;
  const { structures, isLoading, refetch } = useStructures(targetCharacterId);
  const { locationIds, refetch: refetchLocations } = useStructureLocationIds();
  const { profile: targetProfile } = useCharacterProfile(isOwner ? null : targetCharacterId);
  const tlk = useTlkStatus();
  const { getAuthHeader } = useLocationPods();
  const [addLocationForId, setAddLocationForId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Deferred auth: don't sign on mount — wait for user to click "Show Locations"
  const [locationAuth, setLocationAuth] = useState<"idle" | "prompting" | "verifying" | "authenticated">("idle");

  async function handleLocationAuth() {
    setLocationAuth("verifying");
    try {
      await getAuthHeader();
      // Auth succeeded — fetch location data
      refetchLocations();
      if (isOwner && tribeId) tlk.fetchStatus(tribeId);
      setLocationAuth("authenticated");
    } catch {
      setLocationAuth("idle");
    }
  }

  const [typeFilter, setTypeFilter] = useState<AssemblyTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<AssemblyStatus | "all">("all");
  const [selectedSsuId, setSelectedSsuId] = useState<string | null>(null);
  const [groupByNode, setGroupByNode] = useState(true);

  const filtered = useMemo(
    () =>
      structures.filter((s) => {
        // NetworkNodes are represented by the group header, not as structure cards
        if (s.moveType === "NetworkNode") return false;
        if (typeFilter !== "all" && getTypeCategory(s.typeId) !== typeFilter) return false;
        if (statusFilter !== "all" && s.status !== statusFilter) return false;
        return true;
      }),
    [structures, typeFilter, statusFilter],
  );

  // Derive unique network node IDs from structures (stable ref for hook)
  const nodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of structures) {
      if (s.energySourceId) ids.add(s.energySourceId);
      // Owned NetworkNode structures are energy sources themselves
      if (s.moveType === "NetworkNode") ids.add(s.id);
    }
    return Array.from(ids);
  }, [structures]);

  const { nodes: networkNodes, refetch: refetchNodes } = useNetworkNodes(nodeIds);

  // Lookup of NetworkNode AssemblyData by ID (needed by NetworkNodeGroup for online/offline)
  const nodeAssemblyMap = useMemo(() => {
    const map = new Map<string, AssemblyData>();
    for (const s of structures) {
      if (s.moveType === "NetworkNode") map.set(s.id, s);
    }
    return map;
  }, [structures]);

  // Group filtered structures by energySourceId
  const groupedEntries = useMemo(() => {
    if (!groupByNode) return null;
    const map = new Map<string, AssemblyData[]>();
    for (const s of filtered) {
      const key = s.energySourceId ?? UNCONNECTED_KEY;
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    }
    // Sort: named nodes first (alphabetically), then unnamed nodes, then unconnected last
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === UNCONNECTED_KEY) return 1;
      if (b === UNCONNECTED_KEY) return -1;
      const nodeA = networkNodes.get(a);
      const nodeB = networkNodes.get(b);
      const nameA = nodeA?.name || "";
      const nameB = nodeB?.name || "";
      if (nameA && !nameB) return -1;
      if (!nameA && nameB) return 1;
      return nameA.localeCompare(nameB) || a.localeCompare(b);
    });
  }, [filtered, groupByNode, networkNodes]);

  const onlineCount = structures.filter((s) => s.status === "Online").length;
  const offlineCount = structures.filter((s) => s.status !== "Online").length;

  const ssuStructures = structures.filter((s) => getTypeCategory(s.typeId) === "Storage");
  const cormEnabledCount = ssuStructures.filter(hasCormExtension).length;

  // Aggregate energy across all network nodes
  const energyTotals = useMemo(() => {
    let reserved = 0;
    let max = 0;
    for (const node of networkNodes.values()) {
      reserved += node.totalReservedEnergy;
      max += node.maxEnergyProduction;
    }
    return { reserved, max };
  }, [networkNodes]);

  const pageTitle = isOwner
    ? "My Structures"
    : `Structures · ${targetProfile?.name || truncateAddress(targetCharacterId ?? "", 10, 6)}`;

  function handleCopyLink() {
    const url = `${window.location.origin}/structures/${targetCharacterId}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  if (!targetCharacterId) {
    return (
      <Page>
        <Title>Structures</Title>
        <EmptyState title="No character specified" description="Provide a character ID in the URL to view structures." />
      </Page>
    );
  }

  return (
    <Page>
      <Header>
        <TitleRow>
          <Title>{pageTitle}</Title>
          <CopyLinkButton onClick={handleCopyLink} title="Copy shareable link">
            {linkCopied ? "✓ Copied" : "🔗 Copy link"}
          </CopyLinkButton>
        </TitleRow>
      </Header>

      {/* Summary cards */}
      <CollapsibleSummary
        totalCount={structures.length}
        onlineCount={onlineCount}
        offlineCount={offlineCount}
        nodeCount={nodeIds.length}
        energyReserved={energyTotals.reserved}
        energyMax={energyTotals.max}
        cormEnabledCount={cormEnabledCount}
        totalSsuCount={ssuStructures.length}
      />

      {/* Location auth banner (owner-only, before auth) */}
      {isOwner && tribeId && locationAuth === "idle" && (
        <LocationAuthBanner>
          <LocationAuthText>
            Verify your identity to see location data for your structures.
          </LocationAuthText>
          <LocationAuthButton onClick={() => setLocationAuth("prompting")}>
            Show Locations
          </LocationAuthButton>
        </LocationAuthBanner>
      )}

      {/* Auth prompt modal */}
      {locationAuth === "prompting" && (
        <AuthPromptModal
          context="structures"
          onConfirm={handleLocationAuth}
          onCancel={() => setLocationAuth("idle")}
        />
      )}
      {locationAuth === "verifying" && (
        <AuthPromptModal
          context="structures"
          loading
          onConfirm={handleLocationAuth}
          onCancel={() => {}}
        />
      )}

      {/* Filters */}
      <FilterRow>
        {(["all", "Storage", "Gate", "Defense", "Industry", "Core", "Hangar", "Misc"] as AssemblyTypeFilter[]).map((t) => (
          <Tab key={t} $active={typeFilter === t} onClick={() => setTypeFilter(t)}>
            {t === "all" ? "All Types" : t}
          </Tab>
        ))}
        <StatusSelectWrapper>
          <CustomSelect
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as AssemblyStatus | "all")}
            compact
            fullWidth={false}
            options={[
              { value: "all", label: "All Statuses" },
              { value: "Online", label: "Online" },
              { value: "Offline", label: "Offline" },
              { value: "Anchored", label: "Anchored" },
              { value: "Unanchoring", label: "Unanchoring" },
            ]}
          />
        </StatusSelectWrapper>
        <Tab $active={groupByNode} onClick={() => setGroupByNode((v) => !v)}>
          {groupByNode ? "⊞ Grouped" : "☰ Flat"}
        </Tab>
      </FilterRow>

      {/* List */}
      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No structures found"
          description={
            structures.length === 0
              ? isOwner
                ? "You don't own any on-chain structures yet."
                : "This character doesn't own any on-chain structures."
              : "No structures match the current filters."
          }
        />
      ) : groupByNode && groupedEntries ? (
        <div>
          {groupedEntries.map(([key, group]) => (
            <NetworkNodeGroup
              key={key}
              node={
                key === UNCONNECTED_KEY ? null : networkNodes.get(key) ?? null
              }
              assembly={
                key === UNCONNECTED_KEY ? null : nodeAssemblyMap.get(key) ?? null
              }
              structureCount={group.length}
              characterId={isOwner ? myCharacterId : null}
              onRefresh={refetch}
              onRefreshNodes={refetchNodes}
              hasLocation={locationAuth === "authenticated" && key !== UNCONNECTED_KEY && locationIds.has(key)}
              isOwner={isOwner}
            >
              <Grid>
                {group.map((s) => (
              <StructureRow
                    key={s.id}
                    structure={s}
                    characterId={isOwner ? myCharacterId : null}
                    onRefresh={refetch}
                    onRefreshNodes={refetchNodes}
                    selectedSsuId={selectedSsuId}
                    onToggleSelect={setSelectedSsuId}
                    hasLocation={locationAuth === "authenticated" && locationIds.has(s.id)}
                    hasTribeId={locationAuth === "authenticated" && !!tribeId}
                    tlkUnlocked={locationAuth === "authenticated" && !!tlk.tlkBytes}
                    onAddLocation={(id) => setAddLocationForId(id)}
                    isOwner={isOwner}
                  />
                ))}
              </Grid>
            </NetworkNodeGroup>
          ))}
        </div>
      ) : (
        <Grid>
          {filtered.map((s) => (
            <StructureRow
              key={s.id}
              structure={s}
              characterId={isOwner ? myCharacterId : null}
              onRefresh={refetch}
              onRefreshNodes={refetchNodes}
              selectedSsuId={selectedSsuId}
              onToggleSelect={setSelectedSsuId}
              hasLocation={locationAuth === "authenticated" && locationIds.has(s.id)}
              hasTribeId={locationAuth === "authenticated" && !!tribeId}
              tlkUnlocked={locationAuth === "authenticated" && !!tlk.tlkBytes}
              onAddLocation={(id) => setAddLocationForId(id)}
              isOwner={isOwner}
            />
          ))}
        </Grid>
      )}

      {/* Register Location modal (owner-only) */}
      {isOwner && addLocationForId && tribeId && tlk.tlkBytes && tlk.tlkVersion != null && (
        <RegisterLocationModal
          tribeId={tribeId}
          tlkBytes={tlk.tlkBytes}
          tlkVersion={tlk.tlkVersion}
          preselectedStructureId={addLocationForId}
          onClose={() => setAddLocationForId(null)}
          onSuccess={() => {
            refetchLocations();
          }}
        />
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Structure row sub-component
// ---------------------------------------------------------------------------

function StructureRow({
  structure,
  characterId,
  onRefresh,
  onRefreshNodes,
  selectedSsuId,
  onToggleSelect,
  hasLocation,
  hasTribeId,
  tlkUnlocked,
  onAddLocation,
  isOwner = true,
}: {
  structure: AssemblyData;
  characterId: string | null;
  onRefresh: () => void;
  onRefreshNodes: () => void;
  selectedSsuId: string | null;
  onToggleSelect: (id: string | null) => void;
  hasLocation: boolean;
  hasTribeId: boolean;
  tlkUnlocked: boolean;
  onAddLocation: (structureId: string) => void;
  isOwner?: boolean;
}) {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();
  const { energyMap } = useEnergyMap();
  const [pending, setPending] = useState(false);
  const [enablingExt, setEnablingExt] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const userDefinedName = structure.name || "";
  const displayName = userDefinedName || truncateAddress(structure.id, 10, 6);
  const [iconError, setIconError] = useState(false);
  const isSsu = getTypeCategory(structure.typeId) === "Storage";
  const isExpanded = isSsu && selectedSsuId === structure.id;
  const hasCorm = hasCormExtension(structure);

  const canOnline =
    isOwner && structure.status === "Offline" && !!structure.energySourceId && !!characterId;
  const canOffline = isOwner && structure.status === "Online" && !!characterId;

  async function handleToggle(action: "online" | "offline") {
    if (!characterId || !structure.energySourceId) return;
    setPending(true);
    try {
      const builder = action === "online" ? buildOnlineStructure : buildOfflineStructure;
      const tx = builder({
        characterId,
        structureId: structure.id,
        ownerCapId: structure.ownerCapId,
        ownerCapVersion: structure.ownerCapVersion,
        ownerCapDigest: structure.ownerCapDigest,
        networkNodeId: structure.energySourceId,
        energyConfigId: config.energyConfigId,
        moveType: structure.moveType,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
      await signAndExecute({ transaction: tx as any });
      // Allow RPC to reflect the new on-chain state before refetching
      await new Promise((r) => setTimeout(r, 1500));
      onRefresh();
      onRefreshNodes();
    } catch (err) {
      console.error(`Failed to ${action} structure:`, err);
    } finally {
      setPending(false);
    }
  }

  async function handleEnableExtension() {
    if (!characterId) return;
    setEnablingExt(true);
    try {
      // Fetch fresh OwnerCap version/digest to avoid stale Receiving<T> refs
      const capObj = await suiClient.getObject({ id: structure.ownerCapId });
      const tx = buildAuthorizeExtension({
        characterId,
        structureId: structure.id,
        ownerCapId: structure.ownerCapId,
        ownerCapVersion: capObj.data?.version ?? structure.ownerCapVersion,
        ownerCapDigest: capObj.data?.digest ?? structure.ownerCapDigest,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await signAndExecute({ transaction: tx as any });
      await suiClient.waitForTransaction({ digest: result.digest });
      onRefresh();
    } catch (err) {
      console.error("Failed to enable CORM extension:", err);
    } finally {
      setEnablingExt(false);
    }
  }

  return (
    <div>
    <StructureCard
      $clickable={isSsu}
      $expanded={isExpanded}
      onClick={isSsu ? () => onToggleSelect(isExpanded ? null : structure.id) : undefined}
    >
      {!iconError ? (
        <StructureIcon
          src={`/icons/type-${structure.typeId}.png`}
          alt={getTypeLabel(structure.typeId)}
          loading="lazy"
          onError={() => setIconError(true)}
        />
      ) : (
        <StructureIconPlaceholder />
      )}
      <StructureInfo>
        {editing ? (
          <form
            style={{ display: "flex", gap: 4, alignItems: "center" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!characterId || !editValue.trim()) return;
              setSavingName(true);
              try {
                const capObj = await suiClient.getObject({ id: structure.ownerCapId });
                const tx = buildUpdateMetadataName({
                  characterId,
                  structureId: structure.id,
                  ownerCapId: structure.ownerCapId,
                  ownerCapVersion: capObj.data?.version ?? structure.ownerCapVersion,
                  ownerCapDigest: capObj.data?.digest ?? structure.ownerCapDigest,
                  moveType: structure.moveType,
                  name: editValue.trim(),
                });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const result = await signAndExecute({ transaction: tx as any });
                await suiClient.waitForTransaction({ digest: result.digest });
                setEditing(false);
                onRefresh();
              } catch (err) {
                console.error("Failed to save structure name:", err);
              } finally {
                setSavingName(false);
              }
            }}
          >
            <InlineNameInput
              autoFocus
              maxLength={64}
              value={editValue}
              placeholder="Structure name"
              onChange={(e) => setEditValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              disabled={savingName}
            />
            <EditNameButton type="submit" disabled={savingName} onClick={(e) => e.stopPropagation()}>
              {savingName ? "…" : "Save"}
            </EditNameButton>
            <EditNameButton
              type="button"
              onClick={(e) => { e.stopPropagation(); setEditing(false); }}
              disabled={savingName}
            >
              Cancel
            </EditNameButton>
          </form>
        ) : (
          <StructureName>
            {userDefinedName ? <MetadataLabel>{displayName}</MetadataLabel> : displayName}
            {isOwner && characterId && (
              <EditNameButton
                style={{ marginLeft: 6 }}
                title={userDefinedName ? "Rename structure" : "Name this structure"}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditValue(userDefinedName || "");
                  setEditing(true);
                }}
              >
                {userDefinedName ? "✏️" : "+ Name"}
              </EditNameButton>
            )}
          </StructureName>
        )}
        <StructureMeta>
          <CopyableId id={structure.id} asCode />
          {structure.description && ` · ${structure.description}`}
        </StructureMeta>
      </StructureInfo>

      <TagsLeft>
        <TypeBadge>{getTypeLabel(structure.typeId)}</TypeBadge>
        <StatusLabel>
          <StatusDot $status={structure.status} />
          {structure.status}
        </StatusLabel>
        <EnergyIndicator $connected={!!structure.energySourceId}>
          {formatEnergyDisplay(structure.typeId, energyMap)}
        </EnergyIndicator>
      </TagsLeft>

      <TagsRight>
        {isSsu && (
          <ExtensionBadge $enabled={hasCorm}>
            {hasCorm ? "CORM ✓" : "No Extension"}
          </ExtensionBadge>
        )}

        {isOwner && isSsu && !hasCorm && characterId && structure.status !== "Unanchoring" && (
          <ActionButton
            $variant="online"
            disabled={enablingExt}
            title="Authorize CormAuth extension on this SSU"
            onClick={(e) => {
              e.stopPropagation();
              handleEnableExtension();
            }}
          >
            {enablingExt ? "…" : "Enable CORM"}
          </ActionButton>
        )}

        {hasLocation ? (
          <LocationBadge
            to={`/locations?structure=${structure.id}`}
            title="View location"
            onClick={(e) => e.stopPropagation()}
          >
            📍 Location
          </LocationBadge>
        ) : isOwner && hasTribeId ? (
          tlkUnlocked ? (
            <AddLocationButton
              title="Register a location for this structure"
              onClick={(e) => {
                e.stopPropagation();
                onAddLocation(structure.id);
              }}
            >
              + Location
            </AddLocationButton>
          ) : (
            <LocationBadge
              to="/locations"
              title="Unlock TLK on Locations page to register locations"
              onClick={(e) => e.stopPropagation()}
            >
              + Location
            </LocationBadge>
          )
        ) : null}

        {canOnline && (
          <ActionButton
            $variant="online"
            disabled={pending}
            title="Bring this structure online"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle("online");
            }}
          >
            {pending ? "…" : "Online"}
          </ActionButton>
        )}
        {canOffline && (
          <ActionButton
            $variant="offline"
            disabled={pending}
            title="Take this structure offline"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle("offline");
            }}
          >
            {pending ? "…" : "Offline"}
          </ActionButton>
        )}
      </TagsRight>
    </StructureCard>
    {isExpanded && <SsuInventoryPanel ssu={structure} />}
    </div>
  );
}
