import { useState } from "react";
import styled from "styled-components";
import { truncateAddress } from "../../lib/format";
import type { AssemblyStatus, NetworkNodeData } from "../../lib/types";

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const GroupContainer = styled.div<{ $accentColor: string }>`
  border-left: 3px solid ${({ $accentColor }) => $accentColor};
  border-radius: ${({ theme }) => theme.radii.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const GroupHeader = styled.button`
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

const NodeName = styled.span`
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const NodeMeta = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  white-space: nowrap;
`;

const StatusDot = styled.span<{ $status: AssemblyStatus }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
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
    // When $invert is true, higher % = worse (energy load)
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

const Spacer = styled.span`
  flex: 1;
`;

const Chevron = styled.span<{ $open: boolean }>`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  transition: transform 0.2s;
  transform: rotate(${({ $open }) => ($open ? "90deg" : "0deg")});
  flex-shrink: 0;
`;

const GroupBody = styled.div<{ $open: boolean }>`
  display: ${({ $open }) => ($open ? "flex" : "none")};
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm} 0 0 ${({ theme }) => theme.spacing.md};
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function accentColorForStatus(status: AssemblyStatus): string {
  switch (status) {
    case "Online":
      return "#69F0AE"; // theme.colors.success
    case "Offline":
      return "#78909C"; // theme.colors.text.muted
    case "Anchored":
      return "#FFD740"; // theme.colors.warning
    case "Unanchoring":
      return "#FF5252"; // theme.colors.danger
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface NetworkNodeGroupProps {
  /** `null` for the "Unconnected" bucket. */
  node: NetworkNodeData | null;
  children: React.ReactNode;
  structureCount: number;
  /** Start expanded (default true). */
  defaultOpen?: boolean;
}

export function NetworkNodeGroup({
  node,
  children,
  structureCount,
  defaultOpen = true,
}: NetworkNodeGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (!node) {
    // Unconnected bucket
    return (
      <GroupContainer $accentColor="#78909C">
        <GroupHeader onClick={() => setOpen((o) => !o)}>
          <NodeName>Unconnected</NodeName>
          <NodeMeta>{structureCount} structure{structureCount !== 1 ? "s" : ""}</NodeMeta>
          <Spacer />
          <Chevron $open={open}>▶</Chevron>
        </GroupHeader>
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

  return (
    <GroupContainer $accentColor={accent}>
      <GroupHeader onClick={() => setOpen((o) => !o)}>
        <StatusDot $status={node.status} />
        <NodeName>{displayName}</NodeName>
        <NodeMeta>{node.status}</NodeMeta>
        <NodeMeta>·</NodeMeta>
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
        <NodeMeta>
          {node.connectedAssemblyCount} connected · {structureCount} shown
        </NodeMeta>
        <Spacer />
        <Chevron $open={open}>▶</Chevron>
      </GroupHeader>
      <GroupBody $open={open}>{children}</GroupBody>
    </GroupContainer>
  );
}
