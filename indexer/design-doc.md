# Indexer

## Overview

The indexer is an off-chain TypeScript service that subscribes to Sui on-chain events from all Frontier Corm contract modules, archives them with checkpoint inclusion proofs for long-term verifiability, and serves a REST API for historical queries. It also runs an optional cleanup worker that expires and cancels stale on-chain contracts.

## Architecture

```
Sui Checkpoints → Checkpoint Subscriber → Event Archiver → Postgres
                                                              ↓
                                              Express API ← Query Layer

                  Cleanup Worker → Sui RPC (cancel/expire stale contracts)
```

### Components

- **Checkpoint Subscriber** (`subscriber/checkpoint-subscriber.ts`) — polls Sui RPC for events from the `tribe`, `trustless_contracts`, `witnessed_contracts`, and `corm_state` packages. Each event is enriched with checkpoint metadata (sequence, digest, timestamp). Maintains a resumable cursor in the database.
- **Event Archiver** (`archiver/event-archiver.ts`) — writes events with denormalized fields (`tribe_id`, `character_id`, `primary_id`) and updates materialized views (reputation snapshots).
- **Express API** (`api/server.ts`) — serves historical queries, reputation audit trails, checkpoint inclusion proofs, shadow location endpoints, and ZK proof endpoints on the configured port.
- **Cleanup Worker** (`cleanup/cleanup-worker.ts`) — optional background process that finds expired contracts on-chain and submits cancel/expire transactions using a funded keypair.
- **Witness Service** (`witness/witness-service.ts`) — polls for open `BuildRequestContract` objects on-chain, matches them against archived anchor events (StorageUnitCreated, GateCreated, TurretCreated) and CormAuth extension events, resolves builder identity from OwnerCap chains, and submits `fulfill` transactions with BCS-encoded Ed25519-signed `BuildAttestation` messages.
- **Attestation Encoder** (`witness/attestation.ts`) — BCS encoding and Ed25519 signing for `BuildAttestation` payloads matching the on-chain `witness_utils::unpack_build_attestation` deserialization order. Uses SUI PersonalMessage signing format.

### Shadow Location Network

A privacy-preserving location sharing system built into the indexer, providing encrypted structure location data with ZK proof verification. Supports both **tribe mode** (shared with tribe members) and **solo mode** (private to a single player).

- **Location Routes** (`api/location-routes.ts`) — REST API for location PODs (encrypted structure positions) and Tribe/Personal Location Key management. All mutation endpoints require wallet signature authentication (`SuiSig` auth header). Supports:
  - POD CRUD: submit, fetch, list by tribe, revoke
  - TLK lifecycle: init (generate + wrap to members), wrap (client-side wrapping for new members), rotate (version bump + re-wrap), register (X25519 public key registration), pending member listing
  - Solo mode: Personal Location Key (PLK) initialization via `POST /keys/solo-init`, solo POD listing via `GET /solo`. Uses synthetic `solo:<address>` tribe IDs with owner-only access enforcement
  - Network Node PODs: register a node's location and auto-derive PODs for all connected assemblies (via on-chain `connected_assembly_ids`), refresh/cleanup when assemblies connect or disconnect
- **ZK Routes** (`api/zk-routes.ts`) — REST API for Groth16 proof submission and verified location queries:
  - `POST /submit` — submit a region, proximity, or mutual proximity proof; verifies cryptographically, confirms POD existence and location_hash match, validates named region/constellation bounds, stores proof, propagates to derived structures
  - `GET /region` — query PODs with verified region-filter proofs by bounding box
  - `GET /proximity` — query PODs with verified proximity-filter proofs
  - `GET /mutual-proximity` — query for a verified mutual proximity proof between two structures
  - `GET /tags` — public (no auth) query for structure location tags (region/constellation membership)
