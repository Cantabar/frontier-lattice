#!/usr/bin/env node
/**
 * fetch-solar-systems.mjs
 *
 * Fetches all solar systems from the Stillness World API and writes them
 * to web/src/data/solar-systems.json as compact tuples:
 *
 *   [id, "name", "x", "y", "z"]
 *
 * Coordinates are stored as string literals to preserve integer precision
 * (z-axis values can exceed Number.MAX_SAFE_INTEGER).
 *
 * Usage:  node scripts/fetch-solar-systems.mjs
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const API_BASE =
  "https://world-api-stillness.live.tech.evefrontier.com";
const LIMIT = 100; // API max per request

async function fetchAllSystems() {
  const systems = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const url = `${API_BASE}/v2/solarsystems?limit=${LIMIT}&offset=${offset}`;
    console.log(`  Fetching offset ${offset}… (${systems.length}/${total === Infinity ? "?" : total})`);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText} for ${url}`);
    }

    const json = await res.json();

    // First response gives us the total count
    if (offset === 0) {
      total = json.metadata?.total ?? 0;
      if (!total) {
        throw new Error("Could not determine total count from API response");
      }
      console.log(`  Total systems: ${total}`);
    }

    const items = json.data;
    if (!Array.isArray(items) || items.length === 0) break;

    for (const sys of items) {
      systems.push([
        sys.id,
        sys.name,
        String(sys.location.x),
        String(sys.location.y),
        String(sys.location.z),
      ]);
    }

    offset += items.length;
  }

  return systems;
}

async function main() {
  console.log("Fetching solar systems from Stillness World API…\n");

  const systems = await fetchAllSystems();

  // Sort by id for stable output
  systems.sort((a, b) => a[0] - b[0]);

  const dest = resolve(ROOT, "web/src/data/solar-systems.json");
  writeFileSync(dest, JSON.stringify(systems) + "\n");

  const sizeKB = (Buffer.byteLength(JSON.stringify(systems)) / 1024).toFixed(0);
  console.log(`\n  ✓ ${dest.replace(ROOT + "/", "")} (${systems.length} systems, ${sizeKB}KB)`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
