import styled from "styled-components";
import { Drawer } from "../shared/Drawer";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { EmptyState } from "../shared/EmptyState";
import { useSsuInventory } from "../../hooks/useSsuInventory";
import { useItems } from "../../hooks/useItems";
import { truncateAddress } from "../../lib/format";
import { ASSEMBLY_TYPES } from "../../lib/types";
import type { AssemblyData } from "../../lib/types";
import type { InventorySlot, InventoryItemEntry } from "../../hooks/useSsuInventory";

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Section = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.lg};

  &:last-child {
    margin-bottom: 0;
  }
`;

const SectionTitle = styled.h3`
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const CapacityBarOuter = styled.div`
  height: 6px;
  border-radius: 3px;
  background: ${({ theme }) => theme.colors.surface.bg};
  overflow: hidden;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const CapacityBarInner = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => Math.min($pct, 100)}%;
  border-radius: 3px;
  background: ${({ $pct, theme }) =>
    $pct > 90
      ? theme.colors.danger
      : $pct > 70
        ? theme.colors.warning
        : theme.colors.primary.main};
  transition: width 0.3s ease;
`;

const CapacityLabel = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ItemList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const ItemRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.surface.bg};
  border-radius: ${({ theme }) => theme.radii.sm};
`;

const ItemIcon = styled.img`
  width: 28px;
  height: 28px;
  border-radius: ${({ theme }) => theme.radii.sm};
  object-fit: contain;
  flex-shrink: 0;
`;

const ItemIconPlaceholder = styled.div`
  width: 28px;
  height: 28px;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.border};
  flex-shrink: 0;
`;

const ItemInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const ItemName = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ItemMeta = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const ItemQty = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
`;

const ErrorText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.danger};
  padding: ${({ theme }) => theme.spacing.md};
`;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CapacityBar({ used, max }: { used: number; max: number }) {
  const pct = max > 0 ? (used / max) * 100 : 0;
  return (
    <>
      <CapacityBarOuter>
        <CapacityBarInner $pct={pct} />
      </CapacityBarOuter>
      <CapacityLabel>
        {used.toLocaleString()} / {max.toLocaleString()} capacity ({pct.toFixed(1)}%)
      </CapacityLabel>
    </>
  );
}

function InventoryItemRow({ item }: { item: InventoryItemEntry }) {
  const { getItem } = useItems();
  const info = getItem(item.typeId);

  return (
    <ItemRow>
      {info?.icon ? <ItemIcon src={`/${info.icon}`} alt={info.name} /> : <ItemIconPlaceholder />}
      <ItemInfo>
        <ItemName>{info?.name ?? `Type ${item.typeId}`}</ItemName>
        <ItemMeta>
          ID {item.typeId} · {item.volume} m³ each
        </ItemMeta>
      </ItemInfo>
      <ItemQty>×{item.quantity.toLocaleString()}</ItemQty>
    </ItemRow>
  );
}

function SlotSection({ slot }: { slot: InventorySlot }) {
  const label =
    slot.kind === "owner"
      ? "Owner Inventory"
      : slot.kind === "open"
        ? "Open Storage"
        : `Player Inventory (${truncateAddress(slot.key)})`;

  return (
    <Section>
      <SectionTitle>{label}</SectionTitle>
      <CapacityBar used={slot.usedCapacity} max={slot.maxCapacity} />
      {slot.items.length === 0 ? (
        <EmptyState title="Empty" description="No items in this inventory." />
      ) : (
        <ItemList>
          {slot.items.map((item) => (
            <InventoryItemRow key={item.typeId} item={item} />
          ))}
        </ItemList>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Main drawer
// ---------------------------------------------------------------------------

interface Props {
  ssu: AssemblyData;
  onClose: () => void;
}

export function SsuInventoryDrawer({ ssu, onClose }: Props) {
  const { slots, isLoading, error } = useSsuInventory(ssu.id, ssu.ownerCapId);
  const typeLabel = ASSEMBLY_TYPES[ssu.typeId]?.label ?? "Storage Unit";
  const displayName = ssu.name || truncateAddress(ssu.id, 10, 6);

  return (
    <Drawer title={`${displayName} — ${typeLabel}`} onClose={onClose}>
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
        slots.map((slot) => <SlotSection key={slot.key} slot={slot} />)
      )}
    </Drawer>
  );
}
