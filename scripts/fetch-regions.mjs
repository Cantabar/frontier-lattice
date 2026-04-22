#!/usr/bin/env node
/**
 * fetch-regions.mjs
 *
 * Fetches all constellations (with member solar systems) from the Stillness
 * World API and derives region + constellation reference data including
 * axis-aligned bounding boxes.
 *
 * Outputs:
 *   web/src/data/constellations.json
 *     Tuples: [constellationId, regionId, "name", "xMin", "xMax", "yMin", "yMax", "zMin", "zMax"]
 *
 *   web/src/data/regions.json
 *     Tuples: [regionId, "name", "xMin", "xMax", "yMin", "yMax", "zMin", "zMax"]
 *
 * Coordinates are string-encoded BigInts (can exceed MAX_SAFE_INTEGER).
 * Bounding boxes are computed from member system coordinates with a 1 LY
 * padding on each axis to avoid edge-case exclusions.
 *
 * Usage:  node scripts/fetch-regions.mjs
 */

import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const API_BASE =
  "https://world-api-stillness.live.tech.evefrontier.com";
const LIMIT = 100; // API max per request

/** 1 light-year in meters — used as padding on bounding boxes. */
const LY_PADDING = 9_460_730_472_580_800n;

// ============================================================
// Static data — region names
// ============================================================

const PHOBOS_DIR = resolve(ROOT, "static-data/data/phobos/resource_pickle");

/**
 * Loads Phobos static-data localization files and returns Map<regionId, name>.
 *
 * Parses 'region_<id>' out of labels with FullPath === 'Map/Regions',
 * then looks up translations[String(messageID)][0].
 */
function loadRegionNameMap() {
  const mainPath = resolve(PHOBOS_DIR, "res__localizationfsd_localization_fsd_main.json");
  const enUsPath = resolve(PHOBOS_DIR, "res__localizationfsd_localization_fsd_en-us.json");

  let mainRaw;
  let enUsRaw;
  try {
    mainRaw = JSON.parse(readFileSync(mainPath, "utf8"));
  } catch (err) {
    console.error(`Error: failed to read Phobos labels file at ${mainPath}: ${err.message}`);
    process.exit(1);
  }
  try {
    enUsRaw = JSON.parse(readFileSync(enUsPath, "utf8"));
  } catch (err) {
    console.error(`Error: failed to read Phobos translations file at ${enUsPath}: ${err.message}`);
    process.exit(1);
  }

  const labels = mainRaw.labels ?? {};
  const translations = enUsRaw[1] ?? {}; // index 1 is messageID → [text, ...]

  const names = new Map();
  for (const entry of Object.values(labels)) {
    if (entry.FullPath !== "Map/Regions") continue;
    const match = entry.label?.match(/^region_(\d+)$/);
    if (!match) continue;
    const regionId = Number(match[1]);
    const text = translations[String(entry.messageID)]?.[0];
    if (text) names.set(regionId, text);
  }

  return names;
}

// ============================================================
// Fetch
// ============================================================

