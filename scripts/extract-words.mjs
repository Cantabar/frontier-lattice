#!/usr/bin/env node
/**
 * extract-words.mjs
 *
 * Extracts thematic vocabulary from:
 *   - static-data/data/phobos/fsd_built/types.json  (typeName fields)
 *   - training-data/keep/raw/*.md                    (lore markdown files)
 *
 * Outputs a deduplicated JSON array to:
 *   puzzle-service/internal/words/words.json
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const TYPES_PATH = join(ROOT, "static-data/data/phobos/fsd_built/types.json");
const LORE_DIR = join(ROOT, "training-data/keep/raw");
const OUTPUT = join(ROOT, "puzzle-service/internal/words/words.json");

// Minimum word length for archive inclusion
const MIN_LENGTH = 4;
const MAX_LENGTH = 14;

// Words that are too generic to be interesting puzzle words
const BLOCKLIST = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "that", "this", "with", "have", "from",
  "they", "been", "said", "each", "which", "their", "will", "other", "about",
  "many", "then", "them", "some", "would", "make", "like", "time", "very",
  "when", "what", "your", "into", "could", "more", "than", "been", "there",
  "system", "type", "name", "item", "group", "data", "unit", "value", "base",
  "null", "true", "false", "none",
]);

function extractFromTypes() {
  const raw = JSON.parse(readFileSync(TYPES_PATH, "utf-8"));
  const words = new Set();

  for (const entry of Object.values(raw)) {
    const name = entry.typeName;
    if (!name || name.startsWith("#")) continue;

    // Split multi-word names and take individual tokens
    for (const token of name.split(/[\s\-_]+/)) {
      const clean = token.replace(/[^a-zA-Z]/g, "");
      if (clean.length >= MIN_LENGTH && clean.length <= MAX_LENGTH) {
        words.add(clean.toUpperCase());
      }
    }
  }

  return words;
}

function extractFromLore() {
  const words = new Set();
  const files = readdirSync(LORE_DIR).filter((f) => f.endsWith(".md"));

  // Thematic terms to specifically look for
  const thematicPatterns = [
    /\b[A-Z][a-z]{3,13}\b/g, // Capitalized words (proper nouns)
  ];

  for (const file of files) {
    const content = readFileSync(join(LORE_DIR, file), "utf-8");

    // Skip YAML frontmatter
    const bodyMatch = content.match(/^---[\s\S]*?---\n([\s\S]*)$/);
    const body = bodyMatch ? bodyMatch[1] : content;

    // Extract capitalized words (likely proper nouns / lore terms)
    for (const pattern of thematicPatterns) {
      const matches = body.matchAll(pattern);
      for (const match of matches) {
        const word = match[0];
        if (
          word.length >= MIN_LENGTH &&
          word.length <= MAX_LENGTH &&
          !BLOCKLIST.has(word.toLowerCase())
        ) {
          words.add(word.toUpperCase());
        }
      }
    }

    // Also extract all-caps words (acronyms, special terms)
    const capsMatches = body.matchAll(/\b[A-Z]{4,14}\b/g);
    for (const match of capsMatches) {
      if (!BLOCKLIST.has(match[0].toLowerCase())) {
        words.add(match[0]);
      }
    }
  }

  return words;
}

// Run extraction
const typeWords = extractFromTypes();
const loreWords = extractFromLore();

const allWords = new Set([...typeWords, ...loreWords]);

// Sort for deterministic output
const sorted = [...allWords].sort();

writeFileSync(OUTPUT, JSON.stringify(sorted, null, 2) + "\n");
console.log(
  `Extracted ${sorted.length} words (${typeWords.size} from types, ${loreWords.size} from lore)`
);
console.log(`Written to ${OUTPUT}`);
