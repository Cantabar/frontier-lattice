/**
 * Frontier Dev Wallet — Injected Script
 *
 * Runs in the HOST PAGE context.  Registers a wallet that implements the
 * Sui wallet standard so @mysten/dapp-kit discovers it automatically.
 *
 * All private-key operations are delegated to the background service worker
 * via window.postMessage → content script → chrome.runtime.sendMessage.
 */

// ── RPC helper (for sending to background) ─────────────────────────

let _msgId = 0;
const _pending = new Map();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (msg?.target !== "devwallet-page") return;
  const resolver = _pending.get(msg.id);
  if (!resolver) return;
  _pending.delete(msg.id);
  if (msg.ok) {
    resolver.resolve(msg.result);
  } else {
    resolver.reject(new Error(msg.error || "Unknown dev-wallet error"));
  }
});

function rpc(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++_msgId;
    _pending.set(id, { resolve, reject });
    window.postMessage({ target: "devwallet-bg", id, type, payload }, "*");
  });
}

// ── Wallet Standard implementation ─────────────────────────────────

const SUI_LOCALNET = "sui:localnet";
const SUI_DEVNET = "sui:devnet";
const SUI_TESTNET = "sui:testnet";

const WALLET_NAME = "Frontier Dev Wallet";

/** Minimal WalletAccount for the wallet standard. */
function makeAccount({ address, publicKey }) {
  const pubKeyBytes = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
  return Object.freeze({
    address,
    publicKey: pubKeyBytes,
    chains: [SUI_LOCALNET, SUI_DEVNET, SUI_TESTNET],
    features: [
      "standard:connect",
      "standard:events",
      "sui:signTransaction",
      "sui:signAndExecuteTransaction",
      "sui:signPersonalMessage",
    ],
  });
}

class FrontierDevWallet {
  #accounts = [];
  #listeners = new Map(); // feature → Set<callback>

  get version() {
    return "1.0.0";
  }
  get name() {
    return WALLET_NAME;
  }
  get icon() {
    // 1×1 green pixel data-uri as a minimal icon
    return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNCIgZmlsbD0iIzAwYmY2MyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0iY2VudHJhbCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1zaXplPSIxOCIgZmlsbD0iI2ZmZiIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSI+RDwvdGV4dD48L3N2Zz4=";
  }
  get chains() {
    return [SUI_LOCALNET, SUI_DEVNET, SUI_TESTNET];
  }
  get accounts() {
    return this.#accounts;
  }

  get features() {
    return {
      "standard:connect": {
        version: "1.0.0",
        connect: this.#connect.bind(this),
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: this.#disconnect.bind(this),
      },
      "standard:events": {
        version: "1.0.0",
        on: this.#on.bind(this),
      },
      "sui:signTransaction": {
        version: "2.0.0",
        signTransaction: this.#signTransaction.bind(this),
      },
      "sui:signAndExecuteTransaction": {
        version: "2.0.0",
        signAndExecuteTransaction: this.#signAndExecuteTransaction.bind(this),
      },
      "sui:signPersonalMessage": {
        version: "1.0.0",
        signPersonalMessage: this.#signPersonalMessage.bind(this),
      },
    };
  }

  // ── standard:connect ──────────────────────────────────────────────

  async #connect() {
    const accounts = await rpc("get-accounts");
    this.#accounts = accounts.map(makeAccount);
    this.#emit("change", { accounts: this.#accounts });
    return { accounts: this.#accounts };
  }

  // ── standard:disconnect ───────────────────────────────────────────

  async #disconnect() {
    this.#accounts = [];
    this.#emit("change", { accounts: this.#accounts });
  }

  // ── standard:events ───────────────────────────────────────────────

  #on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(listener);
    return () => this.#listeners.get(event)?.delete(listener);
  }

  #emit(event, data) {
    const set = this.#listeners.get(event);
    if (set) set.forEach((fn) => fn(data));
  }

  // ── sui:signTransaction ───────────────────────────────────────────

  async #signTransaction(input) {
    const txJSON = await input.transaction.toJSON();
    return rpc("sign-transaction", {
      txJSON,
      address: input.account.address,
      chain: input.chain,
    });
  }

  // ── sui:signAndExecuteTransaction ─────────────────────────────────

  async #signAndExecuteTransaction(input) {
    const txJSON = await input.transaction.toJSON();
    return rpc("sign-and-execute", {
      txJSON,
      address: input.account.address,
      chain: input.chain,
    });
  }

  // ── sui:signPersonalMessage ───────────────────────────────────────

  async #signPersonalMessage(input) {
    // message comes as Uint8Array — encode to base64 for transport
    const b64 = btoa(String.fromCharCode(...input.message));
    return rpc("sign-personal-message", {
      message: b64,
      address: input.account.address,
    });
  }
}

// ── Register with the Wallet Standard ──────────────────────────────

function registerWallet(wallet) {
  const callback = ({ register }) => register(wallet);
  try {
    window.dispatchEvent(
      new RegisterWalletEvent(callback)
    );
  } catch (e) {
    console.error("[dev-wallet] register dispatch failed", e);
  }
  try {
    window.addEventListener("wallet-standard:app-ready", ({ detail }) =>
      callback(detail)
    );
  } catch (e) {
    console.error("[dev-wallet] app-ready listener failed", e);
  }
}

class RegisterWalletEvent extends Event {
  #detail;
  constructor(callback) {
    super("wallet-standard:register-wallet", {
      bubbles: false,
      cancelable: false,
      composed: false,
    });
    this.#detail = callback;
  }
  get detail() {
    return this.#detail;
  }
  get type() {
    return "wallet-standard:register-wallet";
  }
}

const wallet = new FrontierDevWallet();
registerWallet(wallet);
console.log("[Frontier Dev Wallet] registered ✓");
