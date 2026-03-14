/**
 * Frontier Dev Wallet — Popup Script
 *
 * Manages the import / removal of Ed25519 private keys and the RPC URL.
 * Keys are stored in chrome.storage.local as an array of {label, privateKey}.
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const STORAGE_KEY = "devwallet:keys";
const RPC_URL_KEY = "devwallet:rpc";

// ── DOM refs ───────────────────────────────────────────────────────
const $accounts = document.getElementById("accounts");
const $keyLabel = document.getElementById("keyLabel");
const $keyInput = document.getElementById("keyInput");
const $importBtn = document.getElementById("importBtn");
const $importStatus = document.getElementById("importStatus");
const $rpcUrl = document.getElementById("rpcUrl");
const $saveRpc = document.getElementById("saveRpc");
const $rpcStatus = document.getElementById("rpcStatus");

// ── Render ─────────────────────────────────────────────────────────
async function render() {
  const { [STORAGE_KEY]: entries = [] } = await chrome.storage.local.get(
    STORAGE_KEY
  );
  $accounts.innerHTML = "";
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    let address;
    try {
      const kp = Ed25519Keypair.fromSecretKey(e.privateKey);
      address = kp.toSuiAddress();
    } catch {
      address = "(invalid key)";
    }

    const div = document.createElement("div");
    div.className = "account";
    div.innerHTML = `
      <div class="label-text">${e.label || "Account " + (i + 1)}</div>
      <div class="addr">${address}</div>
    `;
    const btn = document.createElement("button");
    btn.className = "btn-danger";
    btn.textContent = "Remove";
    btn.style.marginTop = "4px";
    btn.addEventListener("click", () => removeKey(i));
    div.appendChild(btn);
    $accounts.appendChild(div);
  }
}

// ── Import ─────────────────────────────────────────────────────────
$importBtn.addEventListener("click", async () => {
  const raw = $keyInput.value.trim();
  const label = $keyLabel.value.trim() || `Account`;
  if (!raw) {
    flash($importStatus, "Paste a private key", true);
    return;
  }

  try {
    // Validate — Ed25519Keypair.fromSecretKey accepts suiprivkey1… bech32 or raw bytes
    const kp = Ed25519Keypair.fromSecretKey(raw);
    const addr = kp.toSuiAddress();

    const { [STORAGE_KEY]: entries = [] } = await chrome.storage.local.get(
      STORAGE_KEY
    );

    // Deduplicate by address
    if (
      entries.some((e) => {
        try {
          return Ed25519Keypair.fromSecretKey(e.privateKey).toSuiAddress() === addr;
        } catch {
          return false;
        }
      })
    ) {
      flash($importStatus, "Key already imported", true);
      return;
    }

    entries.push({ label, privateKey: raw });
    await chrome.storage.local.set({ [STORAGE_KEY]: entries });

    $keyInput.value = "";
    $keyLabel.value = "";
    flash($importStatus, `Imported ${addr.slice(0, 10)}…`, false);
    render();
  } catch (err) {
    flash($importStatus, `Invalid key: ${err.message}`, true);
  }
});

// ── Remove ─────────────────────────────────────────────────────────
async function removeKey(index) {
  const { [STORAGE_KEY]: entries = [] } = await chrome.storage.local.get(
    STORAGE_KEY
  );
  entries.splice(index, 1);
  await chrome.storage.local.set({ [STORAGE_KEY]: entries });
  render();
}

// ── RPC URL ────────────────────────────────────────────────────────
$saveRpc.addEventListener("click", async () => {
  const url = $rpcUrl.value.trim();
  if (!url) {
    flash($rpcStatus, "Enter a URL", true);
    return;
  }
  await chrome.storage.local.set({ [RPC_URL_KEY]: url });
  flash($rpcStatus, "Saved ✓", false);
});

// ── Helpers ────────────────────────────────────────────────────────
function flash(el, msg, isError) {
  el.textContent = msg;
  el.className = "status " + (isError ? "err" : "ok");
  setTimeout(() => (el.textContent = ""), 3000);
}

// ── Init ───────────────────────────────────────────────────────────
(async function init() {
  render();
  const { [RPC_URL_KEY]: url } = await chrome.storage.local.get(RPC_URL_KEY);
  $rpcUrl.value = url || "http://127.0.0.1:9000";
})();
