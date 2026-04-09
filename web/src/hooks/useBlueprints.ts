import { useEffect, useState, useMemo } from "react";
import type { RecipeData } from "../lib/types";
import type { CraftingStyle } from "./useCraftingStyle";

/* ── Salvage classification ──────────────────────────────────── */

/** Known salvage-category input typeIds (Salvaged Materials, Mummified Clone). */
export const SALVAGE_INPUT_TYPE_IDS = new Set([88764, 88765]);

/** True when any of a blueprint's inputs are salvage items. */
export function isSalvageBlueprint(bp: BlueprintEntry): boolean {
  return bp.inputs.some((i) => SALVAGE_INPUT_TYPE_IDS.has(i.typeId));
}

/** True when any of a recipe's inputs are salvage items. */
export function isSalvageRecipe(recipe: RecipeData): boolean {
  return recipe.inputs.some((i) => SALVAGE_INPUT_TYPE_IDS.has(i.typeId));
}

/* ── Field / Base facility classification ────────────────────── */

const FIELD_FACILITY_NAMES = new Set(["Field Refinery", "Field Printer"]);

/** True when the facility name is a field-class facility. */
export function isFieldFacility(facilityName: string): boolean {
  return FIELD_FACILITY_NAMES.has(facilityName);
}

/** True when a BlueprintRecipe uses a field-class facility. */
export function isFieldRecipe(recipe: BlueprintRecipe): boolean {
  return isFieldFacility(recipe.facilityName);
}

/* ── Ore-efficiency helpers ──────────────────────────────────── */

/**
 * Output-per-ore ratio: how many units of the target output are produced
 * per unit of ore input. Higher = more efficient (fewer ore units to mine).
 * Returns 0 for recipes with no inputs (should not happen for refining).
 */
function oreEfficiency(recipe: RecipeData): number {
  const oreInput = recipe.inputs[0];
  if (!oreInput || oreInput.quantity === 0) return 0;
  return recipe.outputQuantity / oreInput.quantity;
}

/**
 * Build "reoriented" recipes for multi-output blueprints.
 *
 * For each secondary output, creates a BlueprintRecipe where that output
 * is promoted to primary (so the tree resolver computes correct runs)
 * and all other outputs (original primary + remaining secondaries)
 * become secondaryOutputs for byproduct crediting.
 */
function reorientedRecipes(bp: BlueprintEntry): BlueprintRecipe[] {
  if (bp.outputs.length < 2) return [];

  const result: BlueprintRecipe[] = [];
  const facilityName = bp.facilities[0]?.facilityName ?? "Unknown";
  const facilityFamily = bp.facilities[0]?.facilityFamily ?? "Unknown";
  const inputs = bp.inputs.map((i) => ({ typeId: i.typeId, quantity: i.quantity }));

  for (let i = 1; i < bp.outputs.length; i++) {
    const target = bp.outputs[i];
    // All outputs except the target become secondaryOutputs.
    const others = bp.outputs
      .filter((_, idx) => idx !== i)
      .map((o) => ({ typeId: o.typeId, quantity: o.quantity }));

    result.push({
      outputTypeId: target.typeId,
      outputQuantity: target.quantity,
      secondaryOutputs: others.length > 0 ? others : undefined,
      inputs,
      runTime: bp.runTime,
      blueprintId: bp.blueprintId,
      facilityName,
      facilityFamily,
    });
  }

  return result;
}

export interface BlueprintOutput {
  typeId: number;
  quantity: number;
}

export interface BlueprintInput {
  typeId: number;
  quantity: number;
}

export interface BlueprintFacility {
  facilityTypeId: number;
  facilityName: string;
  facilityFamily: string;
}

export interface BlueprintEntry {
  blueprintId: number;
  primaryTypeId: number;
  primaryName: string;
  primaryIcon: string | null;
  primaryCategoryName: string | null;
  primaryGroupName: string | null;
  primaryMetaGroupName: string | null;
  slotType: "high" | "mid" | "low" | "engine" | null;
  sizeClass: "small" | "medium" | "large" | null;
  runTime: number;
  outputs: BlueprintOutput[];
  inputs: BlueprintInput[];
  facilities: BlueprintFacility[];
}

/** RecipeData enriched with blueprint and facility metadata. */
export interface BlueprintRecipe extends RecipeData {
  blueprintId: number;
  facilityName: string;
  facilityFamily: string;
}

let cache: BlueprintEntry[] | null = null;
let cachePromise: Promise<BlueprintEntry[]> | null = null;

function fetchBlueprints(): Promise<BlueprintEntry[]> {
  if (cache) return Promise.resolve(cache);
  if (!cachePromise) {
    cachePromise = fetch("/blueprints.json")
      .then((r) => r.json())
      .then((data: BlueprintEntry[]) => {
        cache = data;
        return data;
      });
  }
  return cachePromise;
}

