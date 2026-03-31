# Web

## Overview

The web service is the React single-page application for Frontier Corm. It provides a wallet-connected interface where players manage tribes, create and fill trustless contracts, explore on-chain events, interact with the Continuity Engine (puzzle-service iframe), and view corm state — all backed by the indexer API and direct Sui RPC calls.

## Architecture

```
Browser
┌────────────────────────────────────────────────────┐
│  React SPA (Vite)                                  │
│    ├─ Header / Sidebar / Footer                    │
│    ├─ Pages                                        │
│    │    ├─ Dashboard                               │
│    ├─ Tribe (detail)                          │
│    │    ├─ Contracts (list, create, detail)        │
│    │    ├─ Continuity Engine (puzzle iframe)       │
│    │    ├─ Event Explorer                          │
│    │    ├─ Structures / Locations                  │
│    │    ├─ Notifications                           │
│    │    └─ Settings                                │
│    ├─ Identity Resolver (Character ↔ Wallet)      │
│    └─ Notification System (payout watcher)        │
└──────────────┬──────────────┬─────────────────────┘
               │              │
       ┌───────┴───┐   ┌─────┴──────┐
       │ Indexer    │   │ Sui RPC    │
       │ REST API  │   │ dapp-kit   │
       └───────────┘   └────────────┘
```

### Key Components

- **Identity Resolver** (`hooks/useIdentity`) — maps the connected Sui wallet to an Eve Frontier Character object. Provides `IdentityContext` to the entire app for character-aware UI.
- **Notification System** (`hooks/useNotifications`, `hooks/usePayoutWatcher`) — push-style notification provider. Payout watcher polls the indexer for contract fill/completion events targeting the current character and surfaces them as toast notifications.
- **Continuity Engine** (`continuity-engine/ContinuityEngine`) — embeds the puzzle-service as an iframe, providing the in-app gateway to the corm interaction. Includes `useCormState` and `useCormStateBridge` hooks for reading on-chain CormState and bridging it to the iframe, plus a `CormStateBar` component.
- **World Tribe Info** (`hooks/useWorldTribeInfo`) — demand-driven tribe metadata backfill from the Stillness World API. Accepts a list of tribe IDs, checks localStorage cache, and fetches only uncached IDs individually via `GET /v2/tribes/{id}`. Uses individual endpoints instead of the bulk paginated list endpoint (which has broken pagination on Stillness).
- **Auto-Join Tribe** (`hooks/useAutoJoinTribe`) — detects when the connected wallet's Character belongs to an in-game tribe that has an on-chain Tribe, but the user hasn't joined yet. Resolves via indexer events or on-chain registry lookup (`devInspect`). Exposes a one-click `self_join` action. Displayed via `AutoJoinBanner`.
- **Initialize Tribe** (`hooks/useInitializeTribe`, `InitializeTribeBanner`) — detects when the user's in-game tribe has no on-chain Tribe and prompts creation.
- **Quick Actions** (`hooks/useQuickActions`) — configurable dashboard shortcuts for contract creation (CoinForCoin, CoinForItem, ItemForCoin, ItemForItem, Transport). Persisted to localStorage.
- **Indexer Error Handler** (`lib/api`) — global subscriber for indexer fetch errors, surfaced as error notifications.

### Shadow Location Network

Client-side privacy-preserving location sharing with ZK proof generation. The server never sees plaintext coordinates. Supports both **tribe mode** (shared with tribe members via TLK) and **solo mode** (private via Personal Location Key).

