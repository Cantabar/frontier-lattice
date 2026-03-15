import { useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { EmptyState } from "../shared/EmptyState";
import { PortalTooltip } from "../shared/PortalTooltip";
import { ResolvedCharacterDisplay } from "../shared/CharacterDisplay";
import { useSsuInventory } from "../../hooks/useSsuInventory";
import { useCharacterProfiles } from "../../hooks/useCharacterProfile";
import { useItems } from "../../hooks/useItems";
import type { AssemblyData, CharacterProfile } from "../../lib/types";
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

/** Vertical stack of collapsible inventory sections */
const SlotsStack = styled.div`
  display: flex;
  flex-direction: column;
`;

const SlotHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  height: 28px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  padding: ${({ theme }) => theme.spacing.xs} 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.surface.border};

  &:hover {
    color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const Chevron = styled.span<{ $open: boolean }>`
  display: inline-block;
  font-size: 10px;
  transition: transform 0.15s;
  transform: rotate(${({ $open }) => ($open ? "90deg" : "0deg")});
  color: ${({ theme }) => theme.colors.text.muted};
`;

const SectionTitle = styled.h3`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.muted};
  white-space: nowrap;
`;

/** Return a theme-aware color for a capacity percentage. */
function capacityColor(pct: number, theme: { colors: { danger: string; warning: string; primary: { main: string } } }) {
  if (pct > 90) return theme.colors.danger;
  if (pct > 70) return theme.colors.warning;
  return theme.colors.primary.main;
}

const OverallCapacityRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const CapacityBarOuter = styled.div<{ $height?: number }>`
  flex: 1;
  height: ${({ $height }) => $height ?? 8}px;
  background: ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  overflow: hidden;
`;

const CapacityBarFill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => Math.min($pct, 100)}%;
  background: ${({ $pct, theme }) => capacityColor($pct, theme)};
  border-radius: ${({ theme }) => theme.radii.sm};
  transition: width 0.3s ease;
`;

const CapacityLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  white-space: nowrap;
`;

/** Wrapping grid of item tiles */
const ItemGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.xs};
  padding: ${({ theme }) => theme.spacing.xs} 0;
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
  const tileRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  return (
    <ItemTile
      ref={tileRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {info?.icon ? <TileIcon src={`/${info.icon}`} alt={name} /> : <TileIconPlaceholder />}
      <QtyBadge>{item.quantity.toLocaleString()}</QtyBadge>
      <PortalTooltip targetRef={tileRef} visible={hovered}>
        <TooltipName>{name}</TooltipName>
        <TooltipMeta>
          ID {item.typeId} · {info?.volume ?? item.volume} m³ · ×{item.quantity.toLocaleString()}
        </TooltipMeta>
      </PortalTooltip>
    </ItemTile>
  );
}

function SlotSection({ slot, profile }: { slot: InventorySlot; profile?: CharacterProfile | null }) {
  const [open, setOpen] = useState(true);
  const pct = slot.maxCapacity > 0 ? (slot.usedCapacity / slot.maxCapacity) * 100 : 0;

  const label =
    slot.kind === "owner"
      ? "Owner"
      : slot.kind === "open"
        ? "Open"
        : null;

  return (
    <div>
      <SlotHeader onClick={() => setOpen((v) => !v)}>
        <Chevron $open={open}>▶</Chevron>
        {label ? (
          <SectionTitle>{label}</SectionTitle>
        ) : (
          <ResolvedCharacterDisplay
            characterId={slot.key}
            profile={profile ?? null}
            size="sm"
          />
        )}
        <CapacityBarOuter $height={5}>
          <CapacityBarFill $pct={pct} />
        </CapacityBarOuter>
        <CapacityLabel>
          {slot.usedCapacity.toLocaleString()} / {slot.maxCapacity.toLocaleString()} m³
        </CapacityLabel>
      </SlotHeader>
      {open && (
        slot.items.length === 0 ? (
          <EmptySlotLabel>Empty</EmptySlotLabel>
        ) : (
          <ItemGrid>
            {slot.items.map((item) => (
              <InventoryItemTile key={item.typeId} item={item} />
            ))}
          </ItemGrid>
        )
      )}
    </div>
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

  // Batch-resolve character profiles for player ("other") inventory slots
  const otherKeys = useMemo(
    () => slots.filter((s) => s.kind === "other").map((s) => s.key),
    [slots],
  );
  const { profiles } = useCharacterProfiles(otherKeys);

  // Overall SSU capacity totals
  const totalUsed = useMemo(() => slots.reduce((sum, s) => sum + s.usedCapacity, 0), [slots]);
  const totalMax = useMemo(() => slots.reduce((sum, s) => sum + s.maxCapacity, 0), [slots]);
  const totalPct = totalMax > 0 ? (totalUsed / totalMax) * 100 : 0;

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
        <OverallCapacityRow>
          <CapacityBarOuter $height={8}>
            <CapacityBarFill $pct={totalPct} />
          </CapacityBarOuter>
          <CapacityLabel>
            {totalUsed.toLocaleString()} / {totalMax.toLocaleString()} m³ ({totalPct.toFixed(0)}%)
          </CapacityLabel>
        </OverallCapacityRow>
        <SlotsStack>
          {slots.map((slot) => (
            <SlotSection
              key={slot.key}
              slot={slot}
              profile={slot.kind === "other" ? profiles.get(slot.key) : undefined}
            />
          ))}
        </SlotsStack>
        </>
      )}
    </PanelWrapper>
  );
}
