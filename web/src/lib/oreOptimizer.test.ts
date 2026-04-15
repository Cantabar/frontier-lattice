import { describe, it, expect } from "vitest";
import type { RecipeData } from "./types";
import {
  buildByproductIndex,
  buildRecipesByOutput,
  resolveToRawOre,
  buildIntermediateInputMap,
  computeCompoundOutputs,
  optimizeOreUsage,
  collectRefiningDemands,
} from "./oreOptimizer";
import type { ResolvedNode } from "../hooks/useOptimizer";

/* ------------------------------------------------------------------ */
/* Test fixtures modelling the TADES refining chains                    */
/* ------------------------------------------------------------------ */

// Type IDs (arbitrary but consistent)
const FC = 1;   // Feldspar Crystals   (RAW)
const HSM = 2;  // Hydrated Sulfide Matrix (RAW)
const SG = 10;  // Silica Grains       (intermediate)
const HR = 11;  // Hydrocarbon Residue (intermediate)
const FCS = 20; // Feldspar Crystal Shards (demanded)
const SD = 21;  // Silicon Dust        (byproduct)
const THOL = 30; // Tholin Aggregates  (demanded)
const TROL = 31; // Troilite Sulfide Grains (byproduct)
const WI = 32;  // Water Ice           (byproduct)

// Iron-Rich single-level chain
const IR = 3;   // Iron-Rich Nodules   (RAW)
const NFV = 40; // Nickel-Iron Veins   (demanded)
const PGV = 41; // Platinum-Group Veins (byproduct)

// BP#1201: 40 FC → 30 SG + 10 HR
const recipe1201: RecipeData = {
  outputTypeId: SG,
  outputQuantity: 30,
  secondaryOutputs: [{ typeId: HR, quantity: 10 }],
  inputs: [{ typeId: FC, quantity: 40 }],
  runTime: 1,
};

// BP#1190: 20 SG → 50 FCS + 150 SD
const recipe1190: RecipeData = {
  outputTypeId: FCS,
  outputQuantity: 50,
  secondaryOutputs: [{ typeId: SD, quantity: 150 }],
  inputs: [{ typeId: SG, quantity: 20 }],
  runTime: 1,
};

// BP#1203: 40 HSM → 20 HR + 200 WI
const recipe1203: RecipeData = {
  outputTypeId: HR,
  outputQuantity: 20,
  secondaryOutputs: [{ typeId: WI, quantity: 200 }],
  inputs: [{ typeId: HSM, quantity: 40 }],
  runTime: 1,
};

// BP#1186: 20 HR → 180 THOL + 20 TROL
const recipe1186: RecipeData = {
  outputTypeId: THOL,
  outputQuantity: 180,
  secondaryOutputs: [{ typeId: TROL, quantity: 20 }],
  inputs: [{ typeId: HR, quantity: 20 }],
  runTime: 1,
};

// BP#1192: 10 IR → 198 NFV + 20 PGV
const recipe1192: RecipeData = {
  outputTypeId: NFV,
  outputQuantity: 198,
  secondaryOutputs: [{ typeId: PGV, quantity: 20 }],
  inputs: [{ typeId: IR, quantity: 10 }],
  runTime: 1,
};

const allRecipes: RecipeData[] = [
  recipe1201, recipe1190, recipe1203, recipe1186, recipe1192,
];

// Iron-Rich Nodules regression: single-output intermediate chain
// IRI (raw ore) → IRN (single-output) → NFV + PGV (multi-output)
const IRI = 4;   // Iridosmine Nodules (RAW) — modelled after real typeId 78426
// BP#1204: 40 IRI → 40 IRN  (single-output — NOT in byproductIndex)
const recipe1204: RecipeData = {
  outputTypeId: IR,
  outputQuantity: 40,
  inputs: [{ typeId: IRI, quantity: 40 }],
  runTime: 5,
};

