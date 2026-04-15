/**
 * buildCanvasLayout — converts a ResolvedNode dependency tree into a
 * flat, row/column-indexed canvas layout for the Build Optimizer v3
 * canvas view.
 *
 * Flow is bottom-to-top:
 *   Row 0  : Mining cards (raw materials — "alone on a row at the bottom")
 *   Row 1  : SSU card (if any SSU-satisfied items exist)
 *   Row 2+ : Blueprint cards, ordered by depth from root (root at top)
 */

import type { ResolvedNode } from "../hooks/useOptimizer";
import type { BlueprintEntry } from "../hooks/useBlueprints";

/* ── Types ────────────────────────────────────────────────────── */

/** A single input or output port on a canvas card. */
export interface CanvasPort {
  typeId: number;
  /** Total quantity across all runs. */
  totalQty: number;
  /** Quantity produced/consumed per run. */
  perRunQty: number;
  /** Number of runs (used for display: "n runs × n/run"). */
  runs: number;
}

export interface BlueprintCanvasCard {
  kind: "blueprint";
  id: string;
  blueprintId: number;
  blueprintEntry: BlueprintEntry | null;
  facilityName: string;
  /** Bottom edge — receives from sources below. */
  inputs: CanvasPort[];
  /** Top edge — sends outputs upward. */
  outputs: CanvasPort[];
  row: number;
  col: number;
}

/** Aggregate card for all SSU-inventory-satisfied materials. */
export interface SsuCanvasCard {
  kind: "ssu";
  id: string;
  /** Top edge only — SSU has no inputs (it's a terminal source). */
  outputs: CanvasPort[];
  row: number;
  col: number;
}

export interface MiningCanvasCard {
  kind: "mining";
  id: string;
  typeId: number;
  totalQty: number;
  row: number;
  col: number;
}

export type CanvasCard = BlueprintCanvasCard | SsuCanvasCard | MiningCanvasCard;

export interface CanvasEdge {
  fromCardId: string;
  /** typeId of the material flowing along this edge. */
  fromTypeId: number;
  toCardId: string;
  toTypeId: number;
}

export interface CanvasLayout {
  /** rows[0] = bottom row (Mining/SSU), rows[last] = top row (root blueprint). */
  rows: CanvasCard[][];
  edges: CanvasEdge[];
  totalRows: number;
}

/* ── Algorithm ────────────────────────────────────────────────── */

