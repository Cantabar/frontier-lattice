/**
 * canvasBusRouter — plans orthogonal "conveyor belt" paths for the Build
 * Canvas.  Replaces bezier curves with a main-bus + tributary + offshoot
 * manifold where every segment is axis-aligned (no diagonals).
 *
 * Routing model:
 *   1. Belt leaves a source card's output dot going UP.
 *   2. Turns LEFT at a tributary Y within the mid-gap band just above the
 *      source row, runs horizontally to the main bus on the left of the
 *      canvas.
 *   3. Travels UP the main bus (vertical channel) to an offshoot Y within
 *      the mid-gap band just below the consumer row.
 *   4. Turns RIGHT along the offshoot, runs horizontally to the consumer's
 *      input column.
 *   5. Turns UP, enters the consumer's input dot.
 *
 * Adjacent-layer routing (consumer exactly one row above source):
 *   All edges from the same (sourceCardId, typeId) in the same gap band are
 *   grouped into a single bundle belt.  The bundle uses one horizontal rail
 *   lane in the gap band's lower half (same pool as tributary lanes).  From
 *   the rail, vertical branches reach each consumer input port wherever the
 *   rail vertically aligns with that port.
 *
 *   Bundle structure:
 *     source → UP (trunk) → railY → HORIZONTAL (rail) → consumerX → UP (branch) → consumer
 *
 * Each belt is `(sourceCardId, fromTypeId)` — multiple edges from the same
 * output port share color.
 *
 * All lanes are 8px apart.  Lane assignment is interval-coloring: belts get
 * the smallest free lane across their spatial extent.
 */

import type { CanvasEdge, CanvasCard } from "./buildCanvasLayout";

/* ── Types ────────────────────────────────────────────────────── */

export interface Point {
  x: number;
  y: number;
}

export interface OrthoSegment {
  from: Point;
  to: Point;
}

export interface Belt {
  id: string;
  color: string;
  typeId: number;
  sourceCardId: string;
  segments: OrthoSegment[];
}

