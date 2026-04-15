/**
 * oreOptimizer — joint cross-ore optimization for multi-output recipes.
 *
 * When a build requires intermediates produced by multiple ores with
 * overlapping outputs (e.g. both Feldspar Crystals and Hydrated Sulfide
 * Matrix produce Hydrocarbon Residue), the tree resolver's DFS byproduct
 * crediting is order-dependent and may not find the globally optimal
 * allocation. This module extracts intermediate demands at the refining
 * boundary and jointly optimizes ore runs across all ore types, accounting
 * for shared byproducts.
 *
 * Algorithm:
 *   1. collectRefiningDemands — walk the resolved tree and collect demands
 *      for intermediates produced by multi-output recipes (the refining
 *      boundary), rather than at the raw-ore leaf level.
 *   2. resolveToRawOre — for each recipe input that is itself produced by
 *      a multi-output recipe, recursively resolve to the true raw ore.
 *   3. computeCompoundOutputs — build compound per-ore-run yields across
 *      the full chain, tracing byproducts through demand-producing recipes.
 *   4. optimizeOreUsage — jointly optimize ore runs:
 *      Phase 1 (forced ores): ores that are the sole source for an
 *        intermediate are forced; compute minimum runs.
 *      Phase 2 (surplus propagation): credit all outputs from forced
 *        ore runs against remaining demands.
 *      Phase 3 (greedy fill): assign additional runs to the most
 *        efficient ore for any remaining shared-intermediate demands.
 */

import type { RecipeData } from "./types";
import type { ResolvedNode, LeafMaterial } from "../hooks/useOptimizer";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface OreProduct {
  typeId: number;
  /** Quantity needed by the build plan. */
  needed: number;
  /** Quantity produced by the optimized ore runs. */
  produced: number;
  /** Surplus = produced - needed (≥ 0). */
  surplus: number;
}

export interface OreSummaryEntry {
  /** The ore (raw input) typeId. */
  oreTypeId: number;
  /** Total ore units to mine. */
  totalUnits: number;
  /** Number of refining runs. */
  runs: number;
  /** Input quantity per run. */
  inputPerRun: number;
  /** Products yielded by this ore's refining recipe. */
  products: OreProduct[];
}

export interface OreSummary {
  entries: OreSummaryEntry[];
  /** Total ore units across all ore types. */
  totalOreUnits: number;
  /** Leaf materials that are NOT produced by any multi-output refining recipe. */
  unoptimized: LeafMaterial[];
}

/* ------------------------------------------------------------------ */
/* Reverse index: output typeId → refining recipes that produce it     */
/* ------------------------------------------------------------------ */

interface RefiningSource {
  recipe: RecipeData;
  /** Index in [primaryOutput, ...secondaryOutputs] — 0 = primary. */
  outputIndex: number;
  /** Quantity of this output per run. */
  quantityPerRun: number;
}

/**
 * Build a map from primary outputTypeId → first matching recipe, for ALL
 * recipes.  Used as a fallback in resolveToRawOre to trace single-output
 * crafting chains (e.g. Iridosmine Nodules → Iron-Rich Nodules) that are
 * absent from the byproductIndex.
 */
export function buildRecipesByOutput(
  recipes: RecipeData[],
): Map<number, RecipeData> {
  const map = new Map<number, RecipeData>();
  for (const recipe of recipes) {
    if (!map.has(recipe.outputTypeId)) {
      map.set(recipe.outputTypeId, recipe);
    }
  }
  return map;
}

/**
 * Build a map from every output typeId to the refining recipes that produce it.
 * Only includes recipes that have secondary outputs (multi-output recipes).
 */
export function buildByproductIndex(
  recipes: RecipeData[],
): Map<number, RefiningSource[]> {
  const index = new Map<number, RefiningSource[]>();

  for (const recipe of recipes) {
    if (!recipe.secondaryOutputs || recipe.secondaryOutputs.length === 0) continue;

    // Primary output
    const primaryEntry: RefiningSource = {
      recipe,
      outputIndex: 0,
      quantityPerRun: recipe.outputQuantity,
    };
    const existing0 = index.get(recipe.outputTypeId);
    if (existing0) existing0.push(primaryEntry);
    else index.set(recipe.outputTypeId, [primaryEntry]);

    // Secondary outputs
    for (let i = 0; i < recipe.secondaryOutputs.length; i++) {
      const so = recipe.secondaryOutputs[i];
      const entry: RefiningSource = {
        recipe,
        outputIndex: i + 1,
        quantityPerRun: so.quantity,
      };
      const existing = index.get(so.typeId);
      if (existing) existing.push(entry);
      else index.set(so.typeId, [entry]);
    }
  }

  return index;
}

