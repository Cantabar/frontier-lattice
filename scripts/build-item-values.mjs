#!/usr/bin/env node
/**
 * build-item-values.mjs
 *
 * Computes a baseline LUX value for every item based on time-to-produce.
 *
 * Three anchor correlations:
 *   1. LUX ↔ Time:  ~100,000 LUX per hour  →  ~27.78 LUX/second
 *   2. Ore ↔ Time:  Small Cutting Laser mines 26 m³ per 4s cycle
 *                    → 6.5 ore units/second (all ores are 1 m³/unit)
 *   3. Crude ↔ Time: Crude Extractor mines 54 m³ per 60s cycle
 *                     with 3× lens → 162 m³/cycle (2.7 units/s)
 *                     + amortised lens consumable cost
 *
 * Items that must be found in the game world (no production blueprint)
 * are assigned a baseline LUX value expressed as a multiple of Carbon
 * Weave's computed value, or back-traced from refinery output values.
 *
 * Usage:  node scripts/build-item-values.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ── Load source data ──────────────────────────────────────────────

const items = loadJson(resolve(ROOT, "web/public/items.json"));
const blueprints = loadJson(resolve(ROOT, "web/public/blueprints.json"));

// ── Constants ─────────────────────────────────────────────────────

// LUX income assumption
const LUX_PER_HOUR = 100_000;
const LUX_PER_SECOND = LUX_PER_HOUR / 3600;

// Small Cutting Laser (typeId 77852) dogma attributes:
//   attr 73 (cycle time)   = 4000 ms  → 4 s
//   attr 77 (mining amount) = 26 m³ per cycle
const MINING_CYCLE_SECONDS = 4;
const MINING_VOLUME_PER_CYCLE = 26; // m³
const ORE_VOLUME = 1.0; // all asteroid ores are 1 m³/unit

const ORE_PER_SECOND = MINING_VOLUME_PER_CYCLE / MINING_CYCLE_SECONDS; // 6.5 units/s

// Crude Extractor (typeId 77484) dogma attributes:
//   attr 73 (cycle time)   = 60000 ms → 60 s
//   attr 77 (mining amount) = 54 m³ per cycle
// Used with a 3× mining lens (100,000 LUX per lens, 3 cycles per lens)
const CRUDE_CYCLE_SECONDS = 60;
const CRUDE_VOLUME_PER_CYCLE_BASE = 54; // m³
const CRUDE_LENS_MULTIPLIER = 3;
const CRUDE_LENS_LUX_COST = 100_000;
const CRUDE_LENS_CYCLES = 3;

const CRUDE_VOLUME_PER_CYCLE =
  CRUDE_VOLUME_PER_CYCLE_BASE * CRUDE_LENS_MULTIPLIER; // 162 m³
const CRUDE_ORE_PER_SECOND = CRUDE_VOLUME_PER_CYCLE / CRUDE_CYCLE_SECONDS; // 2.7 units/s
const CRUDE_LENS_COST_PER_UNIT =
  CRUDE_LENS_LUX_COST / (CRUDE_LENS_CYCLES * CRUDE_VOLUME_PER_CYCLE); // ~205.76 LUX

// Crude matter ore typeIds (mined with Crude Extractor, not Small Cutting Laser)
const CRUDE_MATTER_IDS = new Set([92394, 92414]); // Fine Young / Fine Old Crude Matter

// ── Found-in-world item baselines ─────────────────────────────────
//
// Items that must be found in the game world (no production blueprint).
// Values expressed as multiples of Carbon Weave's computed LUX value,
// except back-trace items (derived from refinery outputs) and loot
// commodities (flat 1 LUX).

const FOUND_ITEMS = new Map([
  // Crafting inputs — multiplier × Carbon Weave LUX
  [83818, { multiplier: 1 }],      // Fossilized Exotronics (common)
  [83891, { multiplier: 100 }],    // Gravionite (very rare)
  [83892, { multiplier: 10 }],     // Luminalis (rare)
  [83893, { multiplier: 100 }],    // Eclipsite (very rare)
  [83894, { multiplier: 10 }],     // Radiantium (rare)
  [83899, { multiplier: 10 }],     // Catalytic Dust (very rare, bulk)
  [88564, { multiplier: 1 }],      // Feral Echo (common)

  // Back-trace items — value derived from best refinery output
  [88764, { backTrace: true }],    // Salvaged Materials (rare)
  [88765, { backTrace: true }],    // Mummified Clone (rare)

  // Stack Slices — 1000× (very very rare, unique location NPC drops)
  [89980, { multiplier: 1000 }],   // Stack Slice 5DZ
  [89981, { multiplier: 1000 }],   // Stack Slice 5DW
  [89982, { multiplier: 1000 }],   // Stack Slice 5DK
  [89983, { multiplier: 1000 }],   // Stack Slice 5DE
  [89984, { multiplier: 1000 }],   // Stack Slice 5C0
  [89985, { multiplier: 1000 }],   // Stack Slice 5C1
  [89986, { multiplier: 1000 }],   // Stack Slice 31P
  [89987, { multiplier: 1000 }],   // Stack Slice 31V
  [89988, { multiplier: 1000 }],   // Stack Slice 31Q
  [89989, { multiplier: 1000 }],   // Stack Slice 31F

  // Technocores
  [89087, { multiplier: 100 }],    // Synod Technocore (very rare)
  [89088, { multiplier: 1000 }],   // Exclave Technocore (very very rare)

  // Loot commodities — flat 1 LUX each (no use-case)
  [83978, { luxValue: 1 }],        // Navigational Artefact
  [83979, { luxValue: 1 }],        // Oil Painting
  [83980, { luxValue: 1 }],        // Stranger's Head
  [83981, { luxValue: 1 }],        // Miner Hiring Form
  [83982, { luxValue: 1 }],        // Network Pollinator
  [83983, { luxValue: 1 }],        // Old Neurocord
  [83984, { luxValue: 1 }],        // Synod Propaganda
  [83985, { luxValue: 1 }],        // Normalization Permit
  [83986, { luxValue: 1 }],        // Very Strange Musical Instrument
  [83987, { luxValue: 1 }],        // Multimedia Library
  [83988, { luxValue: 1 }],        // Drone Signal Records
]);

// Excluded items — not written to output
const EXCLUDED_IDS = new Set([85156]); // Forager (retired starter ship)

// ── Item & blueprint lookups ──────────────────────────────────────

const itemMap = new Map(); // typeId → item
for (const item of items) {
  itemMap.set(item.typeId, item);
}

// Facility tier ordering — prefer the most accessible (smallest) facility
const FACILITY_TIER = {
  "Field Refinery": 0,
  "Field Printer": 0,
  "Field Storage": 0,
  "Mini Printer": 1,
  "Mini Berth": 1,
  Refinery: 2,
  Printer: 2,
  Berth: 2,
  Assembler: 2,
  Nursery: 2,
  "Heavy Refinery": 3,
  "Heavy Printer": 3,
  "Heavy Berth": 3,
  Refuge: 4,
};

function facilityTier(bp) {
  if (!bp.facilities || bp.facilities.length === 0) return 99;
  return Math.min(
    ...bp.facilities.map((f) => FACILITY_TIER[f.facilityName] ?? 50)
  );
}

// Build reverse lookup: typeId → blueprints that produce it (as an output)
const producedBy = new Map(); // typeId → blueprint[]

for (const bp of blueprints) {
  for (const out of bp.outputs) {
    if (!producedBy.has(out.typeId)) {
      producedBy.set(out.typeId, []);
    }
    producedBy.get(out.typeId).push(bp);
  }
}

// For each typeId, rank all blueprints that produce it (lowest facility tier first)
const rankedBlueprintsFor = new Map(); // typeId → [{ bp, outputEntry }]

for (const [typeId, bpList] of producedBy.entries()) {
  const sorted = [...bpList].sort((a, b) => {
    const tierDiff = facilityTier(a) - facilityTier(b);
    if (tierDiff !== 0) return tierDiff;
    return a.runTime - b.runTime;
  });

  rankedBlueprintsFor.set(
    typeId,
    sorted.map((bp) => ({
      bp,
      outputEntry: bp.outputs.find((o) => o.typeId === typeId),
    }))
  );
}

// ── Recursive valuation ───────────────────────────────────────────

// Memoization: typeId → { miningTime, craftTime } (seconds to produce 1 unit)
const memo = new Map();
const resolving = new Set(); // cycle detection

/**
 * Back-traces a found item's value from its best refinery/decomposition
 * blueprint.  Finds all blueprints where typeId is an INPUT, resolves
 * their outputs, and returns the per-unit time for the highest-value path.
 */