export function useBlueprints(craftingStyle: CraftingStyle = "field") {
  const [blueprints, setBlueprints] = useState<BlueprintEntry[]>(cache ?? []);

  useEffect(() => {
    if (cache) {
      setBlueprints(cache);
      return;
    }
    fetchBlueprints().then(setBlueprints);
  }, []);

  function getBlueprint(blueprintId: number): BlueprintEntry | undefined {
    return blueprints.find((b) => b.blueprintId === blueprintId);
  }

  /**
   * Convert blueprints into RecipeData[] for the optimizer.
   * When multiple blueprints produce the same output, only the most
   * ore-efficient is kept (matching the game behaviour where the player
   * selects a specific recipe).
   *
   * Multi-output blueprints also generate "reoriented" recipes for their
   * secondary outputs (e.g. Feldspar → Silica Grains) so the optimizer
   * can consider them as alternatives. All candidates are sorted by ore
   * efficiency before the first-wins dedup, and salvage recipes are
   * deprioritized.
   */
  const recipesForOptimizer = useMemo<RecipeData[]>(() => {
    // Build candidate list: primary recipes + reoriented secondary recipes.
    const candidates: RecipeData[] = [];
    for (const bp of blueprints) {
      const outputTypeId = bp.outputs[0]?.typeId;
      if (outputTypeId == null) continue;

      const secondaryOutputs = bp.outputs.length > 1
        ? bp.outputs.slice(1).map((o) => ({ typeId: o.typeId, quantity: o.quantity }))
        : undefined;

      candidates.push({
        outputTypeId,
        outputQuantity: bp.outputs[0].quantity,
        secondaryOutputs,
        inputs: bp.inputs.map((i) => ({ typeId: i.typeId, quantity: i.quantity })),
        runTime: bp.runTime,
      });

      // Reoriented recipes for secondary outputs.
      for (const reoriented of reorientedRecipes(bp)) {
        candidates.push(reoriented);
      }
    }

    // Sort: non-salvage first, then by ore efficiency descending.
    candidates.sort((a, b) => {
      const aS = isSalvageRecipe(a) ? 1 : 0;
      const bS = isSalvageRecipe(b) ? 1 : 0;
      if (aS !== bS) return aS - bS;
      return oreEfficiency(b) - oreEfficiency(a);
    });

    // First-wins dedup by output typeId.
    const seen = new Set<number>();
    const recipes: RecipeData[] = [];
    for (const r of candidates) {
      if (seen.has(r.outputTypeId)) continue;
      seen.add(r.outputTypeId);
      recipes.push(r);
    }

    return recipes;
  }, [blueprints]);

  /**
   * All blueprints grouped by output typeId, preserving every alternative.
   * Used by the optimizer to let the player pick a specific blueprint/facility
   * at each node in the dependency tree.
   *
   * Multi-output blueprints are registered under ALL their outputs, not just
   * the primary. For secondary outputs, a "reoriented" recipe is created
   * where that output is promoted to primary (correct run math) and all
   * other outputs become secondaryOutputs (byproduct crediting). This lets
   * the optimizer choose e.g. Feldspar for Silica Grains instead of being
   * forced into Platinum-Palladium Matrix.
   *
   * Alternatives are sorted by:
   *   1. Crafting style preference (field-first or base-first)
   *   2. Ore-based (non-salvage) recipes before salvage-input recipes
   *   3. Ore efficiency (output per ore unit) descending
   * This ensures the default selection (`alternatives[0]`) matches the
   * player's preferred crafting route with maximum ore efficiency.
   */
  const allRecipesMap = useMemo<Map<number, BlueprintRecipe[]>>(() => {
    const map = new Map<number, BlueprintRecipe[]>();

    for (const bp of blueprints) {
      const outputTypeId = bp.outputs[0]?.typeId;
      if (outputTypeId == null) continue;

      const secondaryOutputs = bp.outputs.length > 1
        ? bp.outputs.slice(1).map((o) => ({ typeId: o.typeId, quantity: o.quantity }))
        : undefined;

      // Primary-output recipe.
      const recipe: BlueprintRecipe = {
        outputTypeId,
        outputQuantity: bp.outputs[0].quantity,
        secondaryOutputs,
        inputs: bp.inputs.map((i) => ({ typeId: i.typeId, quantity: i.quantity })),
        runTime: bp.runTime,
        blueprintId: bp.blueprintId,
        facilityName: bp.facilities[0]?.facilityName ?? "Unknown",
        facilityFamily: bp.facilities[0]?.facilityFamily ?? "Unknown",
      };

      const existing = map.get(outputTypeId);
      if (existing) existing.push(recipe);
      else map.set(outputTypeId, [recipe]);

      // Reoriented recipes for secondary outputs.
      for (const reoriented of reorientedRecipes(bp)) {
        const list = map.get(reoriented.outputTypeId);
        if (list) list.push(reoriented);
        else map.set(reoriented.outputTypeId, [reoriented]);
      }
    }

    // Sort each output's alternatives:
    //   1. Crafting style (field-first or base-first)
    //   2. Non-salvage before salvage
    //   3. Ore efficiency descending (fewer ore units per target output)
    const preferField = craftingStyle === "field";
    for (const [, recipes] of map) {
      if (recipes.length > 1) {
        recipes.sort((a, b) => {
          // Field/base preference
          const aF = isFieldRecipe(a) ? 1 : 0;
          const bF = isFieldRecipe(b) ? 1 : 0;
          if (aF !== bF) return preferField ? bF - aF : aF - bF;
          // Salvage tiebreak
          const aS = isSalvageRecipe(a) ? 1 : 0;
          const bS = isSalvageRecipe(b) ? 1 : 0;
          if (aS !== bS) return aS - bS;
          // Ore efficiency (higher = better)
          return oreEfficiency(b) - oreEfficiency(a);
        });
      }
    }

    return map;
  }, [blueprints, craftingStyle]);

  return { blueprints, getBlueprint, recipesForOptimizer, allRecipesMap };
}