/* ------------------------------------------------------------------ */
/* Refining demand extraction from resolved tree                       */
/* ------------------------------------------------------------------ */

export interface RefiningDemands {
  /** Intermediate typeId → total demand from the build. */
  demands: Map<number, number>;
  /** Leaf materials NOT involved in multi-output refining. */
  nonRefiningLeaves: LeafMaterial[];
}

/**
 * Walk the resolved tree and collect intermediate demands at the refining
 * boundary — materials produced by multi-output recipes — rather than at
 * the raw-ore leaf level.
 *
 * Refining nodes (craftable + byproducts) record their `quantityNeeded`
 * and do NOT recurse into ore-input children (the joint optimizer derives
 * those). Non-refining leaves are collected separately.
 */
export function collectRefiningDemands(
  tree: ResolvedNode,
  byproductIndex: Map<number, RefiningSource[]>,
): RefiningDemands {
  const demands = new Map<number, number>();
  const rawLeaves = new Map<number, number>();

  _walkRefining(tree, byproductIndex, demands, rawLeaves);

  const nonRefiningLeaves: LeafMaterial[] = Array.from(rawLeaves.entries())
    .map(([typeId, quantity]) => ({ typeId, quantity }))
    .sort((a, b) => b.quantity - a.quantity);

  return { demands, nonRefiningLeaves };
}

function _walkRefining(
  node: ResolvedNode,
  byproductIndex: Map<number, RefiningSource[]>,
  demands: Map<number, number>,
  rawLeaves: Map<number, number>,
): void {
  // Craftable node with byproducts → refining step.
  // Record intermediate demand and stop (ore inputs derived by joint optimizer).
  if (node.isCraftable && node.byproducts && node.byproducts.length > 0) {
    demands.set(node.typeId, (demands.get(node.typeId) ?? 0) + node.quantityNeeded);
    return;
  }

  // Normal craftable node (not refining) → recurse into children.
  if (node.isCraftable) {
    for (const child of node.children) {
      _walkRefining(child, byproductIndex, demands, rawLeaves);
    }
    return;
  }

  // Non-craftable node (leaf or inventory-satisfied).
  if (byproductIndex.has(node.typeId)) {
    // Refining intermediate — include for joint optimizer to re-evaluate.
    demands.set(node.typeId, (demands.get(node.typeId) ?? 0) + node.quantityNeeded);
  } else if (!node.satisfiedFromInventory) {
    // Non-refining raw leaf (not covered by SSU).
    rawLeaves.set(node.typeId, (rawLeaves.get(node.typeId) ?? 0) + node.quantityNeeded);
  }
  // else: non-refining material satisfied from SSU — skip.
}

/* ------------------------------------------------------------------ */
/* Multi-level chain resolution                                        */
/* ------------------------------------------------------------------ */

/** Result of resolving a multi-output recipe chain to its raw ore source. */
export interface ChainResolution {
  /** The true raw ore typeId at the bottom of the chain. */
  rawOreTypeId: number;
  /** Ore units consumed per run of the bottom recipe. */
  rawInputPerRun: number;
  /**
   * Recipes from bottom (raw ore → first intermediate) to top
   * (last intermediate → the resolved intermediate).
   */
  chain: RecipeData[];
}

/**
 * Recursively resolve an intermediate to its raw ore source by following
 * primary-output recipes in the byproductIndex.
 *
 * Returns null if `typeId` is not the primary output of any multi-output
 * recipe (i.e. it is already a raw ore or only appears as a byproduct),
 * unless `recipesByOutput` is provided and contains a single-output recipe
 * chain leading to a raw ore.
 */
