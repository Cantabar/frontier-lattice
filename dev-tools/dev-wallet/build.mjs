import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  target: "chrome120",
  logLevel: "info",
};

// Injected script — runs in page context, registers the Sui wallet standard
const injected = esbuild.context({
  ...shared,
  entryPoints: ["src/injected.js"],
  outfile: "dist/injected.js",
  format: "iife",
});

// Content script — bridges page ↔ extension messaging
const content = esbuild.context({
  ...shared,
  entryPoints: ["src/content.js"],
  outfile: "dist/content.js",
  format: "iife",
});

// Background service worker — handles signing requests
const background = esbuild.context({
  ...shared,
  entryPoints: ["src/background.js"],
  outfile: "dist/background.js",
  format: "iife",
});

// Popup script — key management UI
const popup = esbuild.context({
  ...shared,
  entryPoints: ["src/popup.js"],
  outfile: "dist/popup.js",
  format: "iife",
});

const [injCtx, contentCtx, bgCtx, popupCtx] = await Promise.all([
  injected,
  content,
  background,
  popup,
]);

if (watch) {
  await Promise.all([injCtx.watch(), contentCtx.watch(), bgCtx.watch(), popupCtx.watch()]);
  console.log("Watching for changes…");
} else {
  await Promise.all([injCtx.rebuild(), contentCtx.rebuild(), bgCtx.rebuild(), popupCtx.rebuild()]);
  await Promise.all([injCtx.dispose(), contentCtx.dispose(), bgCtx.dispose(), popupCtx.dispose()]);
}
