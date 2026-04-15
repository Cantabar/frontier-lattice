import { useState, useEffect } from "react";
import styled from "styled-components";
import { Link } from "react-router-dom";
import { useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { CopyableId } from "../shared/CopyableId";
import { buildOnlineStructure, buildOfflineStructure, buildUpdateNetworkNodeUrl, buildUpdateMetadataName, getContinuityUrl } from "../../lib/sui";
import { useIdentity } from "../../hooks/useIdentity";
import { config } from "../../config";
import { truncateAddress } from "../../lib/format";
import type { AssemblyData, AssemblyStatus, NetworkNodeData } from "../../lib/types";

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const GroupContainer = styled.div<{ $accentColor: string }>`
  border-left: 3px solid ${({ $accentColor }) => $accentColor};
  border-radius: ${({ theme }) => theme.radii.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const CardHeader = styled.button<{ $expanded: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  width: 100%;
  padding: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid
    ${({ $expanded, theme }) =>
      $expanded ? theme.colors.primary.subtle : theme.colors.surface.border};
  border-left: none;
  border-radius: ${({ $expanded, theme }) =>
    $expanded
      ? `0 ${theme.radii.md} 0 0`
      : `0 ${theme.radii.md} ${theme.radii.md} 0`};
  color: ${({ theme }) => theme.colors.text.primary};
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: border-color 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
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

const NodeInfo = styled.div`
  flex: 0 1 calc(250px + ${({ theme }) => theme.spacing.md} + 1px);
  min-width: 0;

  @media (max-width: ${({ theme }) => theme.breakpoints.lg}px) {
    flex: 1 1 0%;
  }
`;

const NodeName = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
`;

const InlineNameInput = styled.input`
  font-size: 14px;
  padding: 2px 6px;
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.bg};
  color: ${({ theme }) => theme.colors.text.primary};
  font-family: inherit;
  min-width: 0;
  width: 180px;
`;

const EditNameButton = styled.button`
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  background: transparent;
  color: ${({ theme }) => theme.colors.text.secondary};
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.surface.raised};
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const NodeMeta = styled.div`
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
    flex-wrap: wrap;
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
  color: ${({ theme }) => theme.colors.secondary.accent};
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

const BarGroup = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
`;

const BarOuter = styled.div<{ $width?: number }>`
  width: ${({ $width }) => $width ?? 48}px;
  height: 4px;
  border-radius: 2px;
  background: ${({ theme }) => theme.colors.surface.bg};
  overflow: hidden;
  flex-shrink: 0;
`;

const BarInner = styled.div<{ $pct: number; $invert?: boolean }>`
  height: 100%;
  width: ${({ $pct }) => Math.min($pct, 100)}%;
  border-radius: 2px;
  background: ${({ $pct, $invert, theme }) => {
    const effective = $invert ? $pct : 100 - $pct;
    if (effective > 85) return theme.colors.danger;
    if (effective > 60) return theme.colors.warning;
    return theme.colors.success;
  }};
  transition: width 0.3s ease;
`;

const BarLabel = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  white-space: nowrap;
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

const ConnectedMeta = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  white-space: nowrap;
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


const GroupBody = styled.div<{ $open: boolean }>`
  display: ${({ $open }) => ($open ? "flex" : "none")};
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm} 0 0 ${({ theme }) => theme.spacing.md};
`;

// Unconnected bucket uses the simpler old-style header
const UnconnectedHeader = styled.button`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  width: 100%;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.overlay};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-left: none;
  border-radius: 0 ${({ theme }) => theme.radii.md} ${({ theme }) => theme.radii.md} 0;
  color: ${({ theme }) => theme.colors.text.primary};
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.surface.raised};
  }
