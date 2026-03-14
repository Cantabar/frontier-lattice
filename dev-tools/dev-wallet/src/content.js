/**
 * Frontier Dev Wallet — Content Script
 *
 * 1. Injects injected.js into the host page so it can register the Sui wallet standard.
 * 2. Relays messages between the page (window.postMessage) and the background service worker.
 */

// ── Inject the wallet-standard script into page context ────────────
const script = document.createElement("script");
script.src = chrome.runtime.getURL("dist/injected.js");
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// ── Page → Background relay ────────────────────────────────────────
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (msg?.target !== "devwallet-bg") return;

  // Add a unique id so the injected script can match responses
  try {
    const response = await chrome.runtime.sendMessage(msg);
    window.postMessage(
      { target: "devwallet-page", id: msg.id, ...response },
      "*"
    );
  } catch (err) {
    window.postMessage(
      { target: "devwallet-page", id: msg.id, ok: false, error: err.message },
      "*"
    );
  }
});