interface CardBox {
  id: string;
  row: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RouterInput {
  edges: CanvasEdge[];
  cards: CardBox[];
  dotPositions: Map<string, Point>;
  /** Each row's (top, bottom) absolute Y coordinates. Length === totalRows. */
  rowBounds: Array<{ top: number; bottom: number }>;
  /** Canvas-absolute X at which the main bus's leftmost lane lives. */
  mainBusLeftX: number;
}

export interface RouterOutput {
  belts: Belt[];
  /** Per-gap lane counts — caller uses this to grow row spacing if needed. */
  gapLaneCounts: Array<{
    tributaryLanes: number;
    offshootLanes: number;
    directRailLanes: number;
  }>;
  /** Number of lanes consumed on the main bus. */
  mainBusLaneCount: number;
}

/* ── Constants ────────────────────────────────────────────────── */

export const LANE_SPACING = 8;
/** Distance between the band's edge and the first lane in it. */
const BAND_EDGE_PAD = 6;
/** Minimum separation (px) between tributary and offshoot lane groups
 *  within a single mid-gap band. */
const TRIB_OFFSHOOT_GAP = 6;

/**
 * 20 visually-distinct belt colors, chosen to avoid collision with:
 *   - tier border colors (#666, #b0b0b0, #4caf50, #42a5f5, #ab47bc, #ffd740)
 *   - SSU electric cyan (#00E5FF)
 *   - mining amber (#FFD740)
 */
const BELT_PALETTE = [
  "#FF6B6B", "#4ECDC4", "#A78BFA", "#F59E0B", "#10B981",
  "#3B82F6", "#EC4899", "#14B8A6", "#F97316", "#8B5CF6",
  "#06B6D4", "#EAB308", "#F43F5E", "#6366F1", "#22C55E",
  "#D946EF", "#84CC16", "#0EA5E9", "#A855F7", "#EF4444",
];

export function beltColor(beltId: string): string {
  let h = 0;
  for (let i = 0; i < beltId.length; i++) {
    h = (h * 31 + beltId.charCodeAt(i)) | 0;
  }
  return BELT_PALETTE[Math.abs(h) % BELT_PALETTE.length];
}

/* ── Internal structures ──────────────────────────────────────── */

interface PlannedBelt {
  id: string;
  sourceCardId: string;
  consumerCardId: string;
  typeId: number;
  sourceRow: number;
  consumerRow: number;
  sourceDot: Point;
  consumerDot: Point;
  /** Tributary band index (== sourceRow), offshoot band index (== consumerRow - 1). */
  tribBandIdx: number;
  offshootBandIdx: number;
  /** Assigned lanes (non-direct only). */
  tribLane: number;
  offshootLane: number;
  mainBusLane: number;
  /** True when consumer is exactly one row above source — routed as a bundle
   *  through the shared gap band, bypassing the main bus. */
  isDirect: boolean;
  /** Rail lane assigned to this belt's bundle (direct only). */
  directRailLane: number;
}

/** A group of adjacent-layer edges from the same (sourceCardId, typeId) that
 *  share one horizontal rail lane in the gap band. */
interface DirectBundle {
  key: string;
  sourceCardId: string;
  typeId: number;
  tribBandIdx: number;
  sourceDot: Point;
  consumers: { consumerCardId: string; consumerDot: Point }[];
  railLane: number;
  /** [minX, maxX] spanning source dot and all consumer dots. */
  range: [number, number];
}

/* ── Lane allocators ──────────────────────────────────────────── */

/**
 * Greedy interval coloring.  Each item has a 1-D range; assign the smallest
 * lane index such that no already-assigned item in that lane overlaps.
 * Stable: items are processed in input order.
 */
function assignLanes<T extends { range: [number, number]; lane?: number }>(
  items: T[],
): number {
  // lanes[laneIdx] = list of assigned ranges
  const lanes: Array<Array<[number, number]>> = [];

  for (const it of items) {
    const [lo, hi] = it.range;
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      const taken = lanes[i];
      if (!taken.some(([a, b]) => !(hi < a || lo > b))) {
        taken.push([lo, hi]);
        it.lane = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes.push([[lo, hi]]);
      it.lane = lanes.length - 1;
    }
  }

  return lanes.length;
}

/* ── Main router ──────────────────────────────────────────────── */

export function routeEdges(input: RouterInput): RouterOutput {
  const { edges, cards, dotPositions, rowBounds, mainBusLeftX } = input;

  const cardById = new Map<string, CardBox>();
  for (const c of cards) cardById.set(c.id, c);

  // ── Plan belts ──
  // One belt per edge.  Sort edges so lane assignment is stable: by
  // (sourceRow, sourceCol, typeId, consumerRow, consumerCol).
  const planned: PlannedBelt[] = [];

  const sortedEdges = [...edges].sort((a, b) => {
    const sa = cardById.get(a.fromCardId);
    const sb = cardById.get(b.fromCardId);
    const ca = cardById.get(a.toCardId);
    const cb = cardById.get(b.toCardId);
    if (!sa || !sb || !ca || !cb) return 0;
    if (sa.row !== sb.row) return sa.row - sb.row;
    if (sa.left !== sb.left) return sa.left - sb.left;
    if (a.fromTypeId !== b.fromTypeId) return a.fromTypeId - b.fromTypeId;
    if (ca.row !== cb.row) return ca.row - cb.row;
    return ca.left - cb.left;
  });

  for (const edge of sortedEdges) {
    const src = cardById.get(edge.fromCardId);
    const dst = cardById.get(edge.toCardId);
    if (!src || !dst) continue;

    const sourceDot = dotPositions.get(`${edge.fromCardId}:out:${edge.fromTypeId}`);
    const consumerDot = dotPositions.get(`${edge.toCardId}:in:${edge.toTypeId}`);
    if (!sourceDot || !consumerDot) continue;

    // Safety: only upward-flowing edges are routable (consumer row > source row).
    if (dst.row <= src.row) continue;

    planned.push({
      id: `${edge.fromCardId}:${edge.fromTypeId}:${edge.toCardId}`,
      sourceCardId: edge.fromCardId,
      consumerCardId: edge.toCardId,
      typeId: edge.fromTypeId,
      sourceRow: src.row,
      consumerRow: dst.row,
      sourceDot,
      consumerDot,
      tribBandIdx: src.row,        // band between row src.row and row src.row+1
      offshootBandIdx: dst.row - 1, // band between row dst.row-1 and row dst.row
      tribLane: 0,
      offshootLane: 0,
      mainBusLane: 0,
      isDirect: dst.row === src.row + 1,
      directRailLane: 0,
    });
  }

  // ── Build direct bundles per band ──
  // Group adjacent-layer planned belts by (sourceCardId, typeId) so they share
  // one horizontal rail lane instead of occupying N separate lanes.
  const gapCount = rowBounds.length > 0 ? rowBounds.length - 1 : 0;
  const bundlesByBand = new Map<number, Map<string, DirectBundle>>();
  for (let i = 0; i < gapCount; i++) bundlesByBand.set(i, new Map());

  for (const b of planned) {
    if (!b.isDirect) continue;
    const bandMap = bundlesByBand.get(b.tribBandIdx)!;
    const key = `${b.sourceCardId}:${b.typeId}`;
    if (!bandMap.has(key)) {
      bandMap.set(key, {
        key,
        sourceCardId: b.sourceCardId,
        typeId: b.typeId,
        tribBandIdx: b.tribBandIdx,
        sourceDot: b.sourceDot,
        consumers: [],
        railLane: 0,
        range: [b.sourceDot.x, b.sourceDot.x],
      });
    }
    const bundle = bandMap.get(key)!;
    bundle.consumers.push({ consumerCardId: b.consumerCardId, consumerDot: b.consumerDot });
    bundle.range[0] = Math.min(bundle.range[0], b.consumerDot.x);
    bundle.range[1] = Math.max(bundle.range[1], b.consumerDot.x);
  }

  // ── Assign tributary lanes per band ──
  // Non-direct tributary belts and direct rail bundles share the same lane pool
  // (lower half of each gap band, spreading toward the source card).  Interval
  // coloring ensures they coexist without Y-overlap even when X ranges overlap.
  const gapLaneCounts: Array<{
    tributaryLanes: number;
    offshootLanes: number;
    directRailLanes: number;
  }> = [];
  for (let i = 0; i < gapCount; i++) {
    gapLaneCounts.push({ tributaryLanes: 0, offshootLanes: 0, directRailLanes: 0 });
  }

  for (let band = 0; band < gapCount; band++) {
    const tribBelts = planned.filter((b) => !b.isDirect && b.tribBandIdx === band);
    const bandBundles = [...(bundlesByBand.get(band)?.values() ?? [])];

    // Build typed item arrays so we can write back lane assignments by reference.
    const tribItems = tribBelts.map((b) => ({
      range: [mainBusLeftX, b.sourceDot.x] as [number, number],
      _belt: b,
    }));
    const railItems = bandBundles.map((bundle) => ({
      range: bundle.range as [number, number],
      _bundle: bundle,
    }));

    // Combined sort + lane assignment.
    const allItems = [...tribItems, ...railItems] as Array<{
      range: [number, number];
      lane?: number;
    }>;
    allItems.sort((a, bb) => a.range[0] - bb.range[0]);
    assignLanes(allItems);

    // Write back (items are the same objects, lane property was set in-place).
    for (const item of tribItems) item._belt.tribLane = (item as typeof item & { lane?: number }).lane ?? 0;
    for (const item of railItems) item._bundle.railLane = (item as typeof item & { lane?: number }).lane ?? 0;

    if (band < gapLaneCounts.length) {
      const maxTrib = tribItems.reduce((m, i) => Math.max(m, (i as typeof i & { lane?: number }).lane ?? 0), -1);
      const maxRail = railItems.reduce((m, i) => Math.max(m, (i as typeof i & { lane?: number }).lane ?? 0), -1);
      gapLaneCounts[band].tributaryLanes = maxTrib >= 0 ? maxTrib + 1 : 0;
      gapLaneCounts[band].directRailLanes = maxRail >= 0 ? maxRail + 1 : 0;
    }
  }

  // ── Assign offshoot lanes per band ──
  for (let band = 0; band < gapCount; band++) {
    const belts = planned.filter((b) => !b.isDirect && b.offshootBandIdx === band);
    // Offshoot x-range: [mainBusLeftX, consumerDot.x]
    const withRange = belts.map((b) => ({
      belt: b,
      range: [mainBusLeftX, b.consumerDot.x] as [number, number],
    }));
    withRange.sort((a, b) => a.belt.consumerDot.x - b.belt.consumerDot.x);
    const count = assignLanes(withRange);
    for (const item of withRange) {
      item.belt.offshootLane = (item as typeof item & { lane?: number }).lane ?? 0;
    }
    if (band < gapLaneCounts.length) gapLaneCounts[band].offshootLanes = count;
  }

  // ── Assign main bus lanes ──
  //
  // Each belt occupies main bus from its tributary Y (in source's gap) up to
  // its offshoot Y (in consumer's gap).  We compute those Y values with
  // placeholder lane y=0 for now; the spatial ordering is the same regardless
  // of lane offsets within a band.
  const tempBandY = (bandIdx: number): { tribY: number; offshootY: number } => {
    // Band sits between row (bandIdx) and row (bandIdx+1).
    // In DOM y (down=larger), row 0 is at the LARGEST y.  So band bottom is
    // top-of-row-bandIdx, band top is bottom-of-row-(bandIdx+1).
    const bandBottomY = rowBounds[bandIdx].top;           // source's card top (larger y)
    const bandTopY = rowBounds[bandIdx + 1].bottom;       // consumer's card bottom (smaller y)
    // Both buses anchor at the gap's midpoint.  Lanes spread outward (away from
    // centre) toward their nearest card, so tributary and offshoot never cross.
    const midY = (bandTopY + bandBottomY) / 2;
    return { tribY: midY + TRIB_OFFSHOOT_GAP / 2, offshootY: midY - TRIB_OFFSHOOT_GAP / 2 };
  };

  const mainBusItems = planned.filter((b) => !b.isDirect).map((b) => {
    const tribBand = tempBandY(b.tribBandIdx);
    const offshootBand = tempBandY(b.offshootBandIdx);
    // Lane Y coords (ignoring tributary/offshoot within-band lane offsets for now):
    const tribY = tribBand.tribY;
    const offshootY = offshootBand.offshootY;
    // Main bus span: from offshootY (top, smaller y) to tribY (bottom, larger y).
    return { belt: b, range: [offshootY, tribY] as [number, number] };
  });
  // Sort by span top (smallest offshoot Y first) for compact packing.
  mainBusItems.sort((a, b) => a.range[0] - b.range[0]);
  const mainBusLaneCount = assignLanes(mainBusItems);
  for (const item of mainBusItems) {
    item.belt.mainBusLane = (item as typeof item & { lane?: number }).lane ?? 0;
  }

  // ── Build segments with final Y coordinates ──

  // Non-direct belts: 5-segment main-bus route.
  const belts: Belt[] = planned
    .filter((b) => !b.isDirect)
    .map((b) => {
      const tribBand = tempBandY(b.tribBandIdx);
      const offshootBand = tempBandY(b.offshootBandIdx);

      // Both buses anchor at gap centre; lanes spread OUTWARD toward their
      // nearest card so the two groups diverge and never cross.
      const tributaryY = tribBand.tribY    + b.tribLane    * LANE_SPACING; // down → source
      const offshootY  = offshootBand.offshootY - b.offshootLane * LANE_SPACING; // up → consumer

      const mainX = mainBusLeftX + b.mainBusLane * LANE_SPACING;

      return {
        id: b.id,
        color: beltColor(`${b.sourceCardId}:${b.typeId}`),
        typeId: b.typeId,
        sourceCardId: b.sourceCardId,
        segments: [
          // 1. UP from source dot to tributary Y
          { from: b.sourceDot, to: { x: b.sourceDot.x, y: tributaryY } },
          // 2. LEFT along tributary to main bus lane X
          { from: { x: b.sourceDot.x, y: tributaryY }, to: { x: mainX, y: tributaryY } },
          // 3. UP along main bus from tributary Y to offshoot Y
          { from: { x: mainX, y: tributaryY }, to: { x: mainX, y: offshootY } },
          // 4. RIGHT along offshoot to consumer's X
          { from: { x: mainX, y: offshootY }, to: { x: b.consumerDot.x, y: offshootY } },
          // 5. UP from offshoot to consumer input dot
          { from: { x: b.consumerDot.x, y: offshootY }, to: b.consumerDot },
        ],
      };
    });

  // Direct (adjacent-layer) belts: emit as bundle belts (trunk + rail + branches).
  // All segments in a bundle share the same color and sourceCardId so that
  // focus / dim logic in BuildCanvas treats them as one connected unit.
  for (const [, bandBundles] of bundlesByBand) {
    for (const [, bundle] of bandBundles) {
      const tribBand = tempBandY(bundle.tribBandIdx);
      const railY = tribBand.tribY + bundle.railLane * LANE_SPACING;
      const minX = bundle.range[0];
      const maxX = bundle.range[1];
      const color = beltColor(`${bundle.sourceCardId}:${bundle.typeId}`);
      const baseId = `${bundle.sourceCardId}:${bundle.typeId}:${bundle.tribBandIdx}`;

      // Trunk: source output dot → rail Y (vertical, going up)
      belts.push({
        id: `${baseId}:trunk`,
        color,
        typeId: bundle.typeId,
        sourceCardId: bundle.sourceCardId,
        segments: [
          { from: bundle.sourceDot, to: { x: bundle.sourceDot.x, y: railY } },
        ],
      });

      // Rail: horizontal across the full source-to-consumers span.
      // Skipped when the span is trivially zero (single same-column consumer).
      if (maxX > minX) {
        belts.push({
          id: `${baseId}:rail`,
          color,
          typeId: bundle.typeId,
          sourceCardId: bundle.sourceCardId,
          segments: [
            { from: { x: minX, y: railY }, to: { x: maxX, y: railY } },
          ],
        });
      }

      // Branches: rail → each consumer input dot (vertical, going up).
      for (const consumer of bundle.consumers) {
        belts.push({
          id: `${bundle.sourceCardId}:${bundle.typeId}:${consumer.consumerCardId}:branch`,
          color,
          typeId: bundle.typeId,
          sourceCardId: bundle.sourceCardId,
          segments: [
            { from: { x: consumer.consumerDot.x, y: railY }, to: consumer.consumerDot },
          ],
        });
      }
    }
  }

  return { belts, gapLaneCounts, mainBusLaneCount };
}

/* ── Helper to derive CardBox[] from the canvas layout ────────── */

export function cardBoxesFromLayout(
  rows: CanvasCard[][],
  cardPositions: Map<string, { left: number; top: number }>,
  cardDims: (card: CanvasCard) => { width: number; height: number },
): CardBox[] {
  const out: CardBox[] = [];
  for (let r = 0; r < rows.length; r++) {
    for (const card of rows[r]) {
      const pos = cardPositions.get(card.id);
      if (!pos) continue;
      const { width, height } = cardDims(card);
      out.push({ id: card.id, row: r, left: pos.left, top: pos.top, width, height });
    }
  }
  return out;
}