- **Location Crypto** (`lib/locationCrypto.ts`) — Poseidon4 hash commitment, AES-256-GCM encrypt/decrypt with TLK/PLK, X25519 key unwrap (ECIES), browser-persisted X25519 keypair (random, stored in IndexedDB per wallet address), human-readable wallet auth challenge construction ("CORM Location Network — Identity Verification" format).
- **ZK Prover** (`lib/zkProver.ts`) — browser-side Groth16 proof generation via snarkjs. Generates region-filter proofs (3D bounding box containment), proximity-filter proofs (distance threshold), and mutual proximity proofs (two-structure distance within threshold). Circuit WASM + zkey files served by the indexer at `/zk/`.
- **Location PODs Hook** (`hooks/useLocationPods`) — fetches, decrypts, submits, and revokes location PODs. Handles TLK/PLK initialization (including solo mode via `initializeSoloPlk`), wrapped key fetching, Network Node POD registration and refresh. Auto-detects solo mode via synthetic `solo:<address>` tribe IDs and uses the `GET /solo` endpoint for solo fetches. Auth: (1) check cached `Bearer` session token, (2) build a minimal no-op transaction (split 0 SUI + self-transfer) and sign via `signTransaction` → `TxSig` header (universally supported by all Sui wallets including Eve Vault), (3) exchange for a session token via `POST /locations/session`. Caches the `Bearer` token in a module-level variable + `sessionStorage` (survives navigations, cleared on tab close). Falls back to direct `TxSig` auth if session creation fails. Concurrent `getAuthHeader()` calls are deduplicated via a module-level pending promise so only one wallet signature prompt is shown even when multiple hooks request auth simultaneously (e.g. `useTlkStatus` + `useStructureLocationIds` on the Structures page). POD submissions no longer include a wallet signature (the auth header proves identity).
- **TLK Status Hook** (`hooks/useTlkStatus`) — checks TLK/PLK initialization state for a tribe or solo namespace. Exposes `resetStatus()` to clear cached state after a TLK reset.
- **TLK Distribution Hook** (`hooks/useTlkDistribution`) — manages wrapping TLK for pending tribe members (not used in solo mode).
- **ZK Filter Hook** (`hooks/useZkLocationFilter`) — generates and submits region/proximity/mutual proximity proofs for PODs, queries verified results. Supports named region/constellation proof by ID, and mutual proximity proofs between two decrypted PODs for witnessed contract fulfillment. Deduplicates Network Node derived PODs.
- **Region Data** (`lib/regions.ts`, `lib/solarSystems.ts`) — client-side region/constellation/solar system reference data with bounding boxes.
- **Locations Page** (`pages/LocationsPage`) — Supports both tribe mode and solo mode. Solo mode auto-activates when the user has no tribe, using a synthetic `solo:<address>` tribe ID. Shows TLK/PLK status banner (context-aware messaging), decrypted POD listing grouped by solar system, register/revoke actions, pending member key distribution (tribe mode only). Action bar provides "Prove Region", "Prove Proximity", and "Prove Mutual Proximity" buttons for generating ZK proofs across all three circuit types.
- **Region Proof Modal** (`components/locations/RegionProofModal`) — 3-step modal (select → confirm → done) for generating region ZK proofs. Supports three proof modes: Named Region (pick from searchable game regions), Named Constellation (pick from searchable constellations), or Custom Bounding Box (enter arbitrary 3D bounds). Batch-proves all owned, non-derived PODs; silently skips PODs outside the selected bounds.
- **Proximity Proof Modal** (`components/locations/ProximityProofModal`) — 3-step modal for generating single-structure proximity ZK proofs. User enters a reference point (x, y, z) and a max distance threshold. Shows a client-side preview of how many PODs are within range. Batch-proves all owned, non-derived PODs.
- **POD Proof Modal** (`components/locations/PodProofModal`) — review and copy a shareable proof bundle for an owned POD. Displays public attestation fields (location hash, wallet signature, versions), associated ZK proofs, and location tags. Supports details and raw JSON views with copy-to-clipboard.
- **Mutual Proximity Proof Modal** (`components/locations/MutualProximityProofModal`) — select two decrypted PODs and a distance threshold, generate a Groth16 mutual proximity proof in-browser, and submit to the indexer. Shows actual distance, confirmation step, and success state. Used for fulfilling proximity-gated witnessed contracts.

### Forge Planner

- **Forge Planner Page** (`pages/ForgePlanner`) — three-tab interface: Blueprints (browse game blueprints), Planner (optimizer + build queue), Orders (active multi-input contracts with create/detail modals).
- **Blueprints Hook** (`hooks/useBlueprints`) — loads blueprint data from `/blueprints.json`, converts to `RecipeData[]` for the optimizer.
- **Optimizer Hook** (`hooks/useOptimizer`) — browser-side recipe tree resolution and gap analysis. Resolves a target item + quantity to a full dependency tree, collects leaf materials, and compares against inventory for a shopping list.
- **BOM Library** (`lib/bom.ts`) — Bill of Materials expansion at configurable depth (0 = finished items, 1 = direct inputs, ∞ = raw materials). Used by both optimizer UI and multi-input contract creation to generate slot lists.

### SSU dApp Landing Page

- **DappLandingPage** (`pages/DappLandingPage`) — entry point for in-game SSU interaction. Displays two action buttons at the top: **Create Contract** (opens the full web app contract creation form in a new tab) and **Continuity Engine** (navigates to the CE dApp route within the shell). Below the buttons, the SSU delivery contracts list is rendered inline. Rendered under `/dapp/ssu/:ssuId`.

