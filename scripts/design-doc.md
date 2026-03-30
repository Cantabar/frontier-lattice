# Scripts — Design Doc

## Overview
Helper scripts for local development: deploying world contracts, publishing frontier-corm Move packages, and seeding on-chain state for testing.

## Features

### deploy-world-contracts.sh
One-shot script (run by the `world-contracts` mprocs process) that:
1. Waits for SUI localnet + faucet
2. Generates and funds player keypairs (A, B, C)
3. Deploys, configures, and seeds the Eve Frontier world contracts
4. Creates NWN + empty SSU for Players B and C
5. Writes world package IDs to `.env.localnet`

### publish-contracts-local.sh
One-shot script (run by the `contracts-publish` mprocs process) that publishes all frontier-corm Move packages (`tribe`, `corm_auth`, `trustless_contracts`, etc.) and writes their package/object IDs to `.env.localnet`.

### seed-ores.ts
Seeds 100 of every Frontier item type into Player A's SSU. This is **optional** — run it via the `seed-inventory` mprocs process (autostart: false) when you need a fully stocked inventory for testing contracts or the web UI.

### seed-player-b-ssu.ts / seed-player-c-ssu.ts
Create a Network Node and empty SSU for Players B and C respectively. These run automatically as part of `deploy-world-contracts.sh`.