`;

const UnconnectedName = styled.span`
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
`;

const Spacer = styled.span`
  flex: 1;
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function accentColorForStatus(status: AssemblyStatus): string {
  switch (status) {
    case "Online":
      return "#69F0AE";
    case "Offline":
      return "#78909C";
    case "Anchored":
      return "#FFD740";
    case "Unanchoring":
      return "#FF5252";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface NetworkNodeGroupProps {
  /** `null` for the "Unconnected" bucket. */
  node: NetworkNodeData | null;
  /** Matching AssemblyData for this network node (null for unconnected bucket). */
  assembly: AssemblyData | null;
  children: React.ReactNode;
  structureCount: number;
  characterId: string | null;
  onRefresh: () => void;
  onRefreshNodes: () => void;
  /** Whether this network node has a registered location POD. */
  hasLocation?: boolean;
  /** Start expanded (default true). */
  defaultOpen?: boolean;
  /** Whether the viewer owns these structures (enables write actions). */
  isOwner?: boolean;
}

export function NetworkNodeGroup({
  node,
  assembly,
  children,
  structureCount,
  characterId,
  onRefresh,
  onRefreshNodes,
  hasLocation = false,
  defaultOpen = true,
  isOwner = true,
}: NetworkNodeGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();
  const { characterId: myCharacterId } = useIdentity();
  const [pending, setPending] = useState(false);
  const [updatingUrl, setUpdatingUrl] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [iconFallback, setIconFallback] = useState<"primary" | "canonical" | "none">("primary");

  // Reset icon fallback state when the node changes
  useEffect(() => {
    setIconFallback("primary");
  }, [node?.id]);

  if (!node) {
    // Unconnected bucket
    return (
      <GroupContainer $accentColor="#78909C">
        <UnconnectedHeader onClick={() => setOpen((o) => !o)}>
          <UnconnectedName>Unconnected</UnconnectedName>
          <ConnectedMeta>{structureCount} structure{structureCount !== 1 ? "s" : ""}</ConnectedMeta>
          <Spacer />
        </UnconnectedHeader>
        <GroupBody $open={open}>{children}</GroupBody>
      </GroupContainer>
    );
  }

  const displayName = node.name || truncateAddress(node.id, 10, 6);
  const accent = accentColorForStatus(node.status);
  const fuelPct =
    node.fuelMaxCapacity > 0
      ? (node.fuelQuantity / node.fuelMaxCapacity) * 100
      : node.fuelQuantity > 0
        ? 100
        : 0;
  const energyPct =
    node.maxEnergyProduction > 0
      ? (node.totalReservedEnergy / node.maxEnergyProduction) * 100
      : 0;

  // A NetworkNode is its own energy source — use its own ID as the networkNodeId.
  const canOnline = isOwner && node.status === "Offline" && !!characterId && !!assembly;
  const canOffline = isOwner && node.status === "Online" && !!characterId && !!assembly;

  // Determine if the metadata URL needs to be set/updated
  const expectedUrl = getContinuityUrl(node.id);
  const urlSynced = node.metadataUrl === expectedUrl;
  const canUpdateUrl = isOwner && !!myCharacterId && !!assembly && !urlSynced;

  async function handleUpdateUrl() {
    if (!myCharacterId || !assembly) return;
    setUpdatingUrl(true);
    try {
      const capObj = await suiClient.getObject({ id: assembly.ownerCapId });
      const tx = buildUpdateNetworkNodeUrl({
        characterId: myCharacterId,
        networkNodeId: assembly.id,
        ownerCapId: assembly.ownerCapId,
        ownerCapVersion: capObj.data?.version ?? assembly.ownerCapVersion,
        ownerCapDigest: capObj.data?.digest ?? assembly.ownerCapDigest,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await signAndExecute({ transaction: tx as any });
      await new Promise((r) => setTimeout(r, 1500));
      onRefreshNodes();
    } catch (err) {
      console.error("Failed to update network node URL:", err);
    } finally {
      setUpdatingUrl(false);
    }
  }

  async function handleRenameName(name: string) {
    if (!myCharacterId || !assembly) return;
    setSavingName(true);
    try {
      const capObj = await suiClient.getObject({ id: assembly.ownerCapId });
      const tx = buildUpdateMetadataName({
        characterId: myCharacterId,
        structureId: assembly.id,
        ownerCapId: assembly.ownerCapId,
        ownerCapVersion: capObj.data?.version ?? assembly.ownerCapVersion,
        ownerCapDigest: capObj.data?.digest ?? assembly.ownerCapDigest,
        moveType: "NetworkNode",
        name,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await signAndExecute({ transaction: tx as any });
      await new Promise((r) => setTimeout(r, 1500));
      setEditing(false);
      onRefreshNodes();
    } catch (err) {
      console.error("Failed to rename network node:", err);
    } finally {
      setSavingName(false);
    }
  }

  async function handleToggle(action: "online" | "offline") {
    if (!characterId || !assembly) return;
    setPending(true);
    try {
      const builder = action === "online" ? buildOnlineStructure : buildOfflineStructure;
      const tx = builder({
        characterId,
        structureId: assembly.id,
        ownerCapId: assembly.ownerCapId,
        ownerCapVersion: assembly.ownerCapVersion,
        ownerCapDigest: assembly.ownerCapDigest,
        networkNodeId: assembly.id, // NetworkNode is its own energy source
        energyConfigId: config.energyConfigId,
        moveType: "NetworkNode",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await signAndExecute({ transaction: tx as any });
      await new Promise((r) => setTimeout(r, 1500));
      onRefresh();
      onRefreshNodes();
    } catch (err) {
      console.error(`Failed to ${action} network node:`, err);
    } finally {
      setPending(false);
    }
  }

  return (
    <GroupContainer $accentColor={accent}>
      <CardHeader $expanded={open} onClick={() => setOpen((o) => !o)}>
        {iconFallback !== "none" && node ? (
          <StructureIcon
            src={
              iconFallback === "primary"
                ? `/icons/type-${node.typeId}.png`
                : `/icons/type-88092.png`
            }
            alt="Network Node"
            loading="lazy"
            onError={() =>
              setIconFallback((prev) => (prev === "primary" ? "canonical" : "none"))
            }
          />
        ) : (
          <StructureIconPlaceholder />
        )}
        <NodeInfo>
          <NodeName>
            {editing ? (
              <form
                style={{ display: "flex", gap: 4, alignItems: "center" }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!editValue.trim()) return;
                  await handleRenameName(editValue.trim());
                }}
              >
                <InlineNameInput
                  autoFocus
                  maxLength={64}
                  value={editValue}
                  placeholder="Node name"
                  onChange={(e) => setEditValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={savingName}
                />
                <EditNameButton type="submit" disabled={savingName} onClick={(e) => e.stopPropagation()}>
                  {savingName ? "…" : "Save"}
                </EditNameButton>
                <EditNameButton
                  type="button"
                  disabled={savingName}
                  onClick={(e) => { e.stopPropagation(); setEditing(false); }}
                >
                  Cancel
                </EditNameButton>
              </form>
            ) : (
              <>
                {displayName}
                {isOwner && myCharacterId && assembly && (
                  <EditNameButton
                    style={{ marginLeft: 6 }}
                    title={node.name ? "Rename network node" : "Name this network node"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditValue(node.name || "");
                      setEditing(true);
                    }}
                  >
                    {node.name ? "✏️" : "+ Name"}
                  </EditNameButton>
                )}
              </>
            )}
          </NodeName>
          <NodeMeta>
            <CopyableId id={node.id} asCode />
          </NodeMeta>
        </NodeInfo>

        <TagsLeft>
          <TypeBadge>Network Node</TypeBadge>
          <StatusLabel>
            <StatusDot $status={node.status} />
            {node.status}
          </StatusLabel>
          <BarGroup>
            <BarLabel>⛽</BarLabel>
            <BarOuter>
              <BarInner $pct={fuelPct} />
            </BarOuter>
          </BarGroup>
          <BarGroup>
            <BarLabel>⚡</BarLabel>
            <BarOuter $width={56}>
              <BarInner $pct={energyPct} $invert />
            </BarOuter>
            <BarLabel>
              {node.totalReservedEnergy} / {node.maxEnergyProduction} GJ
            </BarLabel>
          </BarGroup>
          <ConnectedMeta>
            {node.connectedAssemblyCount} connected · {structureCount} shown
          </ConnectedMeta>
        </TagsLeft>

        <TagsRight>
          {hasLocation ? (
            <LocationBadge
              to={`/locations?structure=${node.id}`}
              title="View location"
              onClick={(e) => e.stopPropagation()}
            >
              📍 Location
            </LocationBadge>
          ) : isOwner ? (
            <LocationBadge
              to="/locations"
              title="Go to Locations page to register a location"
              onClick={(e) => e.stopPropagation()}
            >
              + Location
            </LocationBadge>
          ) : null}
          {canUpdateUrl && (
            <ActionButton
              $variant="online"
              disabled={updatingUrl}
              title="Set on-chain metadata URL to the full-page Continuity Engine link"
              onClick={(e) => {
                e.stopPropagation();
                handleUpdateUrl();
              }}
            >
              {updatingUrl ? "…" : "🔗 Set Link"}
            </ActionButton>
          )}
          {canOnline && (
            <ActionButton
              $variant="online"
              disabled={pending}
              title="Bring this network node online"
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
              title="Take this network node offline"
              onClick={(e) => {
                e.stopPropagation();
                handleToggle("offline");
              }}
            >
              {pending ? "…" : "Offline"}
            </ActionButton>
          )}
        </TagsRight>
      </CardHeader>
      <GroupBody $open={open}>{children}</GroupBody>
    </GroupContainer>
  );
}
