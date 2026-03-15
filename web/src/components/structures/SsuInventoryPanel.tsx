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
  padding: ${({ theme }) => theme.spacing.xl} ${({ theme }) => theme.spacing.md}
    ${({ theme }) => theme.spacing.sm};
`;

const ScrollArea = styled.div`
  overflow-x: auto;
  overflow-y: clip;
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

  &:hover {
    outline: 2px solid ${({ theme }) => theme.colors.primary.main};
  }

  &:hover > div:last-child {
    opacity: 1;
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

const Tooltip = styled.div`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: ${({ theme }) => theme.colors.surface.overlay};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
  z-index: 10;
`;

const TooltipName = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const TooltipMeta = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.text.muted};
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
// Sub-components
// ---------------------------------------------------------------------------

function InventoryItemTile({ item }: { item: InventoryItemEntry }) {
  const { getItem } = useItems();
  const info = getItem(item.typeId);
  const name = info?.name ?? `Type ${item.typeId}`;

  return (
    <ItemTile>
      {info?.icon ? <TileIcon src={`/${info.icon}`} alt={name} /> : <TileIconPlaceholder />}
      <QtyBadge>{item.quantity.toLocaleString()}</QtyBadge>
      <Tooltip>
        <TooltipName>{name}</TooltipName>
        <TooltipMeta>
          ID {item.typeId} · {item.volume} m³ · ×{item.quantity.toLocaleString()}
        </TooltipMeta>
      </Tooltip>
    </ItemTile>
  );
}

function SlotSection({ slot }: { slot: InventorySlot }) {
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
            <InventoryItemTile key={item.typeId} item={item} />
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
        <ScrollArea>
          <SlotsRow>
            {slots.map((slot) => <SlotSection key={slot.key} slot={slot} />)}
          </SlotsRow>
        </ScrollArea>
      )}
    </PanelWrapper>
  );
}
