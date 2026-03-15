#!/usr/bin/env node
/**
 * build-blueprints.mjs
 *
 * Reads industry_blueprints.json, industry_facilities.json, types.json,
 * and web/public/items.json to produce web/public/blueprints.json with
 * resolved names, icons, categories, and facility information.
 *
 * Usage:  node scripts/build-blueprints.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FSD = resolve(ROOT, "static-data/data/phobos/fsd_built");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ── Load source data ──────────────────────────────────────────────

const blueprintsRaw = loadJson(resolve(FSD, "industry_blueprints.json"));
const facilitiesRaw = loadJson(resolve(FSD, "industry_facilities.json"));
const typesRaw = loadJson(resolve(FSD, "types.json"));
const items = loadJson(resolve(ROOT, "web/public/items.json"));

// Build a typeId → item lookup
const itemMap = new Map();
for (const item of items) {
  itemMap.set(item.typeId, item);
}

// Facility family keyword map — order matters (first match wins)
const FACILITY_FAMILY_KEYWORDS = [
  ["Printer", "Printers"],
  ["Refinery", "Refineries"],
  ["Berth", "Berths"],
  ["Assembler", "Assemblers"],
  ["Nursery", "Nurseries"],
];

function deriveFacilityFamily(name) {
  for (const [keyword, family] of FACILITY_FAMILY_KEYWORDS) {
    if (name.includes(keyword)) return family;
  }
  return "Other";
}

// Build inverted map: blueprintID → [{ facilityTypeId, facilityName, facilityFamily }]
const blueprintFacilities = new Map();
for (const [facilityTypeId, facility] of Object.entries(facilitiesRaw)) {
  const typeId = Number(facilityTypeId);
  const facilityName = typesRaw[facilityTypeId]?.typeName ?? `Facility ${facilityTypeId}`;
  const facilityFamily = deriveFacilityFamily(facilityName);
  for (const entry of facility.blueprints) {
    const bpId = entry.blueprintID;
    if (!blueprintFacilities.has(bpId)) {
      blueprintFacilities.set(bpId, []);
    }
    blueprintFacilities.get(bpId).push({ facilityTypeId: typeId, facilityName, facilityFamily });
  }
}

// ── Helpers: derive slot type & size class from item tags ─────────

const SLOT_TAGS = { high_slot: "high", mid_slot: "mid", low_slot: "low", engine_slot: "engine" };
const SIZE_TAGS = { small_size: "small", medium_size: "medium", large_size: "large" };

function deriveSlotType(tags) {
  if (!tags) return null;
  for (const [tag, slot] of Object.entries(SLOT_TAGS)) {
    if (tags.includes(tag)) return slot;
  }
  return null;
}

function deriveSizeClass(tags) {
  if (!tags) return null;
  for (const [tag, size] of Object.entries(SIZE_TAGS)) {
    if (tags.includes(tag)) return size;
  }
  return null;
}

// ── Transform each blueprint ──────────────────────────────────────

const blueprints = [];

for (const [bpId, bp] of Object.entries(blueprintsRaw)) {
  const primaryTypeId = bp.primaryTypeID;
  const firstOutputTypeId = bp.outputs[0]?.typeID;

  // Resolve the item metadata — prefer primaryTypeID, fall back to first output
  const item = itemMap.get(primaryTypeId) ?? itemMap.get(firstOutputTypeId);

  blueprints.push({
    blueprintId: Number(bpId),
    primaryTypeId,
    primaryName: item?.name ?? `Type ${primaryTypeId}`,
    primaryIcon: item?.icon ?? null,
    primaryCategoryName: item?.categoryName ?? null,
    primaryGroupName: item?.groupName ?? null,
    primaryMetaGroupName: item?.metaGroupName ?? null,
    slotType: deriveSlotType(item?.tags),
    sizeClass: deriveSizeClass(item?.tags),
    runTime: bp.runTime,
    outputs: bp.outputs.map((o) => ({ typeId: o.typeID, quantity: o.quantity })),
    inputs: bp.inputs.map((i) => ({ typeId: i.typeID, quantity: i.quantity })),
    facilities: blueprintFacilities.get(Number(bpId)) ?? [],
  });
}

// Sort by category → group → name for stable default order
blueprints.sort((a, b) => {
  const catCmp = (a.primaryCategoryName ?? "").localeCompare(b.primaryCategoryName ?? "");
  if (catCmp !== 0) return catCmp;
  const grpCmp = (a.primaryGroupName ?? "").localeCompare(b.primaryGroupName ?? "");
  if (grpCmp !== 0) return grpCmp;
  return a.primaryName.localeCompare(b.primaryName);
});

// ── Write output ──────────────────────────────────────────────────

const dest = resolve(ROOT, "web/public/blueprints.json");
writeFileSync(dest, JSON.stringify(blueprints, null, 2) + "\n");
console.log(`  ✓ ${dest.replace(ROOT + "/", "")} (${blueprints.length} blueprints)`);