export function resolveToRawOre(
  typeId: number,
  byproductIndex: Map<number, RefiningSource[]>,
  visited?: Set<number>,
  recipesByOutput?: Map<number, RecipeData>,
): ChainResolution | null {
  const v = visited ?? new Set<number>();

  const sources = byproductIndex.get(typeId);

  // Only follow the recipe where typeId is the PRIMARY output.
  const primarySource = sources?.find((s) => s.recipe.outputTypeId === typeId);

  if (primarySource) {
    const recipe = primarySource.recipe;
    const inputTypeId = recipe.inputs[0]?.typeId;
    if (inputTypeId == null || v.has(typeId)) return null;

    v.add(typeId);
    const deeper = resolveToRawOre(inputTypeId, byproductIndex, v, recipesByOutput);
    v.delete(typeId);

    if (deeper) {
      return {
        rawOreTypeId: deeper.rawOreTypeId,
        rawInputPerRun: deeper.rawInputPerRun,
        chain: [...deeper.chain, recipe],
      };
    }

    // If the recursive call returned null but inputTypeId has a primary-output
    // recipe, the null was caused by a cycle — propagate it.
    const inputSources = byproductIndex.get(inputTypeId);
    if (inputSources?.some((s) => s.recipe.outputTypeId === inputTypeId)) {
      return null;
    }

    return {
      rawOreTypeId: inputTypeId,
      rawInputPerRun: recipe.inputs[0].quantity,
      chain: [recipe],
    };
  }

  // Fallback: trace through single-output recipes (not in byproductIndex).
  // This handles intermediates like Iron-Rich Nodules that are the sole output
  // of a refining recipe (e.g. Iridosmine Nodules → Iron-Rich Nodules) before
  // being consumed by a multi-output recipe.
  if (recipesByOutput && !v.has(typeId)) {
    const fallbackRecipe = recipesByOutput.get(typeId);
    if (fallbackRecipe) {
      const inputTypeId = fallbackRecipe.inputs[0]?.typeId;
      if (inputTypeId != null) {
        v.add(typeId);
        const deeper = resolveToRawOre(inputTypeId, byproductIndex, v, recipesByOutput);
        v.delete(typeId);

        if (deeper) {
          return {
            rawOreTypeId: deeper.rawOreTypeId,
            rawInputPerRun: deeper.rawInputPerRun,
            chain: [...deeper.chain, fallbackRecipe],
          };
        }

        return {
          rawOreTypeId: inputTypeId,
          rawInputPerRun: fallbackRecipe.inputs[0].quantity,
          chain: [fallbackRecipe],
        };
      }
    }
  }

  return null;
}

/**
 * Build a map from recipe-input typeIds to the demand-producing recipes
 * that consume them.  Used for byproduct-to-demand tracing.
 */
export function buildIntermediateInputMap(
  demand: ReadonlyMap<number, number>,
  byproductIndex: Map<number, RefiningSource[]>,
): Map<number, { recipe: RecipeData }[]> {
  const map = new Map<number, { recipe: RecipeData }[]>();

  for (const [demandTypeId] of demand) {
    const sources = byproductIndex.get(demandTypeId);
    if (!sources) continue;
    for (const source of sources) {
      const inputTypeId = source.recipe.inputs[0]?.typeId;
      if (inputTypeId == null) continue;
      const list = map.get(inputTypeId) ?? [];
      if (!list.some((e) => e.recipe === source.recipe)) {
        list.push({ recipe: source.recipe });
      }
      map.set(inputTypeId, list);
    }
  }

  return map;
}

/**
 * Compute compound outputs per raw-ore run for a (possibly multi-level)
 * refining chain, including byproduct-to-demand tracing.
 *
 * For multi-level chains the yield of each intermediate is cascaded through
 * successive recipe ratios.  Byproducts at each level that are not consumed
 * by the next recipe are traced: if a byproduct is the input to a
 * demand-producing recipe, the final demanded output (and its secondaries)
 * replace the raw byproduct in the output set.
 */
export function computeCompoundOutputs(
  topRecipe: RecipeData,
  resolution: ChainResolution | null,
  intermediateInputMap: Map<number, { recipe: RecipeData }[]>,
  demand: ReadonlyMap<number, number>,
): { typeId: number; quantityPerRun: number }[] {
  // ── Compute raw outputs per ore-run through the recipe chain ──
  const rawOutputs = new Map<number, number>();

  if (!resolution) {
    // Single-level: outputs are the topRecipe's outputs directly.
    rawOutputs.set(topRecipe.outputTypeId, topRecipe.outputQuantity);
    for (const so of topRecipe.secondaryOutputs ?? []) {
      rawOutputs.set(so.typeId, (rawOutputs.get(so.typeId) ?? 0) + so.quantity);
    }
  } else {
    // Multi-level: process chain + topRecipe from bottom to top.
    const allRecipes = [...resolution.chain, topRecipe];
    let scaleFactor = 1;

    for (let i = 0; i < allRecipes.length; i++) {
      const recipe = allRecipes[i];
      const outputs = [
        { typeId: recipe.outputTypeId, qty: recipe.outputQuantity * scaleFactor },
        ...(recipe.secondaryOutputs ?? []).map((so) => ({
          typeId: so.typeId,
          qty: so.quantity * scaleFactor,
        })),
      ];

      for (const { typeId, qty } of outputs) {
        // If this output feeds the next recipe in the chain, consume it.
        if (i + 1 < allRecipes.length && typeId === allRecipes[i + 1].inputs[0]?.typeId) {
          scaleFactor = qty / allRecipes[i + 1].inputs[0].quantity;
        } else {
          rawOutputs.set(typeId, (rawOutputs.get(typeId) ?? 0) + qty);
        }
      }
    }
  }

  // ── Byproduct-to-demand tracing ──
  const traced = new Map<number, number>();
  for (const [typeId, qty] of rawOutputs) {
    // Outputs that are already demanded stay as-is.
    if (demand.has(typeId)) {
      traced.set(typeId, (traced.get(typeId) ?? 0) + qty);
      continue;
    }

    // Check if this byproduct feeds into a demand-producing recipe.
    const consumers = intermediateInputMap.get(typeId);
    if (consumers && consumers.length > 0) {
      const { recipe } = consumers[0];
      const inputPerRun = recipe.inputs[0]?.quantity ?? 1;
      const runs = qty / inputPerRun;
      // Add all outputs of the consuming recipe.
      traced.set(
        recipe.outputTypeId,
        (traced.get(recipe.outputTypeId) ?? 0) + recipe.outputQuantity * runs,
      );
      for (const so of recipe.secondaryOutputs ?? []) {
        traced.set(so.typeId, (traced.get(so.typeId) ?? 0) + so.quantity * runs);
      }
    } else {
      // Not traceable to any demand — keep the raw byproduct.
      traced.set(typeId, (traced.get(typeId) ?? 0) + qty);
    }
  }

  return Array.from(traced.entries()).map(([typeId, quantityPerRun]) => ({
    typeId,
    quantityPerRun,
  }));
}

