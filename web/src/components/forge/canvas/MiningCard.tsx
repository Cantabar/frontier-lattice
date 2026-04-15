import React, { useState } from "react";
import styled from "styled-components";
import type { MiningCanvasCard } from "../../../lib/buildCanvasLayout";
import type { ItemEntry } from "../../../hooks/useItems";

/* ── Formatting ───────────────────────────────────────────────── */

function fmtQty(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString();
}

/* ── Constants ────────────────────────────────────────────────── */

const MINING_COLOR = "#FFD740"; // amber — "mine this"

/* ── Styled components ────────────────────────────────────────── */

const Card = styled.div`
  position: absolute;
  width: 160px;
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${MINING_COLOR}44;
  border-top: 2px solid ${MINING_COLOR};
  display: flex;
  flex-direction: column;
  user-select: none;
`;

const PortSection = styled.div`
  display: flex;
  justify-content: center;
  padding: 0 8px;
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
  background: ${MINING_COLOR};
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
  filter: ${({ $hovered }) => ($hovered ? "brightness(1.5)" : "brightness(1)")};
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
`;

const Divider = styled.div`
  height: 1px;
  background: ${({ theme }) => theme.colors.surface.border};
  margin: 0 8px;
`;

const Center = styled.div`
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  text-align: center;
`;

const MiningLabel = styled.span`
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${MINING_COLOR};
`;

const OreName = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  line-height: 1.3;
  word-break: break-word;
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
`;

/* ── MiningCard ───────────────────────────────────────────────── */

interface Props {
  card: MiningCanvasCard;
  getItem: (typeId: number) => ItemEntry | undefined;
  style?: React.CSSProperties;
  dimmed?: boolean;
  focused?: boolean;
  onCardPointerEnter?: () => void;
  onCardPointerLeave?: () => void;
  onCardClick?: () => void;
}

export function MiningCard({ card, getItem, style, dimmed, focused, onCardPointerEnter, onCardPointerLeave, onCardClick }: Props) {
  const [hovered, setHovered] = useState(false);
  const item = getItem(card.typeId);
  const dotId = `${card.id}:out:${card.typeId}`;

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
      {/* Single output port — top edge */}
      <PortSection>
        <PortCell
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {hovered && (
            <Tooltip>
              {item?.name ?? `#${card.typeId}`}
              <br />
              {fmtQty(card.totalQty)} needed
            </Tooltip>
          )}
          <Dot data-dotid={dotId} />
          {item?.icon ? (
            <ItemIcon src={item.icon} alt={item?.name} $hovered={hovered} />
          ) : (
            <ItemIconPlaceholder />
          )}
          <QtyLabel>{fmtQty(card.totalQty)}</QtyLabel>
        </PortCell>
      </PortSection>

      <Divider />

      <Center>
        <MiningLabel>⛏ Mining</MiningLabel>
        <OreName>{item?.name ?? `Item #${card.typeId}`}</OreName>
      </Center>
    </Card>
  );
}
