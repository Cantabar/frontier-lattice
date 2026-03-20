import { useState, useMemo, useEffect } from "react";
import styled from "styled-components";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { useMyStructures } from "../hooks/useStructures";
import { useNetworkNodes } from "../hooks/useNetworkNodes";
import { useIdentity } from "../hooks/useIdentity";
import { useStructureLocationIds } from "../hooks/useStructureLocationIds";
import { useTlkStatus } from "../hooks/useTlkStatus";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import { SsuInventoryPanel } from "../components/structures/SsuInventoryPanel";
import { NetworkNodeGroup } from "../components/structures/NetworkNodeGroup";
import { RegisterLocationModal } from "../components/locations/RegisterLocationModal";
import { buildOnlineStructure, buildOfflineStructure } from "../lib/sui";
import { config } from "../config";
import { truncateAddress } from "../lib/format";
import { CopyableId } from "../components/shared/CopyableId";
import { ASSEMBLY_TYPES } from "../lib/types";
import type { AssemblyData, AssemblyTypeFilter, AssemblyStatus } from "../lib/types";

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

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const ConnectPrompt = styled.div`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xxl};
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 16px;
`;

const SummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const SummaryCard = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
`;

const CardLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const CardValue = styled.div`
  font-size: 20px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
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

const StatusSelect = styled.select`
  background: ${({ theme }) => theme.colors.surface.raised};
  color: ${({ theme }) => theme.colors.text.secondary};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  font-weight: 600;
  margin-left: auto;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
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
  flex: 1;
  min-width: 0;
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

const TypeBadge = styled.span`
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.secondary.accentMuted};
  color: ${({ theme }) => theme.colors.secondary.accent};
  white-space: nowrap;
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
`;

const EnergyIndicator = styled.span<{ $connected: boolean }>`
  font-size: 11px;
  color: ${({ $connected, theme }) =>
    $connected ? theme.colors.success : theme.colors.text.muted};