### SSU Delivery dApp

- **SsuDeliveryDapp** (`pages/SsuDeliveryDapp`) — lightweight SSU-specific dApp for contract fulfillment. Fetches SSU metadata and inventory, filters contracts for deliverable items from the user's player inventory, and provides a delivery modal. Rendered under `/dapp/deliver/:ssuId` (legacy) and embedded within the dApp landing page.

### Page Routes

- `/` — Dashboard (overview cards with Tribe/Events/Locations, Continuity Engine section with Install Corm/CE link/Corm Status, configurable quick actions for contract creation)
- `/tribe/:tribeId` — Tribe detail (members, reputation leaderboard)
- `/contracts` — Contracts list (trustless + build requests)
- `/contracts/create` — Create new trustless contract
- `/contracts/build/create` — Create new build request
- `/contracts/build/:contractId` — Build request detail
- `/contracts/:contractId` — Trustless contract detail (fills, status)
- `/continuity` — Continuity Engine (puzzle-service iframe with CormState bridge). Supports `?node=<id>` to select a specific Network Node (resolves cormStateId from installed corms). This is the URL written to Network Node on-chain metadata.
- `/events` — Event Explorer (filterable event log)
- `/structures` → redirects to `/structures/:characterId`
- `/structures/:characterId` — Player's structures
- `/locations` — Shadow Location Network (TLK management, encrypted PODs, ZK proof generation)
- `/notifications` — Notification history
- `/settings` — App settings
- `/dapp/ssu/:ssuId` — SSU Delivery dApp (lightweight, no sidebar/header)
- `/dapp/*` — Lightweight dApp shell for in-game SSU embedding

## Tech Stack

- **Framework:** React 18 + TypeScript
- **Build:** Vite (multi-mode: `--mode localnet|utopia|stillness`)
- **Routing:** react-router-dom v6
- **Styling:** styled-components + theme provider
- **Data Fetching:** @tanstack/react-query
- **Blockchain:** @mysten/dapp-kit (wallet connection, Sui client), @mysten/sui (transaction building)
- **State:** React context (identity, notifications, sidebar)

## Configuration

All via Vite environment variables (`VITE_*`), resolved in `src/config.ts`:

- `VITE_APP_ENV` — environment: `local`, `utopia`, or `stillness`
- `VITE_SUI_NETWORK` — Sui network: `localnet`, `devnet`, `testnet`
- `VITE_TRIBE_PACKAGE_ID` — tribe contract package ID
- `VITE_TRUSTLESS_CONTRACTS_PACKAGE_ID` — trustless contracts package ID
- `VITE_CORM_AUTH_PACKAGE_ID` — corm_auth package ID (published-at address for function calls)
- `VITE_CORM_AUTH_ORIGINAL_ID` — corm_auth original package ID (for type arguments; defaults to PACKAGE_ID if unset)
- `VITE_CORM_STATE_PACKAGE_ID` — corm_state package ID (published-at address for function calls)
- `VITE_CORM_STATE_ORIGINAL_ID` — corm_state original package ID (for event queries and type references; defaults to PACKAGE_ID if unset)
- `VITE_WITNESSED_CONTRACTS_PACKAGE_ID` — witnessed contracts (build_request) package ID
- `VITE_WORLD_PACKAGE_ID`
- `VITE_TRIBE_REGISTRY_ID` — TribeRegistry shared object ID
- `VITE_ENERGY_CONFIG_ID`
- `VITE_CORM_COIN_TYPE` — CORM coin type string (primary coin for contracts; derived from the **original** `corm_state` package address as `<ORIGINAL_ID>::corm_coin::CORM_COIN` — stable across upgrades)
- `VITE_COIN_TYPE` — fallback coin type for escrow/treasury when CORM is not configured (default: `0x2::sui::SUI`)
- `VITE_INDEXER_URL` — indexer API base URL (default: `/api/v1`)
- `VITE_WEB_UI_HOST` — public web UI host used to compose on-chain metadata URLs for SSU dApp links and Network Node Continuity Engine links (defaults: `https://ef-corm.com` for stillness, `https://utopia.ef-corm.com` for utopia)
- `VITE_WORLD_API_URL` — Eve Frontier world API (tribe name backfill)
- `VITE_CONTINUITY_ENGINE_URL` — continuity-engine service URL (Continuity Engine iframe)
- `VITE_SUI_RPC_URL` — Sui RPC proxy URL override (default: `/sui-rpc` for deployed envs, SDK default for local)
- `VITE_CORM_STATE_ID` — CormState shared object ID
- `VITE_CORM_CONFIG_ID` — CormConfig shared object ID (for permissionless corm installation)

