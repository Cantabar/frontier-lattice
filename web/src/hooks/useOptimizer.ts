/**
 * useOptimizer — browser port of the CLI optimizer.
 *
 * Performs recipe tree resolution and gap analysis in-memory
 * using recipe data fetched from the registry.
 */

import { useMemo, useState, useCallback } from "react";
import type { RecipeData, InputRequirement } from "../lib/types";
import { buildRecipeMap } from "../lib/bom";

/* ------------------------------------------------------------------ */
/* Types (mirrored from CLI optimizer)                                 */
/* ------------------------------------------------------------------ */

export interface ResolvedNode {
  typeId: number;
  quantityNeeded: number;
  runs: number;
  quantityPerRun: number;
  isCraftable: boolean;
  children: ResolvedNode[];
}

export interface LeafMaterial {
  typeId: number;
  quantity: number;
}

export interface GapItem {
  typeId: number;
  required: number;
  onHand: number;
  missing: number;
}

export interface GapAnalysis {
  shoppingList: GapItem[];
  satisfied: GapItem[];
  totalRequired: number;
  totalOnHand: number;
  totalMissing: number;
}

export type Inventory = Map<number, number>;

/* ------------------------------------------------------------------ */
/* Resolver (ported from recipe-resolver.ts)                           */
/* ------------------------------------------------------------------ */

function resolveNode(
  recipeMap: Map<number, RecipeData>,
  typeId: number,
  quantityNeeded: number,
  visited: Set<number>,
): ResolvedNode {
  const recipe = recipeMap.get(typeId);

  if (!recipe || visited.has(typeId)) {
    return { typeId, quantityNeeded, runs: 0, quantityPerRun: 0, isCraftable: false, children: [] };
  }

  const runs = Math.ceil(quantityNeeded / recipe.outputQuantity);
  visited.add(typeId);

  const children = recipe.inputs.map((input: InputRequirement) => {
    return resolveNode(recipeMap, input.typeId, input.quantity * runs, visited);
  });

  visited.delete(typeId);

  return {
    typeId,
    quantityNeeded,
    runs,
    quantityPerRun: recipe.outputQuantity,
    isCraftable: true,
    children,
  };
}

function collectLeaves(node: ResolvedNode, acc: Map<number, number>) {
  if (!node.isCraftable) {
    acc.set(node.typeId, (acc.get(node.typeId) ?? 0) + node.quantityNeeded);
    return;
  }
  for (const child of node.children) {
    collectLeaves(child, acc);
  }
}

function analyzeGaps(leafMaterials: LeafMaterial[], inventory: Inventory): GapAnalysis {
  const shoppingList: GapItem[] = [];
  const satisfied: GapItem[] = [];
  let totalRequired = 0;
  let totalOnHand = 0;
  let totalMissing = 0;

  for (const mat of leafMaterials) {
    const onHand = inventory.get(mat.typeId) ?? 0;
    const missing = Math.max(0, mat.quantity - onHand);
    const item: GapItem = {
      typeId: mat.typeId,
      required: mat.quantity,
      onHand: Math.min(onHand, mat.quantity),
      missing,
    };

    totalRequired += mat.quantity;
    totalOnHand += item.onHand;
    totalMissing += missing;

    if (missing > 0) shoppingList.push(item);
    else satisfied.push(item);
  }

  shoppingList.sort((a, b) => b.missing - a.missing);
  return { shoppingList, satisfied, totalRequired, totalOnHand, totalMissing };
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useOptimizer(recipes: RecipeData[]) {
  const recipeMap = useMemo(() => buildRecipeMap(recipes), [recipes]);

  const [result, setResult] = useState<{
    tree: ResolvedNode;
    leafMaterials: LeafMaterial[];
    gaps: GapAnalysis;
  } | null>(null);

  const optimize = useCallback(
    (targetTypeId: number, targetQuantity: number, inventory: Inventory = new Map()) => {
      const tree = resolveNode(recipeMap, targetTypeId, targetQuantity, new Set());

      const leafMap = new Map<number, number>();
      collectLeaves(tree, leafMap);
      const leafMaterials: LeafMaterial[] = Array.from(leafMap.entries())
        .map(([typeId, quantity]) => ({ typeId, quantity }))
        .sort((a, b) => b.quantity - a.quantity);

      const gaps = analyzeGaps(leafMaterials, inventory);
      setResult({ tree, leafMaterials, gaps });
    },
    [recipeMap],
  );

  const clear = useCallback(() => setResult(null), []);

  return { result, optimize, clear };
}