/* ------------------------------------------------------------------ */
/* Joint cross-ore optimization                                        */
/* ------------------------------------------------------------------ */

/** Internal model for an ore type during optimization. */
interface OreModel {
  recipe: RecipeData;
  oreTypeId: number;
  inputPerRun: number;
  outputs: { typeId: number; quantityPerRun: number }[];
  runs: number;
}

/**
 * Jointly optimize ore runs across all ore types to satisfy intermediate
 * demands with minimum total ore units mined.
 *
 * @param refiningDemands  intermediate typeId → total demand (pre-SSU)
 * @param nonRefiningLeaves  leaf materials not involved in multi-output refining
 * @param byproductIndex  reverse index from `buildByproductIndex`
 * @param ssuInventory  optional SSU inventory; on-hand intermediates are deducted
 */
export function optimizeOreUsage(
  refiningDemands: Map<number, number>,
  nonRefiningLeaves: LeafMaterial[],
  byproductIndex: Map<number, RefiningSource[]>,
  ssuInventory?: ReadonlyMap<number, number>,
  recipesByOutput?: Map<number, RecipeData>,
): OreSummary {
  // ── Net demand after SSU deduction ──
  const demand = new Map<number, number>();
  for (const [typeId, qty] of refiningDemands) {
    const net = Math.max(0, qty - (ssuInventory?.get(typeId) ?? 0));
    if (net > 0) demand.set(typeId, net);
  }

  if (demand.size === 0) {
    return { entries: [], totalOreUnits: 0, unoptimized: nonRefiningLeaves };
  }

  // ── Build ore models (with multi-level chain resolution) ──
  const oreModels = new Map<number, OreModel>();
  const intermediateInputMap = buildIntermediateInputMap(demand, byproductIndex);

  for (const [typeId] of demand) {
    const sources = byproductIndex.get(typeId);
    if (!sources) continue;

    for (const source of sources) {
      const directInputTypeId = source.recipe.inputs[0]?.typeId;
      if (directInputTypeId == null) continue;

      // Resolve through multi-output recipe chains to find the true raw ore.
      const resolution = resolveToRawOre(directInputTypeId, byproductIndex, undefined, recipesByOutput);
      const rawOreTypeId = resolution ? resolution.rawOreTypeId : directInputTypeId;
      const rawInputPerRun = resolution
        ? resolution.rawInputPerRun
        : source.recipe.inputs[0].quantity;
      const bottomRecipe = resolution ? resolution.chain[0] : source.recipe;

      if (!oreModels.has(rawOreTypeId)) {
        oreModels.set(rawOreTypeId, {
          recipe: bottomRecipe,
          oreTypeId: rawOreTypeId,
          inputPerRun: rawInputPerRun,
          outputs: computeCompoundOutputs(source.recipe, resolution, intermediateInputMap, demand),
          runs: 0,
        });
      } else {
        // Same raw ore reached from a different demand — merge new outputs.
        const existing = oreModels.get(rawOreTypeId)!;
        const newOutputs = computeCompoundOutputs(
          source.recipe, resolution, intermediateInputMap, demand,
        );
        for (const out of newOutputs) {
          if (!existing.outputs.some((o) => o.typeId === out.typeId)) {
            existing.outputs.push(out);
          }
        }
      }
    }
  }

  // Build intermediateToOres from ore model output sets so that cross-chain
  // byproduct connections are captured (e.g. FC produces both FCS and Tholin).
  const intermediateToOres = new Map<number, number[]>();
  for (const [rawOreId, model] of oreModels) {
    for (const out of model.outputs) {
      if (demand.has(out.typeId)) {
        const ores = intermediateToOres.get(out.typeId) ?? [];
        if (!ores.includes(rawOreId)) ores.push(rawOreId);
        intermediateToOres.set(out.typeId, ores);
      }
    }
  }

  // ── Phase 1: Forced ores ──
  const remaining = new Map(demand);

  for (const [typeId, ores] of intermediateToOres) {
    if (ores.length !== 1) continue;
    const model = oreModels.get(ores[0])!;
    const needed = remaining.get(typeId) ?? 0;
    if (needed <= 0) continue;

    const out = model.outputs.find((o) => o.typeId === typeId);
    if (!out) continue;

    model.runs = Math.max(model.runs, Math.ceil(needed / out.quantityPerRun));
  }

  // ── Phase 2: Surplus propagation from forced ores ──
  for (const [, model] of oreModels) {
    if (model.runs === 0) continue;
    for (const out of model.outputs) {
      const cur = remaining.get(out.typeId);
      if (cur != null && cur > 0) {
        remaining.set(out.typeId, Math.max(0, cur - out.quantityPerRun * model.runs));
      }
    }
  }

  // ── Phase 3: Greedy fill for remaining shared demands ──
  for (let iter = 0; iter < 100; iter++) {
    let bestTypeId = -1;
    let bestQty = 0;
    for (const [typeId, qty] of remaining) {
      if (qty > bestQty) { bestQty = qty; bestTypeId = typeId; }
    }
    if (bestQty <= 0) break;

    const candidateOres = intermediateToOres.get(bestTypeId);
    if (!candidateOres || candidateOres.length === 0) break;

    // Pick the most ore-efficient source.
    let bestOreId = candidateOres[0];
    let bestEff = 0;
    for (const oreId of candidateOres) {
      const m = oreModels.get(oreId)!;
      const o = m.outputs.find((x) => x.typeId === bestTypeId);
      if (!o) continue;
      const eff = o.quantityPerRun / m.inputPerRun;
      if (eff > bestEff) { bestEff = eff; bestOreId = oreId; }
    }

    const model = oreModels.get(bestOreId)!;
    const output = model.outputs.find((o) => o.typeId === bestTypeId);
    if (!output) break;

    const additional = Math.ceil(bestQty / output.quantityPerRun);
    model.runs += additional;

    for (const out of model.outputs) {
      const cur = remaining.get(out.typeId);
      if (cur != null && cur > 0) {
        remaining.set(out.typeId, Math.max(0, cur - out.quantityPerRun * additional));
      }
    }
  }

  // ── Build OreSummary entries ──
  // Attribute demand to each ore by consuming from a shrinking pool.
  const remainingForAttribution = new Map(demand);
  const entries: OreSummaryEntry[] = [];

  for (const [, model] of oreModels) {
    if (model.runs === 0) continue;

    const products: OreProduct[] = model.outputs.map((out) => {
      const produced = out.quantityPerRun * model.runs;
      const totalNeeded = remainingForAttribution.get(out.typeId) ?? 0;
      const attributed = Math.min(produced, totalNeeded);
      if (totalNeeded > 0) {
        remainingForAttribution.set(out.typeId, totalNeeded - attributed);
      }
      return {
        typeId: out.typeId,
        needed: attributed,
        produced,
        surplus: Math.max(0, produced - attributed),
      };
    });

    entries.push({
      oreTypeId: model.oreTypeId,
      totalUnits: model.inputPerRun * model.runs,
      runs: model.runs,
      inputPerRun: model.inputPerRun,
      products,
    });
  }

  // Any remaining refining demands not covered go to unoptimized.
  const extraUnoptimized: LeafMaterial[] = [];
  for (const [typeId, qty] of remaining) {
    if (qty > 0) extraUnoptimized.push({ typeId, quantity: qty });
  }

  entries.sort((a, b) => b.totalUnits - a.totalUnits);
  const totalOreUnits = entries.reduce((sum, e) => sum + e.totalUnits, 0);
  const unoptimized = [...nonRefiningLeaves, ...extraUnoptimized];

  return { entries, totalOreUnits, unoptimized };
}