`;

const LocationBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary.main};
  white-space: nowrap;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

export function MyStructuresPage() {
  const account = useCurrentAccount();
  const { characterId, tribeCaps } = useIdentity();
  const tribeId = tribeCaps[0]?.tribeId ?? null;
  const { structures, isLoading, refetch } = useMyStructures();
  const { locationIds, refetch: refetchLocations } = useStructureLocationIds();
  const tlk = useTlkStatus();
  const [addLocationForId, setAddLocationForId] = useState<string | null>(null);

  // Fetch TLK status when tribe is known
  useEffect(() => {
    if (tribeId) tlk.fetchStatus(tribeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tribeId]);

  const [typeFilter, setTypeFilter] = useState<AssemblyTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<AssemblyStatus | "all">("all");
  const [selectedSsuId, setSelectedSsuId] = useState<string | null>(null);
  const [groupByNode, setGroupByNode] = useState(true);

  const filtered = useMemo(
    () =>
      structures.filter((s) => {
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
    }
    return Array.from(ids);
  }, [structures]);

  const { nodes: networkNodes, refetch: refetchNodes } = useNetworkNodes(nodeIds);

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

  if (!account) {
    return (
      <Page>
        <Title>My Structures</Title>
        <ConnectPrompt>Connect your wallet to view your structures.</ConnectPrompt>
      </Page>
    );
  }

  return (
    <Page>
      <Header>
        <Title>My Structures</Title>
      </Header>

      {/* Summary cards */}
      <SummaryGrid>
        <SummaryCard>
          <CardLabel>Total</CardLabel>
          <CardValue>{structures.length}</CardValue>
        </SummaryCard>
        <SummaryCard>
          <CardLabel>Online</CardLabel>
          <CardValue>{onlineCount}</CardValue>
        </SummaryCard>
        <SummaryCard>
          <CardLabel>Offline</CardLabel>
          <CardValue>{offlineCount}</CardValue>
        </SummaryCard>
        <SummaryCard>
          <CardLabel>Nodes</CardLabel>
          <CardValue>{nodeIds.length}</CardValue>
        </SummaryCard>
        <SummaryCard>
          <CardLabel>Energy</CardLabel>
          <CardValue>
            {energyTotals.reserved} / {energyTotals.max} GJ
          </CardValue>
        </SummaryCard>
      </SummaryGrid>

      {/* Filters */}
      <FilterRow>
        {(["all", "Storage", "Gate", "Defense", "Industry", "Core", "Hangar", "Misc"] as AssemblyTypeFilter[]).map((t) => (
          <Tab key={t} $active={typeFilter === t} onClick={() => setTypeFilter(t)}>
            {t === "all" ? "All Types" : t}
          </Tab>
        ))}
        <StatusSelect
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AssemblyStatus | "all")}
        >
          <option value="all">All Statuses</option>
          <option value="Online">Online</option>
          <option value="Offline">Offline</option>
          <option value="Anchored">Anchored</option>
          <option value="Unanchoring">Unanchoring</option>
        </StatusSelect>
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
              ? "You don't own any on-chain structures yet."
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
              structureCount={group.length}
            >
              <Grid>
                {group.map((s) => (
              <StructureRow
                    key={s.id}
                    structure={s}
                    characterId={characterId}
                    onRefresh={refetch}
                    onRefreshNodes={refetchNodes}
                    selectedSsuId={selectedSsuId}
                    onToggleSelect={setSelectedSsuId}
                    hasLocation={locationIds.has(s.id)}
                    hasTribeId={!!tribeId}
                    tlkUnlocked={!!tlk.tlkBytes}
                    onAddLocation={(id) => setAddLocationForId(id)}
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
              characterId={characterId}
              onRefresh={refetch}
              onRefreshNodes={refetchNodes}
              selectedSsuId={selectedSsuId}
              onToggleSelect={setSelectedSsuId}
              hasLocation={locationIds.has(s.id)}
              hasTribeId={!!tribeId}
              tlkUnlocked={!!tlk.tlkBytes}
              onAddLocation={(id) => setAddLocationForId(id)}
            />
          ))}
        </Grid>
      )}

      {/* Register Location modal */}
      {addLocationForId && tribeId && tlk.tlkBytes && tlk.tlkVersion != null && (
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
}) {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [pending, setPending] = useState(false);
  const displayName = structure.name || truncateAddress(structure.id, 10, 6);
  const [iconError, setIconError] = useState(false);
  const isSsu = getTypeCategory(structure.typeId) === "Storage";
  const isExpanded = isSsu && selectedSsuId === structure.id;

  const canOnline =
    structure.status === "Offline" && !!structure.energySourceId && !!characterId;
  const canOffline = structure.status === "Online" && !!characterId;

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
        <StructureName>{displayName}</StructureName>
        <StructureMeta>
          <CopyableId id={structure.id} asCode />
          {structure.description && ` · ${structure.description}`}
        </StructureMeta>
      </StructureInfo>

      <TypeBadge>{getTypeLabel(structure.typeId)}</TypeBadge>

      <StatusLabel>
        <StatusDot $status={structure.status} />
        {structure.status}
      </StatusLabel>

      <EnergyIndicator $connected={!!structure.energySourceId}>
        {structure.energySourceId ? "⚡ Connected" : "— No energy"}
      </EnergyIndicator>

      {hasLocation ? (
        <LocationBadge title="Location POD registered">📍 Location</LocationBadge>
      ) : hasTribeId ? (
        <AddLocationButton
          disabled={!tlkUnlocked}
          title={tlkUnlocked ? "Register a location for this structure" : "Unlock TLK on Locations page first"}
          onClick={(e) => {
            e.stopPropagation();
            onAddLocation(structure.id);
          }}
        >
          + Location
        </AddLocationButton>
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
    </StructureCard>
    {isExpanded && <SsuInventoryPanel ssu={structure} />}
    </div>
  );
}
