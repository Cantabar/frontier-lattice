import React, { useState } from "react";
import styled from "styled-components";
import type { BlueprintCanvasCard, CanvasPort } from "../../../lib/buildCanvasLayout";
import type { ItemEntry } from "../../../hooks/useItems";

/* ── Tier color ───────────────────────────────────────────────── */

const TIER_COLOR: Record<string, string> = {
  Basic: "#666666",
  Standard: "#b0b0b0",
  Enhanced: "#4caf50",
  Prototype: "#42a5f5",
  Experimental: "#ab47bc",
  Exotic: "#ffd740",
};

function tierColor(tier: string | null | undefined): string {
  return TIER_COLOR[tier ?? ""] ?? "#2D3038";
}

/* ── Quantity formatting ──────────────────────────────────────── */

function fmtQty(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return n.toLocaleString();
  return n.toLocaleString();
}

function portLabel(port: CanvasPort): string {
  if (port.runs <= 1) return fmtQty(port.totalQty);
  return `${fmtQty(port.totalQty)} (${port.runs}×${fmtQty(port.perRunQty)})`;
}

/* ── Styled components ────────────────────────────────────────── */

const Card = styled.div<{ $tierColor: string }>`
  position: absolute;
  width: 260px;
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ $tierColor }) => $tierColor}66;
  border-top: 2px solid ${({ $tierColor }) => $tierColor};
  border-bottom: 2px solid ${({ $tierColor }) => $tierColor};
  display: flex;
  flex-direction: column;
  user-select: none;
`;

const PortSection = styled.div`
  display: flex;
  justify-content: space-around;
  align-items: flex-start;
  padding: 0 8px;
  position: relative;
`;

const PortCell = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  position: relative;
  min-width: 44px;
  z-index: 1;
`;

const Dot = styled.div<{ $color: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
  border: 1px solid ${({ theme }) => theme.colors.surface.raised};
  flex-shrink: 0;
  cursor: crosshair;
  position: relative;
  z-index: 2;
`;

const TopPortSection = styled(PortSection)`
  padding-top: 0;
  padding-bottom: 4px;
  & ${PortCell} {
    flex-direction: column;
    padding-top: 0;
    margin-top: -4px; /* pull dots flush to top edge */
  }
`;

const BottomPortSection = styled(PortSection)`
  padding-top: 4px;
  padding-bottom: 0;
  & ${PortCell} {
    flex-direction: column-reverse;
    padding-bottom: 0;
    margin-bottom: -4px; /* pull dots flush to bottom edge */
  }
`;

const ItemIcon = styled.img<{ $hovered: boolean }>`
  width: 28px;
  height: 28px;
  object-fit: contain;
  border-radius: 2px;
  transition: filter 0.12s, transform 0.12s;
  filter: ${({ $hovered }) => ($hovered ? "brightness(1.4)" : "brightness(0.9)")};
  transform: ${({ $hovered }) => ($hovered ? "scale(1.15)" : "scale(1)")};
`;

const QtyLabel = styled.span`
  font-size: 9px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-align: center;
  white-space: nowrap;
  line-height: 1.2;
  max-width: 58px;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Divider = styled.div`
  height: 1px;
  background: ${({ theme }) => theme.colors.surface.border};
  margin: 0 8px;
`;

const Center = styled.div`
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
`;

const BlueprintIcon = styled.img`
  width: 36px;
  height: 36px;
  object-fit: contain;
`;

const BlueprintIconPlaceholder = styled.div`
  width: 36px;
  height: 36px;
  background: ${({ theme }) => theme.colors.surface.overlay};
  border-radius: 2px;
`;

const BlueprintName = styled.span`
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  line-height: 1.3;
  word-break: break-word;
`;

const FacilityRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
`;

const FacilityBadge = styled.span`
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.muted};
  background: ${({ theme }) => theme.colors.surface.overlay};
  padding: 1px 5px;
  border-radius: 2px;
`;

const TierBadge = styled.span<{ $color: string }>`
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: ${({ $color }) => $color};
  border: 1px solid ${({ $color }) => $color}66;
  padding: 1px 4px;
  border-radius: 2px;
`;

