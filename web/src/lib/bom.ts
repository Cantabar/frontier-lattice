/**
 * BOM (Bill of Materials) expansion utilities.
 *
 * Used by both the optimizer UI (display) and multi_input_contract creation
 * (generating the flat slot list to encode on-chain).
 *
 * `expandToBomDepth` resolves a target item + quantity to a flat map of
 * { typeId → required quantity } at a chosen BOM depth:
 *   depth 0       — the target item itself
 *   depth 1       — direct inputs (one recipe step)
 *   depth n       — n recipe steps deep
 *   Infinity      — fully expanded to raw leaves (no recipe)
 *
 * All quantities are scaled by ceil(requested / outputQuantity) runs so they
 * represent the exact input amounts needed to produce exactly that many runs.
 */

import type { RecipeData } from "./types";

export function buildRecipeMap(recipes: RecipeData[]): Map<number, RecipeData> {
  const map = new Map<number, RecipeData>();
  for (const r of recipes) {
    map.set(r.outputTypeId, r);
  }
  return map;
}

/**
 * Expand `typeId × quantity` to the flat ingredient map at `maxDepth` BOM levels.
 *
 * Returns a Map<typeId, totalRequired> representing every distinct item type
 * needed and its aggregate required quantity.
 */
export function expandToBomDepth(
  recipeMap: Map<number, RecipeData>,
  typeId: number,
  quantity: number,
  maxDepth: number,
): Map<number, number> {
  const result = new Map<number, number>();
  _expand(recipeMap, typeId, quantity, 0, maxDepth, result, new Set<number>());
  return result;
}

function _expand(
  recipeMap: Map<number, RecipeData>,
  typeId: number,
  quantity: number,
  depth: number,
  maxDepth: number,
  result: Map<number, number>,
  visited: Set<number>,
): void {
  const recipe = recipeMap.get(typeId);

  // Stop if: at limit, no recipe, or cycle detected → treat as a leaf
  if (depth >= maxDepth || !recipe || visited.has(typeId)) {
    result.set(typeId, (result.get(typeId) ?? 0) + quantity);
    return;
  }

  const runs = Math.ceil(quantity / recipe.outputQuantity);
  visited.add(typeId);

  for (const input of recipe.inputs) {
    _expand(
      recipeMap,
      input.typeId,
      input.quantity * runs,
      depth + 1,
      maxDepth,
      result,
      visited,
    );
  }

  visited.delete(typeId);
}

/**
 * Convert an expansion result map to parallel sorted arrays suitable for
 * passing as PTB arguments to `multi_input_contract::create`.
 *
 * Sorted by typeId ascending for determinism.
 */
export function slotsToArrays(slots: Map<number, number>): {
  typeIds: number[];
  quantities: number[];
} {
  const entries = Array.from(slots.entries()).sort((a, b) => a[0] - b[0]);
  return {
    typeIds: entries.map(([id]) => id),
    quantities: entries.map(([, qty]) => qty),
  };
}

/**
 * Human-readable label for a BOM depth value.
 */
export function depthLabel(depth: number): string {
  if (depth === 0) return "Finished items";
  if (depth === 1) return "Direct inputs (1 step)";
  if (depth === Infinity) return "Raw materials (full expansion)";
  return `${depth} steps deep`;
}