function resolveBackTrace(typeId) {
  let bestTimePerUnit = null;

  for (const bp of blueprints) {
    const inputEntry = bp.inputs.find((i) => i.typeId === typeId);
    if (!inputEntry) continue;

    let totalOutputTime = 0;
    let allResolved = true;

    for (const out of bp.outputs) {
      const outTime = resolveTime(out.typeId);
      if (outTime === null) {
        allResolved = false;
        break;
      }
      totalOutputTime += (outTime.miningTime + outTime.craftTime) * out.quantity;
    }

    if (!allResolved) continue;

    const perUnit = totalOutputTime / inputEntry.quantity;
    if (bestTimePerUnit === null || perUnit > bestTimePerUnit) {
      bestTimePerUnit = perUnit;
    }
  }

  return bestTimePerUnit !== null
    ? { miningTime: bestTimePerUnit, craftTime: 0 }
    : null;
}

/**
 * Attempts to resolve a single blueprint for typeId.
 * Returns { miningTime, craftTime } or null if inputs can't resolve.
 */
function tryBlueprint(typeId, bp, outputEntry) {
  let totalInputMiningTime = 0;
  let totalInputCraftTime = 0;

  for (const input of bp.inputs) {
    const inputTime = resolveTime(input.typeId);
    if (inputTime === null) return null;
    totalInputMiningTime += inputTime.miningTime * input.quantity;
    totalInputCraftTime += inputTime.craftTime * input.quantity;
  }

  // Blueprint craft time — split across outputs proportionally by volume
  const totalOutputVolume = bp.outputs.reduce((sum, o) => {
    const outItem = itemMap.get(o.typeId);
    return sum + (outItem ? outItem.volume : 1) * o.quantity;
  }, 0);

  const thisOutputVolume =
    ((itemMap.get(typeId)?.volume) ?? 1) * outputEntry.quantity;
  const volumeFraction =
    totalOutputVolume > 0 ? thisOutputVolume / totalOutputVolume : 1;

  const bpCraftTimeShare = bp.runTime * volumeFraction;
  const perUnitMiningTime = (totalInputMiningTime * volumeFraction) / outputEntry.quantity;
  const perUnitCraftTime =
    (totalInputCraftTime * volumeFraction + bpCraftTimeShare) / outputEntry.quantity;

  return { miningTime: perUnitMiningTime, craftTime: perUnitCraftTime };
}

