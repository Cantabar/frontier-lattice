import React, { useRef, useLayoutEffect, useState, useCallback, useMemo } from "react";
import styled from "styled-components";
import type { CanvasLayout, CanvasCard } from "../../../lib/buildCanvasLayout";
import { buildEdgeIndex } from "../../../lib/buildCanvasLayout";
import type { ItemEntry } from "../../../hooks/useItems";
import type { StructureState } from "../../../lib/types";
import { BlueprintCard } from "./BlueprintCard";
import { SsuCard } from "./SsuCard";
import { MiningCard } from "./MiningCard";
import { CanvasSelectionProvider, useCanvasSelection } from "./CanvasSelectionContext";
import {
  routeEdges,
  cardBoxesFromLayout,
  type Belt,
  type Point,
} from "../../../lib/canvasBusRouter";

/* ── Layout constants ─────────────────────────────────────────── */

const CARD_WIDTH_BP = 260;
const CARD_WIDTH_SIMPLE = 160; // SSU and Mining cards
/** Conservative card-height estimate used for row bounds passed to the
 *  belt router.  Actual rendered cards may be shorter; this only affects
 *  the y-position of the band edges where belts run, which has slack. */
const ESTIMATED_CARD_HEIGHT = 200;

const ROW_SLOT_HEIGHT = 340; // generous vertical spacing between rows
const CANVAS_PAD_TOP = 100;
const CANVAS_PAD_BOTTOM = 100;
const CANVAS_PAD_RIGHT = 100;

/** Canvas-absolute X of the main bus's leftmost lane (lane 0). */
const MAIN_BUS_LEFT_X = 60;
/** Reserved horizontal width for the main bus + clearance from cards.
 *  Up to ~12 lanes fit in 100px at 8px lane spacing. */
const MAIN_BUS_RESERVED_WIDTH = 100;
/** Left padding so the leftmost card sits clear of the main bus. */
const CANVAS_PAD_LEFT = MAIN_BUS_LEFT_X + MAIN_BUS_RESERVED_WIDTH + 20;

/* ── Card dimension helpers ──────────────────────────────────── */

function cardWidth(card: CanvasCard): number {
  return card.kind === "blueprint" ? CARD_WIDTH_BP : CARD_WIDTH_SIMPLE;
}

/** Compute total pixel width of a row of cards (for centering). */
function rowPixelWidth(cards: CanvasCard[]): number {
  if (cards.length === 0) return 0;
  return cards.reduce((sum, c, i) => sum + cardWidth(c) + (i < cards.length - 1 ? 40 : 0), 0);
}

/* ── Styled components ────────────────────────────────────────── */

const Outer = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.surface.bg};
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
`;

const Inner = styled.div`
  position: absolute;
  transform-origin: 0 0;
`;

const CardLayer = styled.div`
  position: relative;