- **ZK Verifier** (`location/zk-verifier.ts`) — server-side Groth16 proof verification using snarkjs. Lazy-loads circuit verification keys from `circuits/artifacts/`. Supports region, proximity, and mutual proximity filter types. Gracefully rejects proofs when keys are unavailable.
- **Location Crypto** (`location/crypto.ts`) — wallet signature verification (Ed25519, Secp256k1/r1, zkLogin with local ephemeral verification + GraphQL/RPC fallback chain), TLK generation (256-bit random), X25519 ECIES wrapping (ephemeral key + AES-256-GCM). Supports both legacy and human-readable challenge message formats. `verifyTxAuth` verifies the `TxSig` auth scheme: uses `verifyTransactionSignature` from `@mysten/sui/verify` with an Ed25519 manual fallback, validates the challenge (address + timestamp) matches the transaction signer.
- **Session Management** (`location/session.ts`) — opaque session token lifecycle. Tokens are random 32-byte hex strings; only SHA-256 hashes are stored in Postgres. 1-hour TTL with lazy cleanup.
- **Auth Helper** (`api/auth.ts`) — shared authentication for location-routes and zk-routes. Accepts `SuiSig` (wallet personal-message signature), `TxSig` (wallet transaction signature — fallback for wallets whose `signPersonalMessage` is broken), and `Bearer` (session token) authorization schemes.
- **Region Data** (`location/region-data.ts`) — server-side reference data for Eve Frontier regions and constellations with canonical bounding boxes. Used to validate ZK proof public signals against named regions.
- **Sui RPC Helper** (`location/sui-rpc.ts`) — fetches `connected_assembly_ids` from Network Node objects for POD propagation.

### Tracked Events (20+)

- **Tribe (8):** TribeCreatedEvent, MemberJoinedEvent, MemberRemovedEvent, ReputationUpdatedEvent, TreasuryDepositEvent, TreasuryProposalCreatedEvent, TreasuryProposalVotedEvent, TreasurySpendEvent
- **Trustless Contracts (11):** CoinForCoinCreatedEvent, CoinForItemCreatedEvent, ItemForCoinCreatedEvent, ItemForItemCreatedEvent, TransportCreatedEvent, ContractFilledEvent, ContractCompletedEvent, ContractCancelledEvent, ContractExpiredEvent, TransportAcceptedEvent, TransportDeliveredEvent
- **Multi-Input (5):** MultiInputContractCreatedEvent, SlotFilledEvent, MultiInputContractCompletedEvent, MultiInputContractCancelledEvent, MultiInputContractExpiredEvent
- **Assembly Metadata (3):** MetadataCreatedEvent, MetadataUpdatedEvent, MetadataDeletedEvent
- **World (1):** StatusChangedEvent (filtered for UNANCHORED action — triggers metadata cleanup)

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **Database:** PostgreSQL (with location tables)
- **HTTP Framework:** Express
- **Blockchain:** Sui JSON-RPC (`@mysten/sui`)
- **ZK:** Groth16 circuits for region/proximity/mutual proximity location proofs (optional, `circuits/`)

## Configuration

Environment variables (all optional with defaults):

- `SUI_RPC_URL` — Sui RPC endpoint (default: `http://127.0.0.1:9000`)
- `PACKAGE_TRIBE` — deployed tribe package ID
- `PACKAGE_TRUSTLESS_CONTRACTS` — deployed trustless_contracts package ID
- `PACKAGE_CORM_STATE` — deployed corm_state package ID
- `DATABASE_URL` — Postgres connection string (default: `postgresql://corm:corm@localhost:5432/frontier_corm`)
- `API_PORT` — API server port (default: 3100)
- `POLL_INTERVAL_MS` — event poll interval (default: 2000)
- `CLEANUP_ENABLED` — enable cleanup worker (default: false)
- `CLEANUP_WORKER_PRIVATE_KEY` — Sui keypair for contract cleanup transactions
- `WITNESS_ENABLED` — enable witness service (default: false)
- `WITNESS_PRIVATE_KEY` — Ed25519 keypair for signing build attestations
- `WITNESS_POLL_INTERVAL_MS` — witness service poll interval (default: 5000)
- `WITNESS_ATTESTATION_TTL_MS` — attestation validity window (default: 300000)
- `WITNESS_REGISTRY_ID` — WitnessRegistry shared object ID
- `WITNESSED_CONTRACTS_PACKAGE_ID` — witnessed_contracts package ID
- `SUI_GRAPHQL_URL` — Sui GraphQL endpoint for zkLogin verification (default: `https://graphql.testnet.sui.io/graphql`)
- `ZK_ARTIFACTS_DIR` — path to Groth16 circuit verification keys (default: `circuits/artifacts/`)