/**
 * Returns { miningTime, craftTime } in seconds to produce 1 unit of typeId.
 * Tries ranked blueprints in order, falling back when inputs can't resolve.
 * Returns null if no production path exists.
 */
function resolveTime(typeId) {
  if (memo.has(typeId)) return memo.get(typeId);

  const item = itemMap.get(typeId);

  // Raw ores — value comes purely from mining time
  if (item && item.categoryName === "Asteroid") {
    let result;
    if (CRUDE_MATTER_IDS.has(typeId)) {
      // Crude matter uses the Crude Extractor with a 3× lens
      const miningTime = ORE_VOLUME / CRUDE_ORE_PER_SECOND;
      const lensCostAsTime = CRUDE_LENS_COST_PER_UNIT / LUX_PER_SECOND;
      result = { miningTime: miningTime + lensCostAsTime, craftTime: 0 };
    } else {
      const miningTime = ORE_VOLUME / ORE_PER_SECOND; // seconds per 1 ore unit
      result = { miningTime, craftTime: 0 };
    }
    memo.set(typeId, result);
    return result;
  }

  // No blueprint to produce this item
  if (!rankedBlueprintsFor.has(typeId)) {
    memo.set(typeId, null);
    return null;
  }

  // Cycle detection
  if (resolving.has(typeId)) {
    return null; // don't memo — let caller try next blueprint
  }
  resolving.add(typeId);

  // Try each ranked blueprint until one resolves
  let result = null;
  for (const { bp, outputEntry } of rankedBlueprintsFor.get(typeId)) {
    result = tryBlueprint(typeId, bp, outputEntry);
    if (result !== null) break;
  }

  resolving.delete(typeId);
  memo.set(typeId, result);
  return result;
}

// ── Pre-resolve found items ───────────────────────────────────────