const Tooltip = styled.div`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: ${({ theme }) => theme.colors.surface.overlay};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: 2px;
  padding: 4px 8px;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
  pointer-events: none;
  z-index: 100;
  max-width: 200px;
  text-align: center;
  line-height: 1.4;
`;

/* ── Port cell with hover + tooltip ──────────────────────────── */

function PortIcon({
  port,
  direction,
  cardId,
  getItem,
  dotColor,
}: {
  port: CanvasPort;
  direction: "in" | "out";
  cardId: string;
  getItem: (typeId: number) => ItemEntry | undefined;
  dotColor: string;
}) {
  const [hovered, setHovered] = useState(false);
  const item = getItem(port.typeId);
  const dotId = `${cardId}:${direction}:${port.typeId}`;

  return (
    <PortCell
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <Tooltip>
          {item?.name ?? `#${port.typeId}`}
          <br />
          {portLabel(port)}
        </Tooltip>
      )}
      <Dot
        $color={dotColor}
        data-dotid={dotId}
      />
      {item?.icon ? (
        <ItemIcon src={item.icon} alt={item.name} $hovered={hovered} />
      ) : (
        <BlueprintIconPlaceholder />
      )}
      <QtyLabel>{portLabel(port)}</QtyLabel>
    </PortCell>
  );
}

/* ── BlueprintCard ────────────────────────────────────────────── */

interface Props {
  card: BlueprintCanvasCard;
  getItem: (typeId: number) => ItemEntry | undefined;
  style?: React.CSSProperties;
  dimmed?: boolean;
  focused?: boolean;
  onCardPointerEnter?: () => void;
  onCardPointerLeave?: () => void;
  onCardClick?: () => void;
}

export function BlueprintCard({ card, getItem, style, dimmed, focused, onCardPointerEnter, onCardPointerLeave, onCardClick }: Props) {
  const tier = card.blueprintEntry?.primaryMetaGroupName ?? null;
  const color = tierColor(tier);
  const primaryItem = getItem(card.blueprintEntry?.primaryTypeId ?? card.blueprintId);

  return (
    <Card
      $tierColor={color}
      style={{
        ...style,
        opacity: dimmed ? 0.2 : 1,
        transition: "opacity 0.15s ease, outline 0.1s ease",
        outline: focused ? "2px solid rgba(255,255,255,0.55)" : "none",
        outlineOffset: "3px",
        pointerEvents: dimmed ? "none" : undefined,
      }}
      data-cardid={card.id}
      onPointerEnter={onCardPointerEnter}
      onPointerLeave={onCardPointerLeave}
      onClick={onCardClick}
    >
      {/* Output ports — top edge */}
      <TopPortSection>
        {card.outputs.map((port) => (
          <PortIcon
            key={port.typeId}
            port={port}
            direction="out"
            cardId={card.id}
            getItem={getItem}
            dotColor={color}
          />
        ))}
      </TopPortSection>

      <Divider />

      {/* Center: blueprint icon + name + facility */}
      <Center>
        {card.blueprintEntry?.primaryIcon ? (
          <BlueprintIcon
            src={card.blueprintEntry.primaryIcon}
            alt={card.blueprintEntry.primaryName}
          />
        ) : primaryItem?.icon ? (
          <BlueprintIcon src={primaryItem.icon} alt={primaryItem.name} />
        ) : (
          <BlueprintIconPlaceholder />
        )}
        <BlueprintName>
          {card.blueprintEntry?.primaryName ?? primaryItem?.name ?? `Blueprint #${card.blueprintId}`}
        </BlueprintName>
        <FacilityRow>
          <FacilityBadge>{card.facilityName}</FacilityBadge>
          {tier && <TierBadge $color={color}>{tier}</TierBadge>}
        </FacilityRow>
      </Center>

      <Divider />

      {/* Input ports — bottom edge */}
      <BottomPortSection>
        {card.inputs.map((port) => (
          <PortIcon
            key={port.typeId}
            port={port}
            direction="in"
            cardId={card.id}
            getItem={getItem}
            dotColor={color}
          />
        ))}
      </BottomPortSection>
    </Card>
  );
}
