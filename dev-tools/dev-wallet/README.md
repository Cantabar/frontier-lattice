# Frontier Dev Wallet

A lightweight Chrome extension that acts as a Sui wallet for local development.
It implements the [Sui wallet standard](https://docs.sui.io/standards/wallet-standard)
so `@mysten/dapp-kit` auto-discovers it — no code changes needed in the web app.

Use it to authenticate against localnet with the seeded player keypairs instead of
the EVE Vault extension (which requires FusionAuth + Enoki ZKLogin).

## Quick Start

```bash
# 1. Install & build
cd dev-tools/dev-wallet
npm install
npm run build          # outputs to dist/

# 2. Load in Chrome
#    - Open chrome://extensions
#    - Enable "Developer mode" (top-right toggle)
#    - Click "Load unpacked"
#    - Select the dev-tools/dev-wallet/ directory (not dist/)

# 3. Import a seeded key
#    - Click the extension icon in the toolbar
#    - Paste a private key from world-contracts/.env, e.g.:
#        PLAYER_A_PRIVATE_KEY=suiprivkey1…
#    - Give it a label (e.g. "Player A")
#    - Click "Import"
```

## Getting Seeded Keys

After running `mprocs` (which starts localnet and deploys world contracts), the
player private keys are written to `../world-contracts/.env`:

```bash
grep 'PLAYER_.*_PRIVATE_KEY' ../world-contracts/.env
```

Copy the `suiprivkey1…` value and paste it into the extension popup.

## RPC URL

The extension defaults to `http://127.0.0.1:9000` (SUI localnet). You can
change this in the popup if needed.

## How It Works

```
┌─────────────┐    wallet-standard     ┌───────────────┐
│  Web App     │  ◄──── events ────►   │  injected.js  │  (page context)
│  dapp-kit    │                        └───────┬───────┘
└─────────────┘                                 │ postMessage
                                        ┌───────┴───────┐
                                        │  content.js   │  (content script)
                                        └───────┬───────┘
                                                │ chrome.runtime.sendMessage
                                        ┌───────┴───────┐
                                        │ background.js │  (service worker)
                                        │  Ed25519 sign │
                                        │  SuiClient    │
                                        └───────────────┘
```

1. **injected.js** registers a `FrontierDevWallet` with the wallet standard
2. When the app calls `signTransaction`, the request is relayed through the
   content script to the background service worker
3. The background loads the private key from `chrome.storage.local`, signs the
   transaction using `@mysten/sui`, and returns the result
4. For `signAndExecuteTransaction`, the background also submits via `SuiClient`

## Development

```bash
npm run watch    # rebuild on file changes
```

After rebuilding, go to `chrome://extensions` and click the refresh icon on the
extension card — no need to remove and re-load.