## API / Interface

### Core Event API

All routes under `/api/v1`. Pagination via `?limit=50&offset=0&order=desc`.

- `GET /health` — health check
- `GET /stats` — indexer statistics
- `GET /events` — all events (optional `?type=EventTypeName`)
- `GET /events/tribe/:tribeId` — events for a tribe
- `GET /events/character/:characterId` — events involving a character
- `GET /events/object/:objectId` — events for a specific object
- `GET /reputation/:tribeId/:characterId` — current reputation + audit trail with proofs
- `GET /reputation/:tribeId/leaderboard` — top members by reputation
- `GET /proof/:eventId` — checkpoint inclusion proof for a single event
- `GET /event-types` — list of all tracked event types

### Shadow Location API

Mounted under `/api/v1/locations`. All endpoints (except `/proofs/tags`) require authentication via either wallet signature (`Authorization: SuiSig <message>.<signature>`) or session token (`Authorization: Bearer <token>`). Solo mode endpoints use synthetic `solo:<address>` tribe IDs with owner-only access enforcement.

**Session Management:**
- `POST /session` — exchange a SuiSig auth for an opaque session token (1-hour TTL). Eliminates repeated wallet signature prompts.

**POD Management:**
- `POST /pod` — submit or update an encrypted location POD
- `GET /tribe/:tribeId` — list all PODs for a tribe (or solo namespace)
- `GET /solo` — list the caller's solo location PODs (convenience wrapper)
- `GET /pod/:structureId?tribeId=X` — fetch a single POD
- `GET /pod/:structureId/proof?tribeId=X` — shareable proof bundle (owner only): public POD metadata, ZK proofs, location tags (excludes encrypted blob)
- `DELETE /pod/:structureId` — revoke a POD (owner only)
- `POST /network-node-pod` — register a Network Node location + derive PODs for connected assemblies
- `POST /network-node-pod/refresh` — re-derive PODs for a Network Node (sync new/removed assemblies)

**TLK / PLK Management:**
- `GET /keys/:tribeId/status` — check TLK/PLK initialization state
- `GET /keys/:tribeId` — fetch caller's wrapped TLK/PLK
- `POST /keys/init` — initialize TLK for a tribe (generates key, wraps to all members)
- `POST /keys/solo-init` — initialize a Personal Location Key for solo mode (generates key, wraps to caller only)
- `POST /keys/wrap` — store a client-wrapped TLK for a new member (server never sees plaintext)
- `POST /keys/rotate` — rotate TLK (new key, wraps to all members, increments version)
- `POST /keys/register` — register caller's X25519 public key for TLK distribution
- `GET /keys/pending/:tribeId` — list members who need a wrapped TLK

### ZK Proof API

Mounted under `/api/v1/locations/proofs`.

- `POST /submit` — submit a Groth16 proof for a structure × filter (region, proximity, or mutual proximity)
- `GET /region` — query PODs with verified region-filter proofs
- `GET /proximity` — query PODs with verified proximity-filter proofs
- `GET /mutual-proximity` — query for a verified mutual proximity proof between two structures
- `GET /tags` — public (no auth) query for structure location tags

## Data Model

### Postgres Tables

