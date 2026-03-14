#!/usr/bin/env node
/**
 * enrich-items.js
 *
 * Reads the raw static-data JSON files (types, groups, categories, metagroups, tags)
 * and the existing items lists, then outputs enriched items.json to both:
 *   - dev-tools/giveitem-helper/public/items.json
 *   - web/public/items.json
 *
 * Usage:  node scripts/enrich-items.js
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

// ── Load static data ──────────────────────────────────────────────

const types = loadJson(resolve(FSD, "types.json"));
const groups = loadJson(resolve(FSD, "groups.json"));
const categories = loadJson(resolve(FSD, "categories.json"));
const metagroups = loadJson(resolve(FSD, "metagroups.json"));
const tags = loadJson(resolve(FSD, "tags.json"));

// Use giveitem-helper items as the canonical list of type IDs
const sourceItems = loadJson(
  resolve(ROOT, "dev-tools/giveitem-helper/public/items.json"),
);

// ── Enrich each item ──────────────────────────────────────────────

const enriched = sourceItems.map((item) => {
  const t = types[String(item.typeId)] ?? {};

  // Group → Category
  const groupId = t.groupID ?? null;
  const group = groupId != null ? groups[String(groupId)] : null;
  const groupName = group?.groupName ?? null;
  const categoryId = group?.categoryID ?? null;
  const categoryName =
    categoryId != null
      ? (categories[String(categoryId)]?.categoryName ?? null)
      : null;

  // Meta group (tier)
  const metaGroupId = t.metaGroupID ?? null;
  const metaGroupName =
    metaGroupId != null
      ? (metagroups[String(metaGroupId)]?.name ?? null)
      : null;

  // Tags → resolved internal names
  const itemTags = (t.tags ?? [])
    .map((tagId) => tags[String(tagId)]?.internalName)
    .filter(Boolean);

  return {
    typeId: item.typeId,
    name: item.name,
    icon: item.icon,
    categoryId,
    categoryName,
    groupId,
    groupName,
    metaGroupId,
    metaGroupName,
    tags: itemTags.length > 0 ? itemTags : [],
  };
});

// Sort by category, then group, then name for a stable default order
enriched.sort((a, b) => {
  const catCmp = (a.categoryName ?? "").localeCompare(b.categoryName ?? "");
  if (catCmp !== 0) return catCmp;
  const grpCmp = (a.groupName ?? "").localeCompare(b.groupName ?? "");
  if (grpCmp !== 0) return grpCmp;
  return a.name.localeCompare(b.name);
});

// ── Write to both destinations ────────────────────────────────────

const json = JSON.stringify(enriched, null, 2) + "\n";

const destinations = [
  resolve(ROOT, "dev-tools/giveitem-helper/public/items.json"),
  resolve(ROOT, "web/public/items.json"),
];

for (const dest of destinations) {
  writeFileSync(dest, json);
  console.log(`  ✓ ${dest.replace(ROOT + "/", "")}`);
}

console.log(`\nEnriched ${enriched.length} items.`);
