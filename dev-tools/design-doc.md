# Dev Tools

## Overview

The dev-tools directory contains standalone developer utilities for local development, debugging, and on-chain analysis. These are not deployed to production — they support the development workflow for Frontier Corm.

## Tools

### dev-wallet

Chrome extension implementing the Sui wallet standard for local development. Auto-discovered by `@mysten/dapp-kit` so the web app requires no code changes.

- **Purpose:** Authenticate against localnet using seeded player keypairs (from `world-contracts/.env`) instead of the EVE Vault extension (which requires FusionAuth + Enoki ZKLogin).
- **Architecture:** injected.js (wallet-standard registration) → content.js (message relay) → background.js (Ed25519 signing via `@mysten/sui`, SuiClient transaction execution).
- **Tech:** Chrome extension (Manifest V3), `@mysten/sui`, `chrome.storage.local`
- **Usage:** `npm install && npm run build`, then load unpacked in Chrome. Import private keys via the popup (single or bulk from `.env`).

### giveitem-helper

Lightweight Vite dev UI for giving items to players during local testing.

- **Purpose:** Quick item distribution for testing trustless contracts and SSU interactions.
- **Tech:** Vanilla JS + Vite, HTML/CSS
- **Usage:** `npm install && npm run dev` (serves on :5175 via mprocs)

### package-search

Python CLI tool to find Sui Move packages on-chain that depend on a given target package.

- **Purpose:** Discover all testnet packages depending on Eve Frontier's world contracts. Useful for analyzing the ecosystem.
- **Tech:** Python 3.10+ (stdlib only, no external dependencies). Uses Sui JSON-RPC API.
- **Modes:** `fast` (InputObject query, default) or `full` (brute-force linkage table scan)
- **Usage:** `python3 find_dependents.py --target-package <PACKAGE_ID>`

### transfer_exploit_poc

Proof-of-concept demonstrating a transfer exploit scenario.

- **Purpose:** Security testing and validation of contract safety assumptions.

### world-contract-tracker

Vite dev UI comparing on-chain world-contract deployments (Stillness/Utopia) against the GitHub repo.

- **Purpose:** Track whether on-chain world contracts are in sync with the source repo, detect pending upgrades, and view recent deploy commits.
- **Tech:** Vanilla JS + Vite. Fetches `Published.toml` from GitHub raw and queries Sui testnet RPC for `UpgradeCap` objects.
- **Shows:** Per-environment version comparison, sync status badges, package IDs, upgrade policy, GitHub releases/changelogs.
- **Usage:** `npm install && npm run dev`

## Tech Stack

Mixed — each tool is self-contained:
- dev-wallet: TypeScript, Chrome extension APIs
- giveitem-helper: JavaScript, Vite
- package-search: Python
- world-contract-tracker: JavaScript, Vite

## Features

- Local Sui wallet (Chrome extension) with auto-discovery via wallet standard, bulk key import from `.env`
- Quick item distribution UI for testing trustless contracts and SSU interactions
- On-chain package dependency analysis (Sui JSON-RPC, fast and full scan modes)
- Transfer exploit proof-of-concept for contract safety validation
- World contract deployment tracker comparing on-chain state against GitHub repo

## Deployment

None — all tools run locally. dev-wallet is loaded as an unpacked Chrome extension; Vite tools run via `npm run dev`; package-search runs as a CLI script.