- `events` — all archived events with checkpoint proof metadata (`tx_digest`, `event_seq`, `checkpoint_seq`, `checkpoint_digest`), denormalized fields, raw JSON payload
- `metadata_snapshots` — materialized latest assembly metadata per assembly_id (name, description, owner)
- `reputation_snapshots` — materialized latest reputation per tribe×character
- `indexer_cursor` — resumable polling cursor
- `location_pods` — encrypted location PODs per structure×tribe with owner, location_hash, encrypted_blob, nonce, signature, pod/TLK version, optional network_node_id for derived PODs
- `tribe_location_keys` — per-member wrapped TLK blobs (X25519 ECIES), versioned for rotation
- `member_public_keys` — X25519 public keys registered by members for TLK distribution
- `filter_proofs` — verified Groth16 proofs (region/proximity/mutual proximity) per structure×tribe with filter key, public signals, proof JSON, and optional reference_structure_id for mutual proximity proofs
- `location_tags` — public location tags (region/constellation membership) derived from verified ZK proofs
- `location_sessions` — session tokens for Location API auth (token SHA-256 hash, address, expiry). Expired rows cleaned up lazily.

### Checkpoint Proof Verification

Each archived event includes proof metadata for independent verification:
1. Confirm `checkpoint_digest` is signed by ≥2/3 validators for the epoch
2. Confirm `tx_digest` is included in the checkpoint's transaction list
3. Confirm event data matches the event emitted by `tx_digest` at `event_seq`

## Deployment

- **Local:** `npm run dev` via `mprocs.yaml` (waits for Postgres + Sui + contract publish)
- **Production:** Docker container on ECS Fargate behind an ALB
  - ECR repository: `fc-{env}-indexer`
  - Build: `docker build -t <ecr-uri>:latest ./indexer`
  - Deploy: `make deploy-images` (pushes to ECR + forces ECS redeployment)
- Database: RDS Postgres (managed by CDK stack)

## Features

- Checkpoint-based event archival with inclusion proofs for long-term verifiability
- Resumable polling cursor for crash recovery
- Reputation snapshots and leaderboard queries
- Paginated event queries with filtering by type, tribe, character, and object
- Optional cleanup worker for expiring stale on-chain contracts and removing metadata for unanchored structures
- Assembly metadata materialization: event-sourced snapshots with batch query API (`GET /metadata?assemblyIds=`)
- Witness service for automated build request fulfillment (polls open contracts, matches anchor/extension events, signs BCS attestations, submits fulfill transactions) with optional mutual proximity proof verification for proximity-gated contracts
- Shadow Location Network with encrypted PODs, TLK/PLK key management (init/wrap/rotate/register), solo mode (Personal Location Key), and Network Node POD propagation
- ZK proof verification and storage for region, proximity, and mutual proximity location filters (Groth16/snarkjs)
- Public location tagging from verified ZK proofs (region/constellation membership)
- Wallet signature authentication with session token support (sign once, Bearer token for session). Three auth schemes: `SuiSig` (personal message signature), `TxSig` (transaction signature — fallback for wallets like EveVault that don't properly implement `signPersonalMessage`), and `Bearer` (session token).
- zkLogin wallet support with scheme pre-detection and four-tier verification. Signatures are parsed upfront via `parseSerializedSignature` to detect the scheme; zkLogin signatures bypass the SDK's remote `verifyPersonalMessageSignature` (which relies on a Sui GraphQL call that often fails with schema mismatches) and route directly to: local ephemeral Ed25519 verification → direct GraphQL → JSON-RPC fallback. Local verification parses the zkLogin signature, confirms address derivation from iss+addressSeed, and verifies the ephemeral Ed25519 signature against the BCS+intent+Blake2b digest. Does not verify the Groth16 ZK proof (acceptable for Location API auth, not financial transactions). A defensive catch block also handles undetected zkLogin errors ("Cannot parse", "ZkLoginVerifyResult").
- Shareable POD proof bundle export (public attestation + ZK proofs + location tags, no encrypted data)

## Open Questions / Future Work

- Additional witnessed contract types beyond `build_request`
- Event replay / reindexing tooling
- Read replica support for API scaling
- ZK circuit compilation automation (`make zk-build`)
- Location POD re-encryption on TLK rotation
- Solo → tribe migration: auto-re-encrypt solo PODs under a tribe TLK when a solo player joins a tribe
- Solo mutual proximity proofs: cross-namespace proof support for two solo players