const allRecipesWithIridosmine: RecipeData[] = [...allRecipes, recipe1204];

/* ------------------------------------------------------------------ */
/* resolveToRawOre                                                     */
/* ------------------------------------------------------------------ */

describe("resolveToRawOre", () => {
  const bpIdx = buildByproductIndex(allRecipes);

  it("returns null for a raw ore (not in byproductIndex)", () => {
    expect(resolveToRawOre(FC, bpIdx)).toBeNull();
    expect(resolveToRawOre(HSM, bpIdx)).toBeNull();
    expect(resolveToRawOre(IR, bpIdx)).toBeNull();
  });

  it("returns null for a type only produced as a byproduct (no primary)", () => {
    // SD is only a secondary output of recipe1190 — no primary source
    expect(resolveToRawOre(SD, bpIdx)).toBeNull();
    // WI is only a secondary output of recipe1203
    expect(resolveToRawOre(WI, bpIdx)).toBeNull();
  });

  it("resolves a single-level intermediate (SG → FC)", () => {
    const res = resolveToRawOre(SG, bpIdx);
    expect(res).not.toBeNull();
    expect(res!.rawOreTypeId).toBe(FC);
    expect(res!.rawInputPerRun).toBe(40);
    expect(res!.chain).toHaveLength(1);
    expect(res!.chain[0]).toBe(recipe1201);
  });

  it("resolves a single-level intermediate (HR → HSM)", () => {
    const res = resolveToRawOre(HR, bpIdx);
    expect(res).not.toBeNull();
    expect(res!.rawOreTypeId).toBe(HSM);
    expect(res!.rawInputPerRun).toBe(40);
    expect(res!.chain).toHaveLength(1);
    expect(res!.chain[0]).toBe(recipe1203);
  });

  it("does not resolve a demanded output (FCS — primary of recipe1190)", () => {
    // FCS is the primary output of recipe1190.  Its input is SG which
    // resolves further, but resolveToRawOre is only called on intermediates,
    // not demanded outputs.  Still, it should resolve: FCS → SG → FC.
    const res = resolveToRawOre(FCS, bpIdx);
    expect(res).not.toBeNull();
    expect(res!.rawOreTypeId).toBe(FC);
    expect(res!.chain).toHaveLength(2);
    expect(res!.chain[0]).toBe(recipe1201);
    expect(res!.chain[1]).toBe(recipe1190);
  });

  it("resolves single-output intermediate to raw ore via recipesByOutput fallback", () => {
    // IR is an intermediate produced by a single-output recipe (recipe1204: IRI → IR).
    // Without recipesByOutput, resolveToRawOre(IR) returns null (no multi-output recipe).
    // With recipesByOutput, it should resolve IR → IRI.
    const bpIdxIri = buildByproductIndex(allRecipesWithIridosmine);
    const rbo = buildRecipesByOutput(allRecipesWithIridosmine);

    const resWithout = resolveToRawOre(IR, bpIdxIri);
    expect(resWithout).toBeNull();

    const resWith = resolveToRawOre(IR, bpIdxIri, undefined, rbo);
    expect(resWith).not.toBeNull();
    expect(resWith!.rawOreTypeId).toBe(IRI);
    expect(resWith!.rawInputPerRun).toBe(40);
    expect(resWith!.chain).toHaveLength(1);
    expect(resWith!.chain[0]).toBe(recipe1204);
  });

  it("handles cycles gracefully", () => {
    // Fabricate a cycle: A → B → A
    const cycleA: RecipeData = {
      outputTypeId: 900,
      outputQuantity: 10,
      secondaryOutputs: [{ typeId: 902, quantity: 5 }],
      inputs: [{ typeId: 901, quantity: 10 }],
      runTime: 1,
    };
    const cycleB: RecipeData = {
      outputTypeId: 901,
      outputQuantity: 10,
      secondaryOutputs: [{ typeId: 903, quantity: 5 }],
      inputs: [{ typeId: 900, quantity: 10 }],
      runTime: 1,
    };
    const cycleIdx = buildByproductIndex([cycleA, cycleB]);
    // Should not infinite-loop; returns null due to cycle guard.
    const res = resolveToRawOre(900, cycleIdx);
    expect(res).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* computeCompoundOutputs                                              */
/* ------------------------------------------------------------------ */

describe("computeCompoundOutputs", () => {
  const bpIdx = buildByproductIndex(allRecipes);

  it("single-level: returns recipe outputs directly", () => {
    const demand = new Map<number, number>([[NFV, 1000]]);
    const inputMap = buildIntermediateInputMap(demand, bpIdx);
    const outputs = computeCompoundOutputs(recipe1192, null, inputMap, demand);

    const nfv = outputs.find((o) => o.typeId === NFV);
    const pgv = outputs.find((o) => o.typeId === PGV);
    expect(nfv?.quantityPerRun).toBe(198);
    expect(pgv?.quantityPerRun).toBe(20);
  });

  it("two-level chain: FC → SG → FCS, with HR byproduct traced to Tholin", () => {
    const demand = new Map<number, number>([
      [FCS, 43680],
      [THOL, 117180],
    ]);
    const inputMap = buildIntermediateInputMap(demand, bpIdx);
    const resolution = resolveToRawOre(SG, bpIdx)!;

    const outputs = computeCompoundOutputs(recipe1190, resolution, inputMap, demand);

    // Per FC run (recipe1201): 30 SG + 10 HR
    // SG consumed by recipe1190: 30/20 = 1.5 runs → 75 FCS + 225 SD
    // HR traced via recipe1186: 10/20 = 0.5 runs → 90 THOL + 10 TROL
    const fcs = outputs.find((o) => o.typeId === FCS);
    const sd = outputs.find((o) => o.typeId === SD);
    const thol = outputs.find((o) => o.typeId === THOL);
    const trol = outputs.find((o) => o.typeId === TROL);

    expect(fcs?.quantityPerRun).toBe(75);
    expect(sd?.quantityPerRun).toBe(225);
    expect(thol?.quantityPerRun).toBe(90);
    expect(trol?.quantityPerRun).toBe(10);
    // SG and HR should NOT appear (consumed internally / traced)
    expect(outputs.find((o) => o.typeId === SG)).toBeUndefined();
    expect(outputs.find((o) => o.typeId === HR)).toBeUndefined();
  });

  it("two-level chain: HSM → HR → Tholin, with WI byproduct kept raw", () => {
    const demand = new Map<number, number>([[THOL, 117180]]);
    const inputMap = buildIntermediateInputMap(demand, bpIdx);
    const resolution = resolveToRawOre(HR, bpIdx)!;

    const outputs = computeCompoundOutputs(recipe1186, resolution, inputMap, demand);

    // Per HSM run (recipe1203): 20 HR + 200 WI
    // HR consumed by recipe1186: 20/20 = 1 run → 180 THOL + 20 TROL
    // WI not traceable → kept as-is
    const thol = outputs.find((o) => o.typeId === THOL);
    const trol = outputs.find((o) => o.typeId === TROL);
    const wi = outputs.find((o) => o.typeId === WI);

    expect(thol?.quantityPerRun).toBe(180);
    expect(trol?.quantityPerRun).toBe(20);
    expect(wi?.quantityPerRun).toBe(200);
    expect(outputs.find((o) => o.typeId === HR)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* optimizeOreUsage integration                                        */
/* ------------------------------------------------------------------ */

describe("optimizeOreUsage integration", () => {
  const bpIdx = buildByproductIndex(allRecipes);

  it("resolves TADES-like demands to raw ores with cross-chain HR credit", () => {
    const demands = new Map<number, number>([
      [FCS, 43680],
      [THOL, 117180],
      [NFV, 39900],
    ]);
    const result = optimizeOreUsage(demands, [], bpIdx);

    // Should have 3 ore entries: FC, HSM, IR
    const oreTypeIds = result.entries.map((e) => e.oreTypeId).sort((a, b) => a - b);
    expect(oreTypeIds).toEqual([FC, HSM, IR].sort((a, b) => a - b));

    // FC should satisfy all FCS demand + partial Tholin via HR byproduct
    const fcEntry = result.entries.find((e) => e.oreTypeId === FC)!;
    expect(fcEntry).toBeDefined();
    // FC runs needed for FCS: ceil(43680 / 75) = 583
    expect(fcEntry.runs).toBe(583);
    expect(fcEntry.inputPerRun).toBe(40);
    expect(fcEntry.totalUnits).toBe(583 * 40);

    // FC's Tholin output: 583 * 90 = 52470
    // Remaining Tholin: 117180 - 52470 = 64710
    // HSM runs: ceil(64710 / 180) = 360
    const hsmEntry = result.entries.find((e) => e.oreTypeId === HSM)!;
    expect(hsmEntry).toBeDefined();
    expect(hsmEntry.runs).toBe(360);
    expect(hsmEntry.inputPerRun).toBe(40);
    expect(hsmEntry.totalUnits).toBe(360 * 40);

    // IR: ceil(39900 / 198) = 202
    const irEntry = result.entries.find((e) => e.oreTypeId === IR)!;
    expect(irEntry.runs).toBe(202);

    // Total ore should be FC + HSM + IR
    expect(result.totalOreUnits).toBe(583 * 40 + 360 * 40 + 202 * 10);
  });

  it("SSU inventory deducts from intermediate demands", () => {
    const demands = new Map<number, number>([[FCS, 1000]]);
    // SSU has enough FCS to satisfy demand
    const ssu = new Map<number, number>([[FCS, 1000]]);
    const result = optimizeOreUsage(demands, [], bpIdx, ssu);

    expect(result.entries).toHaveLength(0);
    expect(result.totalOreUnits).toBe(0);
  });

  it("handles single-level chains unchanged", () => {
    const demands = new Map<number, number>([[NFV, 1000]]);
    const result = optimizeOreUsage(demands, [], bpIdx);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].oreTypeId).toBe(IR);
    // ceil(1000 / 198) = 6 runs
    expect(result.entries[0].runs).toBe(6);
  });

  it("resolves single-output intermediate (IRI → IR → NFV) to raw ore IRI", () => {
    // This is the Iron-Rich Nodules regression:
    // recipe1204 (IRI → IR, single-output) is NOT in byproductIndex.
    // Without recipesByOutput, IR would be listed as the ore.
    // With recipesByOutput, the ore summary should show IRI instead.
    const bpIdxIri = buildByproductIndex(allRecipesWithIridosmine);
    const rbo = buildRecipesByOutput(allRecipesWithIridosmine);
    const demands = new Map<number, number>([[NFV, 1980]]);

    const result = optimizeOreUsage(demands, [], bpIdxIri, undefined, rbo);

    expect(result.entries).toHaveLength(1);
    // IRI (Iridosmine-like raw ore) must be the ore, not IR (intermediate)
    expect(result.entries[0].oreTypeId).toBe(IRI);
    // Compound outputs per ore run (1 run of recipe1204 = 40 IRI):
    //   recipe1204: 40 IRI → 40 IR; recipe1192: 10 IR → 198 NFV + 20 PGV
    //   scale factor = 40 IR / 10 IR per recipe1192 run = 4 recipe1192 runs
    //   NFV per ore run = 198 * 4 = 792
    // Ore runs needed = ceil(1980 / 792) = 3; IRI units = 3 * 40 = 120
    expect(result.entries[0].runs).toBe(3);
    expect(result.entries[0].totalUnits).toBe(120);
  });
});