Per-environment defaults are defined in `config.ts` and overridden by explicit `VITE_*` vars. Environment files: `.env.localnet`, `.env.utopia`, `.env.stillness`. Package IDs and shared object IDs are auto-populated by `scripts/publish-contracts.sh`; any package left at `0x0` will trigger an "Unconfigured Packages" warning on page load.
**original-id vs published-at (upgrades):** After a Sui package upgrade, struct types (events, objects, coins) remain anchored to the **original** defining package address, not the new `published-at` address. `config.packages.*` contains `published-at` values (for function call targets). `config.originalIds.*` contains `original-id` values (for event queries, type arguments, and `VITE_CORM_COIN_TYPE`). When `VITE_*_ORIGINAL_ID` is unset, `originalIds` falls back to the corresponding `packages.*` value, which is correct for packages that have never been upgraded.
**CormConfig and package identity:** The `CormConfig` shared object is typed to the **original** `corm_state` package address. On upgrade (not republish), CormConfig remains valid because the type identity is preserved. On a full **republish** (new package IDs), the existing `CormConfig` becomes stale — the `install` function on the new package expects its own `CormConfig` type, causing a `TypeMismatch` error. After a republish, `CormConfig` must be recreated via `create_config` on the new package and `VITE_CORM_CONFIG_ID` updated. The publish script handles this automatically, but if it fails (for example, missing `CormAdminCap` or brain address), the config ID must be updated manually.

**Stillness deployment status:** All contract package IDs are configured in `web/.env.stillness` and deployed to https://ef-corm.com via S3 + CloudFront.

## Deployment

- **Local:** `npm run dev` via `mprocs.yaml` (Vite dev server on :5173, proxies `/api` → indexer)
- **Production:** Static build deployed to S3 behind CloudFront
  - Build: `npm run build -- --mode utopia|stillness`
  - Deploy: `make deploy-frontend ENV=utopia|stillness` (S3 sync + CloudFront invalidation)
  - SPA routing: CloudFront 404 → `/index.html`
  - Sui RPC proxy: CloudFront routes `/sui-rpc` → `fullnode.{net}.sui.io/` (same-origin, no CORS issues)
  - Indexer API proxy: CloudFront routes `/api/v1/*` → `api.{env}.ef-corm.com` (same-origin, no CORS issues)

## Features