export function buildCanvasLayout(
  tree: ResolvedNode,
  getBlueprintEntry: (blueprintId: number) => BlueprintEntry | undefined,
): CanvasLayout {
  let counter = 0;

  const rawEdges: Array<{ fromId: string; fromTypeId: number; toId: string }> = [];

  // SSU aggregate — all fully-inventory-satisfied leaves collapse into one card
  const ssuOutputs: CanvasPort[] = [];
  const ssuTypesSeen = new Set<number>();
  const ssuNodeIds = new Set<string>();

  // Mining totals — aggregate by typeId across all branches
  const miningTotals = new Map<number, number>();

  // ── Blueprint node deduplication ──────────────────────────────
  //
  // Multi-output refinery blueprints (e.g. Feldspar → Hydrocarbon Residue +
  // Silica Grains) are registered under BOTH their primary output and any
  // reoriented "secondary-as-primary" variants.  The optimizer may therefore
  // create separate tree branches for each output — one branch resolving
  // Hydrocarbon Residue and another resolving Silica Grains — even though
  // both come from the exact same physical refinery run.
  //
  // We deduplicate by blueprintId: the first occurrence creates the card;
  // subsequent occurrences with the same blueprintId reuse that card's id,
  // accumulate their runs, and register their output typeId so it appears
  // as an additional output port.  Depth is tracked as the maximum (deepest)
  // occurrence so the card always sits below all of its consumers.

  interface BpInfo {
    id: string;
    node: ResolvedNode;    // representative node — used for metadata only
    depth: number;         // max depth across merged occurrences
    totalRuns: number;     // sum of runs across all occurrences
    /** All outputs this card produces: typeId → per-run quantity. */
    allOutputs: Map<number, number>;
    /** All inputs this card consumes: typeId → per-run quantity. */
    allInputs: Map<number, number>;
  }

  const bpInfosByBlueprintId = new Map<number, BpInfo>();
  const bpInfos: BpInfo[] = [];

  // ── Pre-walk: collect every byproduct typeId produced anywhere in the tree ──
  // The optimizer credits secondary outputs (byproducts) to its working inventory
  // so sibling/downstream branches can consume them without extra runs.  This
  // means a node that consumes a byproduct shows up as satisfiedFromInventory=true
  // even with an empty SSU.  We detect those nodes here and wire their canvas
  // edges directly from the producing blueprint instead of routing them through
  // the SSU card.
  function collectByproductIds(node: ResolvedNode, out: Set<number>): void {
    for (const bp of node.byproducts ?? []) out.add(bp.typeId);
    for (const child of node.children) collectByproductIds(child, out);
  }
  const globalByproductIds = new Set<number>();
  collectByproductIds(tree, globalByproductIds);

  // Maps byproduct typeId → list of parent card IDs that need it as an input.
  const byproductConsumers = new Map<number, string[]>();

  // Maps byproduct typeId → the card id that actually credited this byproduct
  // to inventory during tree resolution.  Recorded in walk when we process a
  // blueprint node whose byproducts list contains that typeId.  Using this
  // instead of `bpInfos.find(b => b.allOutputs.has(typeId))` ensures the post-
  // walk edge source is the blueprint that PRODUCED the byproduct, not any
  // other card that happens to list the same typeId as one of its outputs.
  const byproductProducerId = new Map<number, string>();

  function walk(node: ResolvedNode, depth: number, parentId: string | null) {
    let nodeId: string;

    if (node.satisfiedFromInventory && !node.isCraftable) {
      if (globalByproductIds.has(node.typeId)) {
        // Satisfied by byproduct crediting, not real SSU inventory.
        // Defer the edge — post-walk will draw it from the blueprint that
        // produces this item as a secondary output.
        if (parentId !== null) {
          const arr = byproductConsumers.get(node.typeId) ?? [];
          arr.push(parentId);
          byproductConsumers.set(node.typeId, arr);
        }
        return; // leaf — no children to expand
      }
      // Fully SSU-satisfied leaf — aggregate into single SSU card
      nodeId = `ssunode-${++counter}`;
      ssuNodeIds.add(nodeId);
      if (!ssuTypesSeen.has(node.typeId)) {
        ssuTypesSeen.add(node.typeId);
        ssuOutputs.push({
          typeId: node.typeId,
          totalQty: node.quantityNeeded,
          perRunQty: node.quantityNeeded,
          runs: 1,
        });
      }
    } else if (!node.isCraftable) {
      // Raw material leaf — aggregate by typeId into mining cards
      nodeId = `mining-${node.typeId}`;
      miningTotals.set(node.typeId, (miningTotals.get(node.typeId) ?? 0) + node.quantityNeeded);
    } else {
      // Craftable blueprint step — deduplicate by blueprintId so that all
      // occurrences of the same refinery/assembler share one canvas card.
      const bpId = node.blueprintId;
      const existing = bpId != null ? bpInfosByBlueprintId.get(bpId) : undefined;

      if (existing) {
        // Merge into the existing card.
        nodeId = existing.id;
        existing.totalRuns += node.runs;
        existing.depth = Math.max(existing.depth, depth);

        // Register this occurrence's primary output if not already tracked.
        if (!existing.allOutputs.has(node.typeId)) {
          existing.allOutputs.set(node.typeId, node.quantityPerRun);
        }
        // Byproducts of this occurrence may add further output ports and
        // each byproduct typeId is credited to inventory by this card.
        for (const bp of node.byproducts ?? []) {
          if (!existing.allOutputs.has(bp.typeId)) {
            const perRun = node.runs > 0 ? Math.round(bp.quantity / node.runs) : bp.quantity;
            existing.allOutputs.set(bp.typeId, perRun);
          }
          if (!byproductProducerId.has(bp.typeId)) {
            byproductProducerId.set(bp.typeId, nodeId);
          }
        }
      } else {
        // First occurrence — create the card.
        nodeId = `bp-${++counter}`;

        const allOutputs = new Map<number, number>();
        allOutputs.set(node.typeId, node.quantityPerRun);
        for (const bp of node.byproducts ?? []) {
          if (!allOutputs.has(bp.typeId)) {
            const perRun = node.runs > 0 ? Math.round(bp.quantity / node.runs) : bp.quantity;
            allOutputs.set(bp.typeId, perRun);
          }
          if (!byproductProducerId.has(bp.typeId)) {
            byproductProducerId.set(bp.typeId, nodeId);
          }
        }

        // Inputs come from the recipe; per-run quantities are stable across
        // all reoriented variants of the same blueprint.
        const allInputs = new Map<number, number>();
        for (const child of node.children) {
          const perRun = node.runs > 0 ? Math.round(child.quantityNeeded / node.runs) : child.quantityNeeded;
          allInputs.set(child.typeId, perRun);
        }

        const info: BpInfo = { id: nodeId, node, depth, totalRuns: node.runs, allOutputs, allInputs };
        if (bpId != null) bpInfosByBlueprintId.set(bpId, info);
        bpInfos.push(info);
      }
    }

    if (parentId !== null) {
      rawEdges.push({ fromId: nodeId, fromTypeId: node.typeId, toId: parentId });
    }

    for (const child of node.children) {
      walk(child, depth + 1, nodeId);
    }
  }

  walk(tree, 0, null);

  // ── Post-walk: add byproduct edges from producer blueprint to consumers ──
  for (const [typeId, consumers] of byproductConsumers) {
    // Prefer the blueprint that actually credited this typeId as a byproduct
    // (recorded during walk).  Fall back to any card that lists this typeId
    // as an output — only reached when the producer wasn't a byproduct path,
    // which shouldn't happen but is safe.
    const sourceId =
      byproductProducerId.get(typeId) ??
      bpInfos.find((b) => b.allOutputs.has(typeId))?.id;
    if (!sourceId) continue;
    for (const consumerId of consumers) {
      rawEdges.push({ fromId: sourceId, fromTypeId: typeId, toId: consumerId });
    }
  }

  /* ── Row assignment ── */

  const maxBpDepth = bpInfos.length > 0 ? Math.max(...bpInfos.map((b) => b.depth)) : 0;
  const hasMining = miningTotals.size > 0;
  const hasSsu = ssuOutputs.length > 0;
  // Blueprint rows start above mining (row 0) and optional SSU (row 1)
  const bpRowOffset = (hasMining ? 1 : 0) + (hasSsu ? 1 : 0);

  /* ── Build blueprint cards ── */

  const bpCards: BlueprintCanvasCard[] = bpInfos.map(({ id, node, depth, totalRuns, allOutputs, allInputs }) => {
    const row = maxBpDepth - depth + bpRowOffset;
    const bpEntry = node.blueprintId != null ? getBlueprintEntry(node.blueprintId) : undefined;

    const outputs: CanvasPort[] = Array.from(allOutputs.entries()).map(([typeId, perRunQty]) => ({
      typeId,
      totalQty: totalRuns * perRunQty,
      perRunQty,
      runs: totalRuns,
    }));

    const inputs: CanvasPort[] = Array.from(allInputs.entries()).map(([typeId, perRunQty]) => ({
      typeId,
      totalQty: totalRuns * perRunQty,
      perRunQty,
      runs: totalRuns,
    }));

    return {
      kind: "blueprint",
      id,
      blueprintId: node.blueprintId ?? -1,
      blueprintEntry: bpEntry ?? null,
      facilityName: node.facilityName ?? "Unknown",
      inputs,
      outputs,
      row,
      col: 0, // assigned below
    };
  });

  /* ── Build SSU card ── */

  const ssuCard: SsuCanvasCard | null = hasSsu
    ? { kind: "ssu", id: "ssu-aggregate", outputs: ssuOutputs, row: hasMining ? 1 : 0, col: 0 }
    : null;

  /* ── Build mining cards ── */

  const miningCards: MiningCanvasCard[] = Array.from(miningTotals.entries()).map(
    ([typeId, totalQty]) => ({
      kind: "mining" as const,
      id: `mining-${typeId}`,
      typeId,
      totalQty,
      row: 0,
      col: 0,
    }),
  );

  /* ── Resolve edges (fix SSU node IDs → aggregate card ID, dedup) ── */

  const edgeSet = new Set<string>();
  const edges: CanvasEdge[] = [];

  for (const raw of rawEdges) {
    const fromCardId = ssuNodeIds.has(raw.fromId) ? "ssu-aggregate" : raw.fromId;
    const key = `${fromCardId}|${raw.fromTypeId}|${raw.toId}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push({ fromCardId, fromTypeId: raw.fromTypeId, toCardId: raw.toId, toTypeId: raw.fromTypeId });
  }

  /* ── Column assignment (center each row, BFS order) ── */

  const allCards: CanvasCard[] = [
    ...miningCards,
    ...(ssuCard ? [ssuCard] : []),
    ...bpCards,
  ];

  const rowGroups = new Map<number, CanvasCard[]>();
  for (const card of allCards) {
    if (!rowGroups.has(card.row)) rowGroups.set(card.row, []);
    rowGroups.get(card.row)!.push(card);
  }
  for (const [, cards] of rowGroups) {
    cards.forEach((c, i) => { c.col = i; });
  }

  const totalRows = rowGroups.size > 0 ? Math.max(...rowGroups.keys()) + 1 : 1;
  const rows: CanvasCard[][] = Array.from({ length: totalRows }, (_, i) => rowGroups.get(i) ?? []);

  return { rows, edges, totalRows };
}

/**
 * Build a bidirectional adjacency index: cardId → Set of directly connected cardIds.
 * Used by the canvas to determine which cards to dim/highlight when one is focused.
 */
export function buildEdgeIndex(edges: CanvasEdge[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!index.has(edge.fromCardId)) index.set(edge.fromCardId, new Set());
    if (!index.has(edge.toCardId)) index.set(edge.toCardId, new Set());
    index.get(edge.fromCardId)!.add(edge.toCardId);
    index.get(edge.toCardId)!.add(edge.fromCardId);
  }
  return index;
}
