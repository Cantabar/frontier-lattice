import React, { useState } from "react";
import styled from "styled-components";
import type { SsuCanvasCard, CanvasPort } from "../../../lib/buildCanvasLayout";
import type { ItemEntry } from "../../../hooks/useItems";

/* ── Quantity formatting ──────────────────────────────────────── */

function fmtQty(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString();
}

/* ── Styled components ────────────────────────────────────────── */

const SSU_COLOR = "#00E5FF"; // electric cyan — matches primary

const Card = styled.div`
  position: absolute;
  width: 260px;
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.primary.subtle};
  border-top: 2px solid ${SSU_COLOR};
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
  margin-top: -4px;
  z-index: 1;
`;

const Dot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${SSU_COLOR};
  border: 1px solid ${({ theme }) => theme.colors.surface.raised};
  flex-shrink: 0;
  position: relative;
  z-index: 2;
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

const ItemIconPlaceholder = styled.div`
  width: 28px;
  height: 28px;
  background: ${({ theme }) => theme.colors.surface.overlay};
  border-radius: 2px;
`;

const QtyLabel = styled.span`
  font-size: 9px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-align: center;
  white-space: nowrap;
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
  align-items: center;
  gap: 10px;
`;

const SsuLabel = styled.div``;

const SsuTitle = styled.span`
  font-size: 13px;
  font-weight: 700;
  color: ${SSU_COLOR};
  display: block;
`;

const SsuSub = styled.span`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.text.muted};
  display: block;
  margin-top: 2px;
`;

const SsuIconBox = styled.div`
  width: 32px;
  height: 32px;
  background: ${({ theme }) => theme.colors.primary.subtle};
  border: 1px solid ${({ theme }) => theme.colors.primary.main}44;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
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
  text-align: center;
  line-height: 1.4;
`;

/* ── Port icon with hover ─────────────────────────────────────── */

function SsuPortIcon({
  port,
  cardId,
  getItem,
}: {
  port: CanvasPort;
  cardId: string;
  getItem: (typeId: number) => ItemEntry | undefined;
}) {
  const [hovered, setHovered] = useState(false);
  const item = getItem(port.typeId);
  const dotId = `${cardId}:out:${port.typeId}`;

  return (
    <PortCell
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <Tooltip>
          {item?.name ?? `#${port.typeId}`}
          <br />
          {fmtQty(port.totalQty)} (from SSU)
        </Tooltip>
      )}
      <Dot data-dotid={dotId} />
      {item?.icon ? (
        <ItemIcon src={item.icon} alt={item.name} $hovered={hovered} />
      ) : (
        <ItemIconPlaceholder />
      )}
      <QtyLabel>{fmtQty(port.totalQty)}</QtyLabel>
    </PortCell>
  );
}

/* ── SsuCard ──────────────────────────────────────────────────── */

interface Props {
  card: SsuCanvasCard;
  getItem: (typeId: number) => ItemEntry | undefined;
  style?: React.CSSProperties;
  dimmed?: boolean;
  focused?: boolean;
  onCardPointerEnter?: () => void;
  onCardPointerLeave?: () => void;
  onCardClick?: () => void;
}

export function SsuCard({ card, getItem, style, dimmed, focused, onCardPointerEnter, onCardPointerLeave, onCardClick }: Props) {
  return (
    <Card
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
      <PortSection>
        {card.outputs.map((port) => (
          <SsuPortIcon key={port.typeId} port={port} cardId={card.id} getItem={getItem} />
        ))}
      </PortSection>

      <Divider />

      <Center>
        <SsuIconBox>⬡</SsuIconBox>
        <SsuLabel>
          <SsuTitle>SSU</SsuTitle>
          <SsuSub>Inventory</SsuSub>
        </SsuLabel>
      </Center>
    </Card>
  );
}
