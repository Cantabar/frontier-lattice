/**
 * Frontier Dev Wallet — Background Service Worker
 *
 * Responsibilities:
 *  - Store private keys in chrome.storage.local
 *  - Handle sign requests relayed from the content script
 *  - Execute transactions against the localnet RPC
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64, fromBase64 } from "@mysten/sui/utils";

const STORAGE_KEY = "devwallet:keys"; // [{label, privateKey}]
const RPC_URL_KEY = "devwallet:rpc";
const DEFAULT_RPC = "http://127.0.0.1:9000";

// ── Helpers ────────────────────────────────────────────────────────

/** Load all stored accounts as Ed25519Keypair instances. */
async function loadKeypairs() {
  const { [STORAGE_KEY]: entries = [] } = await chrome.storage.local.get(
    STORAGE_KEY
  );
  return entries.map((e) => ({
    label: e.label,
    keypair: Ed25519Keypair.fromSecretKey(e.privateKey),
  }));
}

/** Get a SuiClient pointed at the configured RPC. */
async function getClient() {
  const { [RPC_URL_KEY]: url = DEFAULT_RPC } = await chrome.storage.local.get(
    RPC_URL_KEY
  );
  return new SuiClient({ url });
}

/** Find the keypair matching the requested address. */
async function keypairForAddress(address) {
  const pairs = await loadKeypairs();
  const match = pairs.find((p) => p.keypair.toSuiAddress() === address);
  if (!match) throw new Error(`No key for address ${address}`);
  return match.keypair;
}

// ── Message handler ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "devwallet-bg") return false;

  handleMessage(msg)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));

  return true; // keep the message channel open for async response
});

async function handleMessage(msg) {
  switch (msg.type) {
    case "get-accounts":
      return getAccounts();
    case "sign-transaction":
      return signTransaction(msg.payload);
    case "sign-and-execute":
      return signAndExecuteTransaction(msg.payload);
    case "sign-personal-message":
      return signPersonalMessage(msg.payload);
    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

// ── Wallet operations ──────────────────────────────────────────────

async function getAccounts() {
  const pairs = await loadKeypairs();
  return pairs.map((p) => ({
    address: p.keypair.toSuiAddress(),
    publicKey: toBase64(p.keypair.getPublicKey().toRawBytes()),
    label: p.label,
  }));
}

async function signTransaction({ txJSON, address, chain }) {
  const keypair = await keypairForAddress(address);
  const client = await getClient();

  const tx = Transaction.from(txJSON);
  tx.setSenderIfNotSet(address);
  const built = await tx.build({ client });

  const { signature } = await keypair.signTransaction(built);

  return {
    bytes: toBase64(built),
    signature,
  };
}

async function signAndExecuteTransaction({ txJSON, address, chain }) {
  const keypair = await keypairForAddress(address);
  const client = await getClient();

  const tx = Transaction.from(txJSON);
  tx.setSenderIfNotSet(address);

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showRawEffects: true },
  });

  return {
    digest: result.digest,
    bytes: result.rawTransaction
      ? result.rawTransaction
      : "",
    signature: result.signature ?? "",
    effects: result.rawEffects ? toBase64(new Uint8Array(result.rawEffects)) : "",
  };
}

async function signPersonalMessage({ message, address }) {
  const keypair = await keypairForAddress(address);
  const msgBytes = fromBase64(message);
  const { signature } = await keypair.signPersonalMessage(msgBytes);
  return {
    bytes: message,
    signature,
  };
}