async function fetchAllConstellations() {
  const constellations = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const url = `${API_BASE}/v2/constellations?limit=${LIMIT}&offset=${offset}`;
    console.log(`  Fetching offset ${offset}… (${constellations.length}/${total === Infinity ? "?" : total})`);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText} for ${url}`);
    }

    const json = await res.json();

    if (offset === 0) {
      total = json.metadata?.total ?? 0;
      if (!total) throw new Error("Could not determine total count from API response");
      console.log(`  Total constellations: ${total}`);
    }

    const items = json.data;
    if (!Array.isArray(items) || items.length === 0) break;

    constellations.push(...items);
    offset += items.length;
  }

  return constellations;
}

// ============================================================
// Bounding box computation
// ============================================================

function computeBoundingBox(systems) {
  let xMin = null;
  let xMax = null;
  let yMin = null;
  let yMax = null;
  let zMin = null;
  let zMax = null;

  for (const sys of systems) {
    const x = BigInt(sys.location.x);
    const y = BigInt(sys.location.y);
    const z = BigInt(sys.location.z);

    if (xMin === null || x < xMin) xMin = x;
    if (xMax === null || x > xMax) xMax = x;
    if (yMin === null || y < yMin) yMin = y;
    if (yMax === null || y > yMax) yMax = y;
    if (zMin === null || z < zMin) zMin = z;
    if (zMax === null || z > zMax) zMax = z;
  }

  // Add 1 LY padding on each side
  return {
    xMin: (xMin - LY_PADDING).toString(),
    xMax: (xMax + LY_PADDING).toString(),
    yMin: (yMin - LY_PADDING).toString(),
    yMax: (yMax + LY_PADDING).toString(),
    zMin: (zMin - LY_PADDING).toString(),
    zMax: (zMax + LY_PADDING).toString(),
  };
}

function mergeBounds(boundsArray) {
  let xMin = null;
  let xMax = null;
  let yMin = null;
  let yMax = null;
  let zMin = null;
  let zMax = null;

  for (const b of boundsArray) {
    const bxMin = BigInt(b.xMin);
    const bxMax = BigInt(b.xMax);
    const byMin = BigInt(b.yMin);
    const byMax = BigInt(b.yMax);
    const bzMin = BigInt(b.zMin);
    const bzMax = BigInt(b.zMax);

    if (xMin === null || bxMin < xMin) xMin = bxMin;
    if (xMax === null || bxMax > xMax) xMax = bxMax;
    if (yMin === null || byMin < yMin) yMin = byMin;
    if (yMax === null || byMax > yMax) yMax = byMax;
    if (zMin === null || bzMin < zMin) zMin = bzMin;
    if (zMax === null || bzMax > zMax) zMax = bzMax;
  }

  return {
    xMin: xMin.toString(),
    xMax: xMax.toString(),
    yMin: yMin.toString(),
    yMax: yMax.toString(),
    zMin: zMin.toString(),
    zMax: zMax.toString(),
  };
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("Loading region names from static data…");
  const regionNameMap = loadRegionNameMap();
  console.log(`  Loaded ${regionNameMap.size} region names from static data\n`);

  console.log("Fetching constellations from Stillness World API…\n");

  const rawConstellations = await fetchAllConstellations();

  // Build constellation tuples and group by region
  const constellationTuples = [];
  const regionConstellations = new Map(); // regionId → [{ bounds }]

  for (const c of rawConstellations) {
    if (!c.solarSystems || c.solarSystems.length === 0) continue;

    const bounds = computeBoundingBox(c.solarSystems);
    const name = c.name || String(c.id);

    constellationTuples.push([
      c.id,
      c.regionId,
      name,
      bounds.xMin,
      bounds.xMax,
      bounds.yMin,
      bounds.yMax,
      bounds.zMin,
      bounds.zMax,
    ]);

    if (!regionConstellations.has(c.regionId)) {
      regionConstellations.set(c.regionId, []);
    }
    regionConstellations.get(c.regionId).push(bounds);
  }

  // Build region tuples by merging constellation bounding boxes
  const regionTuples = [];
  for (const [regionId, boundsList] of regionConstellations.entries()) {
    const merged = mergeBounds(boundsList);
    regionTuples.push([
      regionId,
      regionNameMap.get(regionId) ?? String(regionId), // name from static data, fallback to ID
      merged.xMin,
      merged.xMax,
      merged.yMin,
      merged.yMax,
      merged.zMin,
      merged.zMax,
    ]);
  }

  // Sort by ID for stable output
  constellationTuples.sort((a, b) => a[0] - b[0]);
  regionTuples.sort((a, b) => a[0] - b[0]);

  // Write files
  const constellationDest = resolve(ROOT, "web/src/data/constellations.json");
  writeFileSync(constellationDest, JSON.stringify(constellationTuples) + "\n");

  const regionDest = resolve(ROOT, "web/src/data/regions.json");
  writeFileSync(regionDest, JSON.stringify(regionTuples) + "\n");

  const cSizeKB = (Buffer.byteLength(JSON.stringify(constellationTuples)) / 1024).toFixed(0);
  const rSizeKB = (Buffer.byteLength(JSON.stringify(regionTuples)) / 1024).toFixed(0);
  console.log(`\n  ✓ ${constellationDest.replace(ROOT + "/", "")} (${constellationTuples.length} constellations, ${cSizeKB}KB)`);
  console.log(`  ✓ ${regionDest.replace(ROOT + "/", "")} (${regionTuples.length} regions, ${rSizeKB}KB)`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
