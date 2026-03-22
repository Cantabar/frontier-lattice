#!/usr/bin/env node

/**
 * discover-urls.js
 *
 * Discovers all lore entry URLs from The Keep's main listing page.
 * Useful for finding correct slugs when the manifest is out of date.
 */

import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  console.log("Loading The Keep listing page...");
  await page.goto("https://evefrontier.com/en/thekeep", {
    waitUntil: "networkidle",
    timeout: 30000,
  });

  // Wait for content to render
  await new Promise((r) => setTimeout(r, 3000));

  // Find all links that point to /en/thekeep/*
  const links = await page.evaluate(() => {
    const anchors = document.querySelectorAll('a[href*="/en/thekeep/"]');
    const results = [];
    const seen = new Set();
    for (const a of anchors) {
      const href = a.getAttribute("href");
      if (href && !seen.has(href)) {
        seen.add(href);
        const text = a.textContent.trim().substring(0, 100);
        results.push({ href, text });
      }
    }
    return results;
  });

  console.log(`\nFound ${links.length} unique entry links:\n`);
  for (const link of links) {
    const slug = link.href.split("/thekeep/")[1] || link.href;
    console.log(`  slug: "${slug}"  text: "${link.text}"`);
  }

  console.log("\n--- Raw JSON ---");
  console.log(JSON.stringify(links, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