- Wallet-connected SPA with Eve Frontier Character identity resolution
- Tribe management: creation, self-join (auto-detected), member management, leadership transfer
- Trustless contract creation and filling for all 6 contract types (coin-for-coin, coin-for-item, item-for-coin, item-for-item, multi-input, transport)
- Coin type extraction from on-chain Move struct types (`extractCoinTypeFromObjectType`) — extracts only the first phantom type argument to avoid concatenating multi-type-param generics (e.g. `CoinForCoinContract<CE, CF>`)
- Contract visibility filtering (character and tribe access control)
- Dashboard with configurable quick actions (persisted to localStorage)
- Forge Planner with blueprint browser, recipe tree optimizer, gap analysis, and multi-input order management
- Bill of Materials expansion at configurable depth for contract slot generation
- Continuity Engine with on-chain CormState bridge
- Shadow Location Network: encrypted POD management, TLK/PLK lifecycle (init/wrap/rotate/reset), solo mode (Personal Location Key for tribeless players), signature-derived X25519 keypairs, Poseidon hash commitments
- TLK/PLK reset: officers/leaders (tribe mode) or solo players can permanently delete all tribe/solo location data (PODs, keys, proofs, tags) via a confirmed action on the Locations page
- Browser-side ZK proof generation (Groth16/snarkjs) for region, proximity, and mutual proximity location filters with dedicated proof creation modals for all three circuit types
- Region proof creation: Named Region, Named Constellation, or Custom Bounding Box modes with batch proving for all owned PODs
- Proximity proof creation: reference point + distance threshold with client-side range preview and batch proving
- POD proof review and copy: owners can review and export a shareable proof bundle (public attestation + ZK proofs + location tags) for external applications
- Named region/constellation proof with canonical bounding box validation
- Mutual proximity proof modal for two-structure distance attestation (witnessed contract fulfillment)
- Contract detail page proximity requirement display with link to proof generation
- SSU Delivery dApp for in-game contract fulfillment
- Payout and item pickup notification watcher
- Auto-join tribe detection and one-click self_join
- Initialize tribe banner for unclaimed in-game tribes
- Dashboard Locations card: `ClickableCard` linking to `/locations` for quick access to tribe location management
- Continuity Engine dashboard section: dedicated section below the overview grid containing Install Corm card, conditional Continuity Engine link card (visible when corm is installed, shows current phase), and conditional Corm Status card (phase, stability, corruption, network node from on-chain `useCormState`)
- Install Corm: card under the Continuity Engine section for installing a corm on a player-owned Network Node (permissionless on-chain `corm_state::install`). The install transaction also sets the Network Node's on-chain metadata URL to the full-page Continuity Engine link (`/continuity?node=<id>`) via `network_node::update_metadata_url`, so clicking the node in-game opens the web UI directly. Capped at 320px max-width to prevent the card from stretching across the full grid when it is the only item in the Continuity Engine section.
- Network Node metadata URL repair: owner-only "Set Link" action on `NetworkNodeGroup` headers sets or updates the on-chain metadata URL for nodes that were installed before URL-writing was added. Reads current URL from on-chain `Metadata.url` and only shows the action when the URL is missing or outdated.
- Event Explorer with type/tribe/character filtering, pagination, and "World" module category for structure lifecycle events. Clicking an event row expands an inline drawer directly below it showing on-chain proof details (tx digest, event sequence, checkpoint, timestamp, verification note, raw event data) with a module-colored left accent and slide-down animation.
- Descriptive event display names: `StatusChangedEvent` renders as "Structure Anchored", "Structure Unanchored", etc. based on the event's `action` field, via centralized `eventDisplayName()` formatter
- Structure browser with aggregated SSU inventory
- Assembly metadata: user-defined structure names via world-contract-native metadata on each assembly object, inline edit UI, direct Sui object reads (no indexer dependency). When a metadata name is present, the structures page renders it once as the row's primary title; unnamed structures fall back to the truncated object ID.
- Structure rows use a two-zone flex layout: left-aligned info tags (type, status, energy) with fixed min-widths for vertical alignment, and right-aligned action items (location, extension, online/offline buttons) pushed to the trailing edge. Same pattern applied to NetworkNodeGroup headers.
- Tribe member list includes a "Structures" column linking to each member's structures page (`/structures/:characterId`) for easy cross-member structure browsing
- Location badge deep-linking: the "📍 Location" badge on structure rows and network node headers links to `/locations?structure=<id>`, scrolling to and briefly highlighting the matching POD row on the Locations page
- Structures → Locations navigation: structure rows and network node group headers without a registered location show a "+ Location" link to `/locations`, enabling the player to navigate directly to the Locations page to unlock the TLK and register locations
- Build request (witnessed) contracts: create, list, and detail views for `BuildRequestContract` from the `witnessed_contracts` package. Poster escrows a bounty for building a specific structure type; the CORM witness service auto-fulfills when a matching anchor event is detected. Supports CormAuth requirement, character/tribe access control, and proximity gating. Integrated into the unified contracts list with a "Build Request" type filter.
- Tablet responsiveness: structure rows (`StructureCard`) and network node group headers (`CardHeader`) use `flex-wrap` below the `lg` (1200px) breakpoint so tags and actions flow onto a second line instead of overlapping. Fixed-width badges (`TypeBadge`, `StatusLabel`, `EnergyIndicator`) switch to `width: auto` at this breakpoint.

### CustomSelect (CEF/OSR Compatibility)

All dropdown selects use a custom `CustomSelect` component (`components/shared/CustomSelect.tsx`) instead of native `<select>` elements. EVE Frontier's in-game browser uses CEF in off-screen rendering (OSR) mode, where native `<select>` popups are rendered in a separate buffer (`PET_POPUP`) that the game engine fails to composite. The custom component renders a portal-based `<ul>` dropdown anchored to the trigger via `getBoundingClientRect`, keeping everything in the main DOM layer. Supports flat options, grouped options (optgroups), keyboard navigation, outside-click dismiss, and compact/full-width variants.

## Open Questions / Future Work

- Offline-capable PWA for mobile access
- Real-time event streaming (WebSocket from indexer) instead of polling
- Solo → tribe migration: auto-re-encrypt solo PODs under a tribe TLK when a solo player joins a tribe
- Solo mutual proximity proofs: cross-namespace proof support for two solo players
- Forge Planner: multi-recipe selection for optimizer, batch order creation