`;

const EdgeSvg = styled.svg`
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: visible;
`;

/* ── Transform type ───────────────────────────────────────────── */

export interface CanvasTransform {
  tx: number;
  ty: number;
  scale: number;
}

/* ── Props ───────────────────────────────────────────────────── */

interface Props {
  layout: CanvasLayout;
  getItem: (typeId: number) => ItemEntry | undefined;
  transform: CanvasTransform;
  onTransformChange: (t: CanvasTransform) => void;
  /** Per-facilityTypeId structure availability states for indicator display. */
  structureStates?: Map<number, StructureState>;
}

/* ── BuildCanvas (provider wrapper) ─────────────────────────── */

export function BuildCanvas(props: Props) {
  return (
    <CanvasSelectionProvider>
      <BuildCanvasContent {...props} />
    </CanvasSelectionProvider>
  );
}

/* ── BuildCanvasContent (inner — consumes selection context) ─── */

function BuildCanvasContent({ layout, getItem, transform, onTransformChange, structureStates }: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [dotPositions, setDotPositions] = useState<Map<string, Point>>(new Map());

  const { focusedCardId, onCardPointerEnter, onCardPointerLeave, onCardClick, onBackgroundClick } =
    useCanvasSelection();

  /* ── Content dimensions, card positions, and per-row Y bounds ── */

  const { contentWidth, contentHeight, cardPositions, rowBounds } = useMemo(() => {
    if (layout.totalRows === 0) {
      return {
        contentWidth: 0,
        contentHeight: 0,
        cardPositions: new Map<string, { left: number; top: number }>(),
        rowBounds: [] as Array<{ top: number; bottom: number }>,
      };
    }

    const maxRowWidth = Math.max(...layout.rows.map(rowPixelWidth), 0);
    const cw = Math.max(maxRowWidth + CANVAS_PAD_LEFT + CANVAS_PAD_RIGHT, 600);
    const ch = layout.totalRows * ROW_SLOT_HEIGHT + CANVAS_PAD_TOP + CANVAS_PAD_BOTTOM;

    const positions = new Map<string, { left: number; top: number }>();
    const bounds: Array<{ top: number; bottom: number }> = new Array(layout.totalRows);

    // ── Build adjacentAlignments: sourceCardId → consumerCardId ──────────────
    // For each adjacent-row edge, one source per consumer is elected "primary"
    // and will be positioned directly below its consumer (same center X).
    // Selection: first unclaimed source (col-ascending) for each consumer,
    // processed top-down so each source claims only one consumer.

    const cardById = new Map<string, CanvasCard>();
    for (const row of layout.rows)
      for (const card of row)
        cardById.set(card.id, card);

    // Collect adjacent sources per consumer (deduplicated by sourceId).
    const edgesByConsumer = new Map<string, string[]>(); // consumerId → [sourceId]
    for (const edge of layout.edges) {
      const src = cardById.get(edge.fromCardId);
      const dst = cardById.get(edge.toCardId);
      if (!src || !dst || dst.row !== src.row + 1) continue;
      const arr = edgesByConsumer.get(edge.toCardId) ?? [];
      if (!arr.includes(edge.fromCardId)) arr.push(edge.fromCardId);
      edgesByConsumer.set(edge.toCardId, arr);
    }

    // Process consumers top-down, left-to-right within each row.
    const adjacentAlignments = new Map<string, string>(); // sourceId → consumerCardId
    const primaryConsumed = new Set<string>();

    for (let r = layout.rows.length - 1; r >= 0; r--) {
      for (const consumer of layout.rows[r]) {
        if (primaryConsumed.has(consumer.id)) continue;
        const sources = edgesByConsumer.get(consumer.id) ?? [];
        const sorted = [...sources].sort((a, b) => {
          const ca = cardById.get(a);
          const cb = cardById.get(b);
          return (ca?.col ?? 0) - (cb?.col ?? 0);
        });
        for (const srcId of sorted) {
          if (!adjacentAlignments.has(srcId)) {
            adjacentAlignments.set(srcId, consumer.id);
            primaryConsumed.add(consumer.id);
            break;
          }
        }
      }
    }

    // ── Per-row position assignment (top-down) ────────────────────────────────
    // Process from the topmost row (highest rowIdx) downward so consumer
    // positions are known before source preferred-X is computed.

    for (let rowIdx = layout.rows.length - 1; rowIdx >= 0; rowIdx--) {
      const row = layout.rows[rowIdx];
      const rowTop = CANVAS_PAD_TOP + (layout.totalRows - 1 - rowIdx) * ROW_SLOT_HEIGHT;
      bounds[rowIdx] = { top: rowTop, bottom: rowTop + ESTIMATED_CARD_HEIGHT };

      if (row.length === 0) continue;

      // Compute preferred left-X for each card.
      const preferred: (number | null)[] = row.map((card) => {
        const consumerId = adjacentAlignments.get(card.id);
        if (!consumerId) return null;
        const consumerPos = positions.get(consumerId);
        const consumerCard = cardById.get(consumerId);
        if (!consumerPos || !consumerCard) return null;
        const consumerCenter = consumerPos.left + cardWidth(consumerCard) / 2;
        return consumerCenter - cardWidth(card) / 2;
      });

      const hasAnyPreference = preferred.some((p) => p !== null);

      if (!hasAnyPreference) {
        // No alignment targets — center the row as before.
        const rw = rowPixelWidth(row);
        const availableWidth = cw - CANVAS_PAD_LEFT - CANVAS_PAD_RIGHT;
        let x = CANVAS_PAD_LEFT + Math.max(0, (availableWidth - rw) / 2);
        for (const card of row) {
          positions.set(card.id, { left: x, top: rowTop });
          x += cardWidth(card) + 40;
        }
        continue;
      }

      // Build sweep order: preferred cards sorted by preferred X, with
      // null-preference cards interleaved at their original column position
      // (between the preferred cards they originally sat between).
      // Appending null-pref cards at the far right causes larger overflow,
      // which shifts the whole row left and destroys adjacent-tier alignment.
      const indexed = row.map((card, i) => ({ card, origIdx: i, pref: preferred[i] }));
      const withPref = indexed.filter(({ pref }) => pref !== null).sort((a, b) => a.pref! - b.pref!);
      const nullPref = indexed.filter(({ pref }) => pref === null).sort((a, b) => a.origIdx - b.origIdx);
      const sweepOrder: typeof indexed = [];
      let ni = 0;
      for (const item of withPref) {
        while (ni < nullPref.length && nullPref[ni].origIdx < item.origIdx)
          sweepOrder.push(nullPref[ni++]);
        sweepOrder.push(item);
      }
      while (ni < nullPref.length) sweepOrder.push(nullPref[ni++]);

      // Left-to-right sweep: place each card at max(preferred, prevRight + gap).
      let cursor = CANVAS_PAD_LEFT;
      const placed: Array<{ card: CanvasCard; left: number }> = [];
      for (const { card, pref } of sweepOrder) {
        const w = cardWidth(card);
        const idealLeft = pref ?? cursor;
        const left = Math.max(idealLeft, cursor);
        placed.push({ card, left });
        cursor = left + w + 40;
      }

      // Clamp: if row overflows the canvas, shift everything left.
      const last = placed[placed.length - 1];
      const rightEdge = last.left + cardWidth(last.card);
      const maxRight = cw - CANVAS_PAD_RIGHT;
      if (rightEdge > maxRight) {
        const shift = rightEdge - maxRight;
        for (const p of placed) p.left = Math.max(CANVAS_PAD_LEFT, p.left - shift);
      }

      for (const { card, left } of placed) {
        positions.set(card.id, { left, top: rowTop });
      }
    }

    return { contentWidth: cw, contentHeight: ch, cardPositions: positions, rowBounds: bounds };
  }, [layout]);

  /* ── Measure dot positions after render ── */

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner || contentWidth === 0) return;

    const innerRect = inner.getBoundingClientRect();
    const dots = inner.querySelectorAll<HTMLElement>("[data-dotid]");
    const positions = new Map<string, Point>();

    for (const dot of dots) {
      const rect = dot.getBoundingClientRect();
      positions.set(dot.dataset.dotid!, {
        x: (rect.left - innerRect.left + rect.width / 2) / transform.scale,
        y: (rect.top - innerRect.top + rect.height / 2) / transform.scale,
      });
    }

    setDotPositions(positions);
  }, [layout, contentWidth, transform.scale]);

  /* ── Plan belts via the bus router ── */

  const belts = useMemo<Belt[]>(() => {
    if (rowBounds.length === 0 || dotPositions.size === 0) return [];

    const cards = cardBoxesFromLayout(layout.rows, cardPositions, (card) => ({
      width: cardWidth(card),
      height: ESTIMATED_CARD_HEIGHT,
    }));

    const result = routeEdges({
      edges: layout.edges,
      cards,
      dotPositions,
      rowBounds,
      mainBusLeftX: MAIN_BUS_LEFT_X,
    });
    return result.belts;
  }, [layout, cardPositions, dotPositions, rowBounds]);

  /* ── Edge adjacency index + connected belt set ── */

  const edgeIndex = useMemo(() => buildEdgeIndex(layout.edges), [layout.edges]);

  const adjacentCardIds = useMemo(() => {
    if (!focusedCardId) return null;
    return edgeIndex.get(focusedCardId) ?? new Set<string>();
  }, [focusedCardId, edgeIndex]);

  const connectedBeltIds = useMemo(() => {
    if (!focusedCardId) return null;

    // Build lookup: "sourceCardId:typeId" → Set<destCardId>
    // Use a set so bundles with multiple consumers all get highlighted when any
    // one of their consumers is focused.
    const edgeDests = new Map<string, Set<string>>();
    for (const edge of layout.edges) {
      const key = `${edge.fromCardId}:${edge.fromTypeId}`;
      if (!edgeDests.has(key)) edgeDests.set(key, new Set());
      edgeDests.get(key)!.add(edge.toCardId);
    }

    const connected = new Set<string>();
    for (const belt of belts) {
      if (belt.sourceCardId === focusedCardId) {
        connected.add(belt.id);
        continue;
      }
      const destCardIds = edgeDests.get(`${belt.sourceCardId}:${belt.typeId}`);
      if (destCardIds?.has(focusedCardId)) connected.add(belt.id);
    }
    return connected;
  }, [focusedCardId, belts, layout.edges]);

  /* ── Pan ── */

  const panState = useRef<{ startX: number; startY: number; startTx: number; startTy: number } | null>(null);
  const didDragRef = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only pan when clicking directly on the outer/inner background (not on cards)
      if ((e.target as HTMLElement).closest("[data-cardid]")) return;
      didDragRef.current = false;
      e.preventDefault();
      panState.current = {
        startX: e.clientX,
        startY: e.clientY,
        startTx: transform.tx,
        startTy: transform.ty,
      };
    },
    [transform.tx, transform.ty],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!panState.current) return;
      const dx = e.clientX - panState.current.startX;
      const dy = e.clientY - panState.current.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didDragRef.current = true;
      onTransformChange({ ...transform, tx: panState.current.startTx + dx, ty: panState.current.startTy + dy });
    },
    [transform, onTransformChange],
  );

  const onMouseUp = useCallback(() => {
    const wasPanning = panState.current !== null;
    panState.current = null;
    if (wasPanning && !didDragRef.current) {
      onBackgroundClick();
    }
  }, [onBackgroundClick]);

  const onMouseLeave = useCallback(() => {
    panState.current = null;
    // Do not fire onBackgroundClick when mouse leaves the canvas area
  }, []);

  /* ── Zoom ── */

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const outer = outerRef.current;
      if (!outer) return;

      const outerRect = outer.getBoundingClientRect();
      const cursorX = e.clientX - outerRect.left;
      const cursorY = e.clientY - outerRect.top;

      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.min(2.5, Math.max(0.2, transform.scale * zoomFactor));

      // Zoom towards cursor position
      const newTx = cursorX - (cursorX - transform.tx) * (newScale / transform.scale);
      const newTy = cursorY - (cursorY - transform.ty) * (newScale / transform.scale);

      onTransformChange({ tx: newTx, ty: newTy, scale: newScale });
    },
    [transform, onTransformChange],
  );

  /* ── Render cards ── */

  const renderedCards = useMemo(() => {
    const elements: React.ReactElement[] = [];

    for (const row of layout.rows) {
      for (const card of row) {
        const pos = cardPositions.get(card.id);
        if (!pos) continue;

        const style: React.CSSProperties = { left: pos.left, top: pos.top };
        const dimmed =
          focusedCardId !== null &&
          focusedCardId !== card.id &&
          !adjacentCardIds?.has(card.id);
        const focused = focusedCardId === card.id;

        if (card.kind === "blueprint") {
          const facilityTypeId = card.blueprintEntry?.facilities[0]?.facilityTypeId;
          const structureState =
            facilityTypeId != null ? structureStates?.get(facilityTypeId) : undefined;
          elements.push(
            <BlueprintCard
              key={card.id}
              card={card}
              getItem={getItem}
              style={style}
              dimmed={dimmed}
              focused={focused}
              structureState={structureState}
              onCardPointerEnter={() => onCardPointerEnter(card.id)}
              onCardPointerLeave={() => onCardPointerLeave(card.id)}
              onCardClick={() => onCardClick(card.id)}
            />,
          );
        } else if (card.kind === "ssu") {
          elements.push(
            <SsuCard
              key={card.id}
              card={card}
              getItem={getItem}
              style={style}
              dimmed={dimmed}
              focused={focused}
              onCardPointerEnter={() => onCardPointerEnter(card.id)}
              onCardPointerLeave={() => onCardPointerLeave(card.id)}
              onCardClick={() => onCardClick(card.id)}
            />,
          );
        } else {
          elements.push(
            <MiningCard
              key={card.id}
              card={card}
              getItem={getItem}
              style={style}
              dimmed={dimmed}
              focused={focused}
              onCardPointerEnter={() => onCardPointerEnter(card.id)}
              onCardPointerLeave={() => onCardPointerLeave(card.id)}
              onCardClick={() => onCardClick(card.id)}
            />,
          );
        }
      }
    }

    return elements;
  }, [layout, cardPositions, getItem, focusedCardId, adjacentCardIds, structureStates, onCardPointerEnter, onCardPointerLeave, onCardClick]);

  /* ── Render belts as orthogonal polylines ── */

  const beltElements = useMemo(() => {
    const casings: React.ReactElement[] = [];
    const fills: React.ReactElement[] = [];

    for (const belt of belts) {
      if (belt.segments.length === 0) continue;

      // Flatten belt segments into a single polyline points string.
      const pts: string[] = [];
      pts.push(`${belt.segments[0].from.x},${belt.segments[0].from.y}`);
      for (const seg of belt.segments) {
        pts.push(`${seg.to.x},${seg.to.y}`);
      }
      const pointsStr = pts.join(" ");
      const dimBelt = connectedBeltIds !== null && !connectedBeltIds.has(belt.id);
      const opacity = dimBelt ? 0.08 : 0.85;

      const sharedProps = {
        points: pointsStr,
        fill: "none" as const,
        strokeLinecap: "square" as const,
        strokeLinejoin: "miter" as const,
        style: { transition: "stroke-opacity 0.15s ease" },
      };

      // Pass 1 — dark casing (wider, renders first so fills paint over it)
      casings.push(
        <polyline
          key={`${belt.id}:casing`}
          {...sharedProps}
          stroke="#111111"
          strokeWidth={5}
          strokeOpacity={opacity}
        />,
      );

      // Pass 2 — colored fill
      fills.push(
        <polyline
          key={`${belt.id}:fill`}
          {...sharedProps}
          stroke={belt.color}
          strokeWidth={3}
          strokeOpacity={opacity}
        />,
      );
    }

    // Render all casings before all fills: wherever belt A crosses belt B,
    // A's dark casing paints on top of B's colored fill, communicating depth.
    return [...casings, ...fills];
  }, [belts, connectedBeltIds]);

  return (
    <Outer
      ref={outerRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onWheel={onWheel}
    >
      <Inner
        ref={innerRef}
        style={{
          width: contentWidth,
          height: contentHeight,
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
        }}
      >
        <CardLayer style={{ width: contentWidth, height: contentHeight }}>
          {renderedCards}
        </CardLayer>
        <EdgeSvg
          width={contentWidth}
          height={contentHeight}
          style={{ width: contentWidth, height: contentHeight }}
        >
          {beltElements}
        </EdgeSvg>
      </Inner>
    </Outer>
  );
}