// Resolve Carbon Weave first — its value is the baseline unit for
// found-item multipliers.
const carbonWeaveTime = resolveTime(84210); // Carbon Weave
const carbonWeaveLux = carbonWeaveTime
  ? (carbonWeaveTime.miningTime + carbonWeaveTime.craftTime) * LUX_PER_SECOND
  : 220.92; // fallback

// Seed multiplier and flat-value found items into memo
for (const [typeId, config] of FOUND_ITEMS) {
  if (config.multiplier != null) {
    const totalTime = (config.multiplier * carbonWeaveLux) / LUX_PER_SECOND;
    memo.set(typeId, { miningTime: totalTime, craftTime: 0 });
  } else if (config.luxValue != null) {
    const totalTime = config.luxValue / LUX_PER_SECOND;
    memo.set(typeId, { miningTime: totalTime, craftTime: 0 });
  }
}

// Seed back-trace found items (value from best refinery output)
for (const [typeId, config] of FOUND_ITEMS) {
  if (!config.backTrace) continue;
  memo.set(typeId, resolveBackTrace(typeId));
}

// ── Resolve all items ─────────────────────────────────────────────

for (const item of items) {
  resolveTime(item.typeId);
}

// Second pass: retry items that failed due to blueprint cycle ordering.
// e.g. D2 Fuel → Salt → (bp=1180 needs D2 Fuel → cycle) was memoised
// as null, but Salt resolves via alternative ore blueprints.  Now that
// Salt is cached the retry succeeds.
const retryIds = [];
for (const item of items) {
  if (memo.get(item.typeId) === null && rankedBlueprintsFor.has(item.typeId)) {
    retryIds.push(item.typeId);
  }
}
if (retryIds.length > 0) {
  for (const id of retryIds) memo.delete(id);
  for (const id of retryIds) resolveTime(id);
}

// ── Build results ─────────────────────────────────────────────────

const results = [];

for (const item of items) {
  if (EXCLUDED_IDS.has(item.typeId)) continue;

  const time = memo.get(item.typeId) ?? null;

  if (time === null) {
    results.push({
      typeId: item.typeId,
      name: item.name,
      categoryName: item.categoryName,
      luxValue: null,
      timeSeconds: null,
      source: "unknown",
      breakdown: null,
    });
    continue;
  }

  const totalTime = time.miningTime + time.craftTime;
  const luxValue = totalTime * LUX_PER_SECOND;

  let source;
  if (FOUND_ITEMS.has(item.typeId)) {
    source = "found";
  } else if (item.categoryName === "Asteroid") {
    source = "mining";
  } else if (time.craftTime > 0) {
    source = "crafted";
  } else {
    source = "mining";
  }

  results.push({
    typeId: item.typeId,
    name: item.name,
    categoryName: item.categoryName,
    luxValue: Math.round(luxValue * 100) / 100,
    timeSeconds: Math.round(totalTime * 1000) / 1000,
    source,
    breakdown: {
      miningTime: Math.round(time.miningTime * 1000) / 1000,
      craftTime: Math.round(time.craftTime * 1000) / 1000,
    },
  });
}

// Sort by typeId for stable output
results.sort((a, b) => a.typeId - b.typeId);

// ── Write output ──────────────────────────────────────────────────

const dest = resolve(ROOT, "web/public/item-values.json");
writeFileSync(dest, JSON.stringify(results, null, 2) + "\n");

// ── Summary ───────────────────────────────────────────────────────

const valued = results.filter((r) => r.luxValue !== null);
const unknown = results.filter((r) => r.luxValue === null);
const mining = valued.filter((r) => r.source === "mining");
const crafted = valued.filter((r) => r.source === "crafted");
const found = valued.filter((r) => r.source === "found");

console.log(`  ✓ ${dest.replace(ROOT + "/", "")} (${results.length} items)`);
console.log(`    ${valued.length} valued, ${unknown.length} unknown`);
console.log(
  `    ${mining.length} mining, ${crafted.length} crafted, ${found.length} found`
);

if (valued.length > 0) {
  const luxValues = valued.map((r) => r.luxValue);
  console.log(
    `    LUX range: ${Math.min(...luxValues).toLocaleString()} – ${Math.max(...luxValues).toLocaleString()}`
  );
}

if (unknown.length > 0) {
  console.log(`    Unknown items:`);
  for (const u of unknown) {
    console.log(`      - ${u.name} (${u.typeId}) [${u.categoryName}]`);
  }
}
