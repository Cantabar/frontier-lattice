import { useState, useCallback } from "react";
import styled from "styled-components";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { EmptyState } from "../shared/EmptyState";
import { useSsuInventory } from "../../hooks/useSsuInventory";
import { useItems } from "../../hooks/useItems";
import { truncateAddress } from "../../lib/format";
import type { AssemblyData } from "../../lib/types";
import type { InventorySlot, InventoryItemEntry } from "../../hooks/useSsuInventory";

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const PanelWrapper = styled.div`
  background: ${({ theme }) => theme.colors.surface.overlay};
  border: 1px solid ${({ theme }) => theme.colors.primary.subtle};
  border-top: none;
  border-radius: 0 0 ${({ theme }) => theme.radii.md} ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
`;

const HoverBar = styled.div`
  display: flex;
  align-items: baseline;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.xs} 0;
  min-height: 20px;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const HoverName = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const HoverMeta = styled.span`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const HoverHint = styled.span`
  font-size: 10px;
  font-style: italic;
  color: ${({ theme }) => theme.colors.text.disabled};
`;

const ScrollArea = styled.div`
  overflow-x: auto;
`;

/** Horizontal strip of inventory slots */
const SlotsRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  min-width: min-content;
`;

const SlotColumn = styled.div`
  flex-shrink: 0;
`;

const SlotHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const SectionTitle = styled.h3`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.muted};
  white-space: nowrap;
`;

const CapacityBadge = styled.span<{ $pct: number }>`
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
  background: ${({ $pct, theme }) =>
    $pct > 90
      ? theme.colors.danger
      : $pct > 70
        ? theme.colors.warning
        : theme.colors.primary.subtle};
  color: ${({ $pct, theme }) =>
    $pct > 90
      ? theme.colors.text.primary
      : $pct > 70
        ? theme.colors.surface.bg
        : theme.colors.primary.muted};
`;

/** Wrapping grid of item tiles */
const ItemGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const ItemTile = styled.div`
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.bg};
  cursor: default;
  transition: outline-color 0.1s;
  outline: 2px solid transparent;

  &:hover {
    outline-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const TileIcon = styled.img`
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: ${({ theme }) => theme.radii.sm};
`;

const TileIconPlaceholder = styled.div`
  width: 100%;
  height: 100%;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.border};
`;

const QtyBadge = styled.span`
  position: absolute;
  bottom: 1px;
  right: 2px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  color: ${({ theme }) => theme.colors.text.primary};
  text-shadow: 0 0 3px ${({ theme }) => theme.colors.surface.bg},
    0 0 3px ${({ theme }) => theme.colors.surface.bg};
`;

const EmptySlotLabel = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.disabled};
  padding: ${({ theme }) => theme.spacing.xs} 0;
`;

const ErrorText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.danger};
  padding: ${({ theme }) => theme.spacing.sm};
`;

// ---------------------------------------------------------------------------
// Hover info
// ---------------------------------------------------------------------------

interface HoveredItem {
  name: string;
  typeId: number;
  volume: number;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InventoryItemTile({
  item,
  onHover,
}: {
  item: InventoryItemEntry;
  onHover: (info: HoveredItem | null) => void;
}) {
  const { getItem } = useItems();
  const info = getItem(item.typeId);
  const name = info?.name ?? `Type ${item.typeId}`;

  return (
    <ItemTile
      onMouseEnter={() => onHover({ name, typeId: item.typeId, volume: item.volume, quantity: item.quantity })}
      onMouseLeave={() => onHover(null)}
    >
      {info?.icon ? <TileIcon src={`/${info.icon}`} alt={name} /> : <TileIconPlaceholder />}
      <QtyBadge>{item.quantity.toLocaleString()}</QtyBadge>
    </ItemTile>
  );
}

function SlotSection({
  slot,
  onHover,
}: {
  slot: InventorySlot;
  onHover: (info: HoveredItem | null) => void;
}) {
  const label =
    slot.kind === "owner"
      ? "Owner"
      : slot.kind === "open"
        ? "Open"
        : truncateAddress(slot.key);
  const pct = slot.maxCapacity > 0 ? (slot.usedCapacity / slot.maxCapacity) * 100 : 0;

  return (
    <SlotColumn>
      <SlotHeader>
        <SectionTitle>{label}</SectionTitle>
        <CapacityBadge $pct={pct}>{pct.toFixed(0)}%</CapacityBadge>
      </SlotHeader>
      {slot.items.length === 0 ? (
        <EmptySlotLabel>Empty</EmptySlotLabel>
      ) : (
        <ItemGrid>
          {slot.items.map((item) => (
            <InventoryItemTile key={item.typeId} item={item} onHover={onHover} />
          ))}
        </ItemGrid>
      )}
    </SlotColumn>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface Props {
  ssu: AssemblyData;
}

export function SsuInventoryPanel({ ssu }: Props) {
  const { slots, isLoading, error } = useSsuInventory(ssu.id, ssu.ownerCapId);
  const [hovered, setHovered] = useState<HoveredItem | null>(null);
  const onHover = useCallback((info: HoveredItem | null) => setHovered(info), []);

  return (
    <PanelWrapper>
      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorText>Failed to load inventory: {error.message}</ErrorText>
      ) : slots.length === 0 ? (
        <EmptyState
          title="No inventory data"
          description="This SSU has no readable inventory slots."
        />
      ) : (
        <>
          <HoverBar>
            {hovered ? (
              <>
                <HoverName>{hovered.name}</HoverName>
                <HoverMeta>
                  ID {hovered.typeId} · {hovered.volume} m³ · ×{hovered.quantity.toLocaleString()}
                </HoverMeta>
              </>
            ) : (
              <HoverHint>Hover an item for details</HoverHint>
            )}
          </HoverBar>
          <ScrollArea>
            <SlotsRow>
              {slots.map((slot) => <SlotSection key={slot.key} slot={slot} onHover={onHover} />)}
            </SlotsRow>
          </ScrollArea>
        </>
      )}
    </PanelWrapper>
  );
}
