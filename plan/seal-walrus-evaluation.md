# Shadow Location Network — Seal + Walrus Migration Evaluation

## Current Architecture

The SLN is a custom-built privacy system with three layers:

| Layer | Current Implementation | Role |
|-------|----------------------|------|
| **Encryption** | Custom X25519 ECIES key wrapping + AES-256-GCM TLK | Tribe-scoped encryption of location PODs |
| **Storage** | Postgres (7 tables in the indexer DB) | Encrypted blobs, wrapped keys, proofs, tags, sessions |
| **ZK Proofs** | circom/Groth16 (3 circuits) via snarkjs | Region, proximity, mutual proximity proofs |

Everything runs through our indexer — it generates TLKs, wraps them per-member, stores encrypted PODs, and verifies ZK proofs. The server is trusted to distribute keys correctly but never sees plaintext location data.

### Coordinate Reality

Structure coordinates are **not exposed on-chain** in any consumable form. CCP controls location obfuscation — players cannot see exact coordinates. The current SLN handles this by having players select a solar system in the UI, and the system auto-fills the solar system's centroid coordinates (x, y, z) as a proxy. This means:

- **Today**: ZK proofs operate on solar system centroid coordinates. Region/proximity proofs prove properties relative to these centroids — useful for solar system-level and constellation-level assertions, but not structure-level precision.
- **Future**: CCP is expected to eventually expose exact coordinates to players, who can then choose to share them with applications. When this happens, the same ZK circuits work unchanged — they just receive real coordinates instead of centroids, and proofs become structure-level precise.

The architecture is explicitly forward-looking: designed to work with the current solar-system-level reality while being ready for exact coordinates with zero changes to the encryption, storage, or proof verification layers.

## What Seal + Walrus Would Replace

### Seal replaces: Layer 1 (Encryption + Key Management)

Seal is Mysten Labs' decentralized secrets management on Sui. It uses **identity-based encryption (IBE) + threshold cryptography** — data is encrypted client-side against an onchain access policy, and decryption requires a quorum of independent key servers to each validate the policy before releasing partial decryption keys.

**What changes:**
- TLK generation, wrapping, distribution, rotation — **all eliminated**. Seal handles this via onchain policies.
- X25519 keypair management (IndexedDB) — **eliminated**. Seal uses Sui wallet identity directly.
- Member join/leave key rotation — **automatic**. Policy is "is member of tribe X onchain?" — Seal key servers evaluate this in real time.
- Our indexer no longer needs to be trusted for key distribution. Seal key servers are independent third parties.

**What we'd write:**
- An extensible Sui Move policy contract: `location_policy` with player-owned access extensions (see Extensible Policy Model below).
- Client-side: replace `locationCrypto.ts` wrapping/unwrapping with `@mysten/seal` encrypt/decrypt calls.

### Walrus replaces: Layer 2 (Encrypted Blob Storage)

Walrus is decentralized blob storage on Sui with erasure-coded redundancy across storage nodes.

**What changes:**
- `location_pods` table — **eliminated**. Encrypted PODs stored on Walrus by blob ID.
- POD CRUD API endpoints — **simplified to Walrus read/write** + a lightweight mapping table (structure_id → blob_id).
- No Postgres dependency for POD storage (proofs/tags could remain in Postgres or also move to Walrus).

**What stays the same:**
- ZK proofs layer (circom circuits, snarkjs, Groth16) — Seal/Walrus don't replace this.
- Poseidon location hashing — still needed for ZK circuit commitments.
- Proof verification and location tags — still our indexer's job.
- Auth flow — simplified (Seal handles identity via Sui wallet).

## Mapping: Current → Seal + Walrus

| Current Component | Replacement | Notes |
|-------------------|-------------|-------|
| TLK generation (`crypto.ts:generateTlk`) | `location_policy` contract | Shared (group) or personal `PolicyConfig` with extensions |
| TLK wrapping (`crypto.ts:wrapTlk`) | `@mysten/seal` encrypt | Bound to group or personal `PolicyConfig` object ID |
| TLK unwrapping (`locationCrypto.ts:unwrapTlk`) | `@mysten/seal` decrypt | SessionKey (1 per policy) + threshold decryption |
| X25519 keypair (IndexedDB) | Eliminated | Seal uses Sui wallet identity |
| `member_public_keys` table | Eliminated | No separate key registration |
| `tribe_location_keys` table | Eliminated | No wrapped keys to store |
| TLK rotation on member removal | Eliminated | Extension add/remove on `PolicyConfig` — immediate effect |
| `location_pods` table (encrypted blobs) | Walrus blob storage | Store blob ID in lightweight index |
| POD CRUD endpoints | Walrus SDK calls + index | Simplified API surface |
| `location_sessions` table | Eliminated | Seal handles auth context |
| ZK circuits (region/proximity/mutual) | **Unchanged** (client-side proving) | Circuits and snarkjs WASM stay the same |
| ZK verification (indexer `zk-verifier.ts`) | `location_proofs::verifier` library (on-chain) | Inline verification via `sui::groth16`, no registry |
| `location_filter_proofs` table | Eliminated | Proofs verified and consumed inline at contract fulfillment |
| `structure_location_tags` table | Optional (convenience cache) | On-chain verification is source of truth |

## Extensible Policy Model

### The Problem with Static Policies

A naive Seal integration would require players to encrypt their location data once per access group — one blob for tribe, another for alliance, another for contract partners. Each group change means re-encrypting. This is better than TLKs but still cumbersome.

### Shared vs. Personal Policies

The system supports two `PolicyConfig` ownership models, each serving a different purpose:

**Shared PolicyConfig** (group-owned) — the primary model for organized groups. Created and owned by a tribe, DAO, or alliance. Members encrypt their locations against the group's policy. Discoverability is built in — querying by `policy_id` returns all locations shared with that group. One Seal `SessionKey` decrypts all blobs under the policy.

**Personal PolicyConfig** (player-owned) — for selective sharing outside any group structure. A player creates their own policy and manages extensions (specific wallet addresses, time-locks, etc.). Useful for sharing with a few allies or public reveals, but not discoverable by groups.

| Aspect | Shared PolicyConfig | Personal PolicyConfig |
|---|---|---|
| **Owner** | Group (tribe officer, DAO governance, etc.) | Individual player |
| **Extensions managed by** | Group owner/governance | The player |
| **Discoverability** | Built-in — query by policy_id | Only if you know the player |
| **SessionKey cost** | 1 per group (scales to all members' locations) | 1 per player you're viewing |
| **Use case** | "Share with my tribe" | "Share with these specific people" |
| **Blob ownership** | Player owns their Walrus blob | Player owns their Walrus blob |

### Why Shared Policies Are the Primary Model

Discoverability is the deciding factor. With personal policies, there's no way for a group to know which members have granted them access — the group would need to poll every member's `PolicyConfig` on-chain. With a shared policy, membership in the location set is explicit: if you encrypted against the group's policy, you're in the set.

Shared policies also scale better for decryption. A tribe leader viewing 200 members' locations needs 1 SessionKey (one key server round-trip), not 200.

### PolicyConfig Contract

```move
module location_policy::policy {

    struct PolicyConfig has key {
        id: UID,
        owner: address,
        extensions: vector<AccessExtension>,
    }

    struct AccessExtension has store, copy, drop {
        kind: u8,       // TRIBE_MEMBER | DAO_BOARD | ADDRESS_LIST | TIME_LOCK | ...
        target_id: ID,  // the object to check against (tribe, DAO, etc.)
        params: vector<u8>, // extension-specific parameters (e.g., timestamp for time-lock)
    }

    // -- Constants for extension kinds --
    const TRIBE_MEMBER: u8 = 0;
    const DAO_BOARD: u8 = 1;
    const ADDRESS_LIST: u8 = 2;
    const TIME_LOCK: u8 = 3;

    /// Called by Seal key servers during dry-run simulation.
    /// Succeeds if the sender satisfies ANY extension. Aborts otherwise.
    public fun seal_approve(
        config: &PolicyConfig,
        // ... registry references as needed
        ctx: &TxContext,
    ) {
        let sender = ctx.sender();
        let mut authorized = false;
        let mut i = 0;
        while (i < vector::length(&config.extensions)) {
            let ext = vector::borrow(&config.extensions, i);
            if (ext.kind == TRIBE_MEMBER) {
                // check tribe membership on-chain
            } else if (ext.kind == DAO_BOARD) {
                // check Armature DAO board membership
            } else if (ext.kind == TIME_LOCK) {
                // check clock >= params.timestamp
            };
            i = i + 1;
        };
        assert!(authorized, ENotAuthorized);
    }

    /// Only the owner can add extensions.
    public fun add_extension(
        config: &mut PolicyConfig,
        extension: AccessExtension,
        ctx: &TxContext,
    ) {
        assert!(ctx.sender() == config.owner, ENotOwner);
        vector::push_back(&mut config.extensions, extension);
    }

    /// Only the owner can remove extensions.
    public fun remove_extension(
        config: &mut PolicyConfig,
        index: u64,
        ctx: &TxContext,
    ) {
        assert!(ctx.sender() == config.owner, ENotOwner);
        vector::remove(&mut config.extensions, index);
    }
}
```

### How Shared Policies Work in Practice

```
Setup:
  Tribe 42 officer creates a shared PolicyConfig
  Adds extension: tribe_member(Tribe #42)
  → Any Tribe 42 member can decrypt blobs encrypted under this policy

Player X registers a location:
  Encrypts against Tribe 42's PolicyConfig → blob_x on Walrus
  Registers index: (structure_A, policy_42, blob_x, owner: player_X)
  → Discoverable: anyone querying policy_42 sees structure_A in the list
  → Decryptable: any tribe member gets a SessionKey and decrypts

Player Y registers a location:
  Same policy → blob_y on Walrus
  → Both structure_A and structure_B now in the policy_42 set

Tribe leader views all locations:
  1 SessionKey for policy_42 (one key server round-trip)
  Fetches all blobs under policy_42 from Walrus
  Decrypts all locally
```

### How Personal Policies Work

```
Player X creates a personal PolicyConfig
  Adds extension: address_list([ally_1, ally_2])
  Encrypts location against their personal policy → blob_z on Walrus

Player X later adds: time_lock(May 1 2026)
  → ally_1 and ally_2 can decrypt now, everyone after May 1
  → Same blob, no re-encryption

Player X removes address_list extension
  → Only the time-lock remains — nobody until May 1, then everyone
```

### Extension Types

Extension types are defined in a single policy contract. New kinds can be introduced via contract upgrades — zero indexer/client changes.

| Kind | Check | Use Case |
|---|---|---|
| `TRIBE_MEMBER` | `tribe::is_member(target_id, sender)` | Current SLN behavior |
| `DAO_BOARD` | Armature `governance::is_board_member(target_id, sender)` | DAO-gated access |
| `ADDRESS_LIST` | Sender in a stored address set | Direct grants to specific wallets |
| `TIME_LOCK` | `clock::timestamp_ms() >= params.timestamp` | Delayed public reveal |
| `CONTRACT_PARTY` | Sender is party to a specific build contract | Contract-scoped sharing |
| `NFT_HOLDER` | Sender holds an NFT from a collection | Token-gated intel |

### POD Ownership and Deletion

Each encrypted POD blob on Walrus is owned by the player who created it, regardless of which policy it was encrypted under. This preserves data sovereignty within shared policies.

**Deletion authority matrix:**

| Actor | Delete blob (Walrus) | Remove from index | Decrypt (Seal) |
|---|---|---|---|
| **Player (POD creator)** | Yes — owns the blob object | Yes | If policy passes |
| **Policy owner** (tribe officer, DAO) | No | Yes — can remove from group's location set | If policy passes |
| **Group member** | No | No | If policy passes |
| **Expiry / nobody** | Automatic (epoch expiry) | Automatic (cleanup) | No |

**Removal scenarios:**

```
Player leaves voluntarily:
  → Player deletes their Walrus blob (data permanently gone)
  → Index mapping removed
  → Clean exit, data sovereignty preserved

Group admin removes a player's location:
  → Admin removes the index mapping (location no longer discoverable under this policy)
  → Blob still exists on Walrus — player can still delete it or use it elsewhere
  → Group members no longer see it in the location set

Player removed from group on-chain (e.g., kicked from tribe):
  → Player can no longer decrypt OTHER members' locations (Seal policy fails)
  → Other members CAN still decrypt the removed player's old blob
    (they still satisfy the policy — the blob was encrypted under the group's policy)
  → Policy owner should remove the index mapping to clean up
  → Player can delete their blob if they want their data gone entirely
```

Note: removing someone from a group doesn't automatically hide their previously shared location from remaining members. The blob is still on Walrus, still encrypted under the group's policy, and current members still satisfy the policy. This matches reality — if you shared your forge location last week and then left, the group already knows where it is. If the player wants their data gone, they delete the Walrus blob.

### UX Model: Opt-Out with Background Sync

Structure coordinates are only known to the player — they are not exposed on-chain in a consumable form until the player fully reveals them without obfuscation. This means all encryption must happen client-side, but we can minimize friction with an opt-out model and background sync.

**One-time opt-in:**

```
Player joins Tribe 42's location sharing:
  → "Auto-share all structure locations with Tribe 42?"
  → Player approves (wallet signature for Seal session + signing key)
  → Preference stored in IndexedDB:
    { policy_id: policy_42, mode: "auto", excludes: [] }
```

**Background sync (on every page load / periodic):**

```
1. Fetch player's structures that have solar system assignments
   └─ Player selected solar systems during initial structure registration
   └─ System auto-filled centroid coordinates at that time
   └─ (Future: when CCP exposes exact coords, those replace centroids)

2. Compare against registered PODs under active policies
   └─ Indexer query: "what structures has player X registered under policy_42?"

3. For any structure with a solar system but no POD (not in excludes list):
   a. Look up centroid coordinates for the solar system
   b. Encrypt against group PolicyConfig (local, Seal IBE)
   c. Upload to Walrus (using pre-authorized signing session)
   d. Register metadata with indexer
   └─ No wallet popup — uses session signing key from opt-in step

4. For any excluded structure: skip silently
```

**Opt-out for specific structures:**

```
Player's location manager:
  ✓ SSU Alpha (Forge)        — shared with Tribe 42
  ✓ SSU Beta (Refinery)      — shared with Tribe 42
  ✗ SSU Gamma (Personal Base) — excluded (player opted out)
  ✓ Gate Delta               — shared with Tribe 42

Player can toggle any structure to exclude it from auto-sharing.
Excluding a structure:
  → Removes index mapping
  → Optionally deletes Walrus blob (player's choice)
  → Background sync skips it going forward
```

**Session signing for zero-friction uploads:**

Walrus blob creation requires a Sui transaction. To avoid wallet popups on every sync, the player authorizes a session signing key during the one-time opt-in. This session key can sign Walrus uploads and index registrations without further wallet interaction. The session key has a configurable TTL (e.g., 24 hours, 7 days) and limited scope (can only create Walrus blobs and register index entries — cannot transfer funds or modify PolicyConfig).

When the session key expires, the player sees a non-blocking prompt on next page load to re-authorize.

### Encryption Flow (Per-POD Upload)

```
Browser (client-side)                           External Services
─────────────────────                           ─────────────────

1. Background sync identifies unregistered structure
   └─ Player selected solar system during structure registration
   └─ System auto-fills centroid coordinates (x, y, z) for that system
   └─ (Future: CCP exposes exact coordinates, player provides those instead)

2. Generate random salt → Poseidon4(x, y, z, salt) → location_hash

3. Serialize payload: JSON({ x, y, z, salt, solarSystemId, ... })

4. Encrypt with Seal:                           Seal SDK encrypts locally
   seal.encrypt({                               using IBE. No network call.
     data: payload,                             Key servers NOT contacted.
     policyId: group's PolicyConfig.id,
     packageId: location_policy package,
     threshold: 2
   })

5. Store on Walrus:                             Walrus stores ciphertext
   blob_id = walrus.writeBlob(encrypted_blob)   only. Cannot decrypt.
   └─ Signed by session key (gas-sponsored)
   └─ Blob object owned by player's address

6. Register metadata with indexer:              Lightweight index row.
   POST /locations/pod {                        No encrypted data.
     structure_id, policy_id, blob_id,
     location_hash, owner_address, pod_version
   }
```

Raw coordinates never leave the browser. The indexer never sees plaintext. Walrus and Seal key servers never see plaintext. Access is controlled by the `PolicyConfig` extensions, evaluated in real-time by Seal key servers against current chain state.

### CCP Coordination and Strategic Positioning

CCP currently controls location obfuscation — players cannot see exact structure coordinates. The SLN works within this constraint using solar system centroid coordinates as proxies.

**Future expectation:** CCP will eventually expose exact coordinates to players, who can then choose to share them with applications. When this happens, the SLN's encryption, storage, and proof layers work unchanged — centroids are simply replaced with real coordinates.

**Feature proposal strategy:** This spec is being shared with CCP. The SLN architecture separates into two layers:

1. **Player-owned location sharing** — a player decides to share their location data with an application. This is the simpler half, and CCP may implement this natively (exposing coordinates to players with consent).

2. **Organizational location sharing** — encrypted sharing with tribes, DAOs, alliances, with ZK proofs for verifiable claims. This is the complex half that CCP is unlikely to cover.

If CCP implements layer 1, this application is already positioned to provide layer 2 on top of it. The shared PolicyConfig model, Seal encryption, Walrus storage, and ZK verifier library all operate on whatever coordinate data the player provides — whether from our solar system centroid lookup or from CCP's future coordinate API. The organizational layer is the value-add that sits on top of either source.

### Decryption at Scale: SessionKeys

Seal's `SessionKey` mechanism avoids per-blob key server round-trips:

```
1. Player creates a SessionKey (ephemeral keypair, client-side)
2. One transaction calls seal_approve for the group's PolicyConfig
   → Signed with wallet → sent to key servers ONCE
3. Key servers validate policy, return partial decryption keys
   bound to the SessionKey (not to a specific blob)
4. Player decrypts ALL blobs under that PolicyConfig locally
   → No further key server contact until SessionKey expires

Performance:
  1 SessionKey setup .............. ~200ms (one-time, per policy)
  1,000 blob decryptions ......... ~10ms  (local crypto)
  Subsequent sessions same day ... ~10ms  (if SessionKey still valid)
```

Cost scales with **unique policies accessed**, not total blobs:

| Scenario | SessionKeys Needed | Key Server Round-Trips |
|---|---|---|
| Tribe leader views 200 members' locations (shared policy) | 1 | 1 |
| Player views 5 groups they belong to | 5 | 5 (parallelizable) |
| Player views 10 individual allies (personal policies) | 10 | 10 (parallelizable) |

## Composability: Beyond Tribes

### What This Means for the Architecture

**The "organization" is just a shared PolicyConfig.** Our system doesn't need to know or care what kind of organization it is — it stores `(structure_id, policy_id, blob_id, owner_address)` tuples. The Seal key servers evaluate the policy extensions against current chain state.

This means:
- The indexer is organization-agnostic. A tribe, DAO, alliance, and ad-hoc group all look the same: a `policy_id` with blobs under it.
- The web client shows: "Share with: [list of group policies you belong to] / Personal..."
- New group types are supported by creating a new shared `PolicyConfig` with the appropriate extensions — zero indexer or client changes.
- A single shared policy can compose multiple extensions: tribe members + allied DAO board + time-locked public reveal, all active simultaneously.
- Third-party projects (e.g., Armature) create their own shared `PolicyConfig` with a `DAO_BOARD` extension — their members encrypt against it, and the SLN infrastructure works identically.

### Continuity Engine Interaction Model

The CE should **never decrypt location data**. Instead, contracts require ZK proofs to be verified inline at fulfillment time. A shared verifier library provides pure verification functions — no attestation registry, no stored state.

```
Player A (location known to self + policy extensions)
    │
    ├─ Generates ZK proximity proof client-side (snarkjs, browser WASM)
    │
    ├─ Submits proof as part of contract fulfillment transaction (PTB):
    │   └─ verifier::verify_proximity(vk, proof, public_signals)
    │   └─ Contract checks: result.distance_sq <= max_distance_sq
    │   └─ Proof is verified and consumed in one transaction — not stored
    │
    └─ CE observes contract fulfillment events on-chain
        └─ The fulfilled contract IS the attestation that proximity was proven
        └─ CE never needs plaintext coordinates or stored proofs
```

### On-Chain ZK Verifier Library

Proof verification moves from our indexer to a shared Move library using Sui's native `sui::groth16`. This is a **library, not a registry** — proofs are verified inline and consumed, not stored. Most proofs are contract-specific (structure A within 10ly of structure B for a specific build request) and will only be verified once.

```move
module location_proofs::verifier {
    use sui::groth16;

    /// Verify a proximity proof inline. Pure function, no storage.
    public fun verify_proximity(
        vk: &VerifyingKey,
        proof: vector<u8>,
        public_signals: vector<u8>,
    ): (ID, ID, u64) {  // (structure_a, structure_b, distance_sq)
        assert!(groth16::verify_groth16_proof(
            &prepare_vk(vk), &public_signals, &proof
        ), EInvalidProof);
        parse_proximity_signals(&public_signals)
    }

    /// Verify a region proof inline. Pure function, no storage.
    public fun verify_region(
        vk: &VerifyingKey,
        proof: vector<u8>,
        public_signals: vector<u8>,
    ): (ID, vector<u64>) { ... }
}
```

Verification keys (one per circuit) are stored in a single shared object. Consuming contracts call the library and act on the result:

```move
// In witnessed_contracts — build request fulfillment
public fun fulfill_build_request(
    contract: &mut BuildRequest,
    vk: &VerifyingKey,
    proof: vector<u8>,
    public_signals: vector<u8>,
    ...
) {
    let (struct_a, struct_b, dist_sq) = verifier::verify_proximity(vk, proof, public_signals);
    assert!(struct_a == contract.structure_id, EWrongStructure);
    assert!(dist_sq <= contract.max_distance_sq, ETooFar);
    // ... proceed with fulfillment
}
```

Any contract on Sui can import and use the verifier — our contracts, Armature proposals, third-party contracts we've never seen. The circuits become **public infrastructure**.

This cleanly separates concerns:
- **Seal + Walrus**: encrypted storage + policy-based access (who can see raw coords)
- **ZK verifier library**: on-chain proof verification as a pure function (trustless, no indexer)
- **CE + contracts**: business logic that requires proof at fulfillment time, never sees coordinates

### Armature Interoperability

The [Armature Framework](https://github.com/loash-industries/armature) (programmable DAO protocol on Sui for Eve Frontier) integrates at two levels:

**As a policy extension:** A `DAO_BOARD` extension kind checks Armature's `governance::is_board_member()`. Players can grant their DAO access to their location data by adding this extension to their `PolicyConfig`. SubDAO hierarchies and federation seats map naturally — parent DAO access, allied DAO access, etc.

**As a proof consumer:** Armature proposals can call the ZK verifier library directly. A DAO could create a custom proposal type like `ProximityGatedAction` that requires a valid proximity proof as part of execution — no modification to Armature's core framework needed (uses their open proposal type set pattern).

Armature already uses Walrus for charter document storage, so the infrastructure overlap is natural.

## Benefits

1. **Decentralized trust**: No longer trusting our indexer to correctly distribute TLKs. Seal key servers are independent operators (Ruby Nodes, H2O, Triton One, etc.).
2. **Eliminated key management complexity**: ~400 lines of X25519 wrapping, TLK rotation, member key registration code — gone.
3. **Automatic access revocation**: Membership/condition changes take effect immediately — no lazy re-encryption needed.
4. **Censorship-resistant storage**: Walrus blobs survive even if our indexer goes down. PODs persist independently.
5. **Ecosystem alignment**: Both are first-party Mysten Labs infra on Sui — likely to be well-maintained and increasingly integrated.
6. **Reduced Postgres surface**: Fewer tables, simpler schema, less operational burden.
7. **Composable access control**: New sharing models (alliances, contracts, time-locks) are just new Move policy contracts — no indexer or client changes required.
8. **Organization-agnostic**: The system no longer couples to tribes. Any onchain group or condition works.

## Risks and Concerns

1. **Seal local testing is Rust-only**: `SealTestCluster` is an embedded Rust test harness — no standalone Docker image or binary to run key servers locally. See localnet section below.
2. **Walrus local testbed is immature**: Publisher/aggregator features not yet supported in the Docker testbed.
3. **Latency**: Threshold decryption requires round-trips to multiple key servers. Current TLK unwrap is instant (local crypto). This could affect UX for bulk POD decryption.
4. **Cost**: Walrus storage costs WAL tokens per epoch. Postgres is free (we already run it).
5. **Dependency on external services**: Seal key servers and Walrus storage nodes are third-party infrastructure. Outages affect us.
6. **ZK layer unchanged**: The most complex part (circuits, proving, verification) isn't simplified by this migration.
7. **Policy contract correctness**: Access control bugs in Move policy contracts could leak location data. Needs careful auditing.

## Cost Analysis

Location PODs are tiny (~300 bytes encrypted). At this scale, costs are negligible.

### Per-Location Upload

| Cost Item | Payer | Amount |
|---|---|---|
| Seal encryption | Nobody | Free — client-side IBE, no network call |
| Walrus blob storage | Sponsor | ~8,200 FROST/epoch (~$0.0000006 at $0.073/WAL) |
| Sui gas for Walrus write tx | Sponsor | ~0.001-0.01 SUI |
| Sui gas for PolicyConfig creation | Sponsor (once per player) | ~0.01 SUI |
| Sui gas for extension add/remove | Sponsor | ~0.001 SUI per operation |

### Per-Decryption

| Cost Item | Payer | Amount |
|---|---|---|
| Seal key server request | Provider-dependent | Free on testnet; mainnet TBD |
| Seal policy evaluation | Nobody | Free — key servers simulate via dry run |
| Walrus blob read | Nobody | Free — no WAL cost for reads |

### Per-ZK Proof Verification (on-chain)

| Cost Item | Payer | Amount |
|---|---|---|
| Sui gas for `groth16::verify` | Sponsor | ~0.01-0.05 SUI (heavier than normal tx) |

### At Scale (1,000 structures, annual)

| Line Item | Annual Cost |
|---|---|
| Walrus storage (1,000 blobs × 183 epochs) | ~1.5 WAL (~$0.11) |
| Sui gas (writes, renewals, PolicyConfig ops) | ~10-100 SUI ($5-50) |
| Seal mainnet decryption | Unknown — biggest cost wildcard |

**Storage is essentially free** — Walrus is priced for large files; 300-byte PODs are rounding errors. **Sui gas is the recurring cost** but manageable. **Seal mainnet pricing is the unknown** — key server operators haven't published rates.

### Sponsored Transactions

Sui natively supports transaction sponsorship. A sponsor (e.g., CORM) provides gas objects; the player co-signs but pays nothing. Players never need to hold SUI or WAL.

```
Player action: "Register my location"
  ├─ Browser builds Walrus store transaction
  ├─ Sends unsigned tx to sponsor backend (our indexer)
  ├─ Sponsor attaches gas objects (SUI + WAL) and co-signs
  ├─ Player co-signs (wallet popup — they pay nothing)
  └─ Transaction submitted
```

Walrus storage renewals can also be automated — a smart contract can extend blob availability in perpetuity as long as funds exist.

## Local Development Feasibility

### Walrus Localnet: Yes (with caveats)

Official Docker testbed exists: [MystenLabs/walrus-docker-testbed](https://github.com/MystenLabs/walrus-docker-testbed)

```bash
git clone https://github.com/MystenLabs/walrus-docker-testbed
cd walrus-docker-testbed
docker compose up
# Launches: 4 Sui validators + fullnode + faucet + 4 Walrus storage nodes
# REST API on port 9185 for blob read/write
```

- **Works for**: storing and retrieving encrypted blobs via REST API or CLI.
- **Limitation**: publisher/aggregator not yet supported; each restart creates a fresh network.
- **Integration path**: Add to our `docker-compose.yml` or `mprocs.yaml`. Community Go SDK (`walrus-go`) talks HTTP, so it works against the local testbed.

### Seal Localnet: Not directly — but workable with an abstraction layer

The `SealTestCluster` is Rust-only and embedded in the test harness. There is **no standalone Docker image** for Seal key servers. Options:

#### Option A: Mock Seal locally, real Seal on testnet (Recommended)

Create a `SealProvider` interface that abstracts encrypt/decrypt:

```typescript
interface SealProvider {
  encrypt(data: Uint8Array, policyId: string): Promise<EncryptedBlob>;
  decrypt(blob: EncryptedBlob, sessionKey: SessionKey): Promise<Uint8Array>;
}

// Production: delegates to @mysten/seal SDK + real key servers
class RealSealProvider implements SealProvider { ... }

// Local dev: uses our existing AES-256-GCM encryption with a static key
// (no threshold decryption, but same interface)
class LocalSealProvider implements SealProvider { ... }
```

- **Pros**: Full local stack works with `mprocs`. Tests run fast. No external dependencies.
- **Cons**: Doesn't exercise real Seal policies locally. Policy bugs only caught on testnet.
- **Mitigation**: CI runs integration tests against Sui testnet with real Seal key servers.

#### Option B: Wrap Seal Rust key server in a Docker container (Heavy)

Build a custom Docker image that embeds `SealTestCluster` in a small HTTP server:

- Fork Seal, add a thin HTTP wrapper around the test cluster.
- Publish as an internal Docker image.
- Add to `docker-compose.yml`.

- **Pros**: Full Seal locally.
- **Cons**: Maintenance burden. Fragile (depends on Seal internals). Overkill for our scale.

#### Option C: Always use testnet Seal (Simplest but not offline)

Skip local Seal entirely. All dev environments point at Sui testnet Seal key servers.

- **Pros**: Zero local setup. Always testing real infra.
- **Cons**: Requires internet. Slower. Can't develop offline. Testnet may be unstable.

### Recommended Local Dev Setup

```
mprocs (existing)
├── sui-localnet          (existing)
├── postgres              (existing)
├── walrus-testbed        (NEW — docker compose for Walrus nodes)
├── indexer               (existing, but simplified — fewer tables)
├── web                   (existing, uses LocalSealProvider)
└── continuity-engine     (existing, unchanged)
```

- **Walrus**: Run the Docker testbed alongside our existing local stack.
- **Seal**: Use `LocalSealProvider` (mock) locally. Real Seal on utopia/stillness.
- **ZK**: Unchanged — circuits compile and run locally via snarkjs.

## Migration Strategy

### Phase 1: Abstraction Layer (No behavior change)

1. Introduce `SealProvider` interface in the web client.
2. Implement `LocalSealProvider` using current AES-256-GCM + TLK logic.
3. Introduce `StorageProvider` interface in the indexer.
4. Implement `PostgresStorageProvider` using current tables.
5. All existing tests and flows work unchanged.

### Phase 2: Walrus Integration

1. Add `walrus-docker-testbed` to local dev stack.
2. Implement `WalrusStorageProvider` — stores encrypted POD blobs on Walrus, keeps a lightweight `(structure_id, tribe_id, blob_id)` mapping in Postgres.
3. Migrate POD storage behind feature flag (`STORAGE_BACKEND=walrus|postgres`).
4. Remove `location_pods.encrypted_blob` and `location_pods.nonce` columns (blob content moves to Walrus; metadata stays in Postgres).

### Phase 3: Seal Integration + Extensible Policy

1. Deploy `location_policy` contract with `PolicyConfig` object and initial extension kinds:
   - `TRIBE_MEMBER` — checks `tribe::is_member()` (1:1 replacement of current behavior).
   - `ADDRESS_LIST` — direct grants to specific wallets.
   - `TIME_LOCK` — decrypt after a timestamp.
2. Implement `RealSealProvider` using `@mysten/seal` SDK.
3. Switch web client to `RealSealProvider` on testnet environments.
4. Support shared policies: tribe officers / DAO admins can create a group `PolicyConfig`.
   - Members see available group policies and encrypt against them.
   - UI: "Share with: [Tribe 42] / [Alliance Alpha] / Personal..."
5. Support personal policies: players create their own `PolicyConfig` for selective sharing.
   - Extension manager UI: "Add access: Specific Players / Time-Lock..."
6. Implement opt-out background sync UX:
   - One-time opt-in per group policy (wallet signature for session key).
   - Background sync on page load: detect unregistered structures, auto-encrypt & upload.
   - Per-structure exclude list for structures the player doesn't want to share.
   - Session signing key for zero-friction Walrus uploads (configurable TTL).
7. Indexer stores `(structure_id, policy_id, blob_id, owner_address)` — organization-agnostic.
   - Query by `policy_id` for group discoverability.
   - `owner_address` tracks who can delete the blob.
7. Remove TLK generation, wrapping, distribution code from indexer.
8. Remove `tribe_location_keys`, `member_public_keys` tables.
9. Remove `location_sessions` table (Seal handles auth context).

### Phase 3b: Additional Extension Kinds (contract upgrade, no infra changes)

1. `DAO_BOARD` — checks Armature `governance::is_board_member()`.
2. `CONTRACT_PARTY` — checks if sender is party to a specific build contract.
3. `NFT_HOLDER` — checks NFT ownership from a collection.
4. Each is a contract upgrade adding a new `kind` constant + check branch — zero indexer/client changes.

### Phase 4: On-Chain ZK Verification

1. Deploy `location_proofs::verifier` library contract with verification keys for all three circuits.
2. Integrate `verify_proximity()` into `witnessed_contracts` build request fulfillment.
3. Indexer ZK verification becomes optional (convenience/caching, not source of truth).
4. Remove `location_filter_proofs` and `structure_location_tags` tables from indexer if fully migrated on-chain.

### Phase 5: Cleanup

1. Remove `LocalSealProvider` fallback if no longer needed (or keep for offline dev).
2. Remove `PostgresStorageProvider` if fully migrated.
3. Update design docs and service design docs.

## Decision Matrix

| Criterion | Current (Custom) | Seal + Walrus |
|-----------|-----------------|---------------|
| Local dev | Full offline stack | Walrus local + Seal mock (or testnet) |
| Trust model | Trust our indexer | Trust Seal key servers (decentralized) |
| Key management | Complex (X25519, TLK, rotation) | Eliminated (policy-based) |
| Storage resilience | Single Postgres instance | Erasure-coded across nodes |
| Latency | Fast (local crypto) | Slower (network round-trips to key servers) |
| Cost | Free (Postgres) | WAL tokens for Walrus storage |
| Code complexity | ~1500 lines crypto + storage | ~300 lines (provider interfaces + Seal/Walrus calls) |
| Ecosystem fit | Custom, isolated | Native Sui infrastructure |
| Composability | Tribe-only | Any onchain condition (policy contracts) |
| New sharing models | Requires indexer + client changes | Deploy a Move contract, done |

## Recommendation

**Proceed with migration, using Option A (mock Seal locally) for local dev.**

The complexity reduction is significant — eliminating ~1200 lines of key management code and 5 Postgres tables (3 key management + 2 ZK storage). The trust model improves from "trust our indexer" to fully trustless: Seal key servers for access control, Walrus for storage, `sui::groth16` for proof verification. No trusted third party remains in the data path.

The extensible policy model means players encrypt once and manage access dynamically via on-chain extensions. New access models (DAOs, alliances, time-locks, NFT gates) are contract upgrades — zero indexer or client changes. Third-party projects like Armature integrate by adding an extension kind that checks their membership model.

The main risk (no Seal localnet) is adequately mitigated by the provider abstraction pattern. Local dev uses a mock that preserves the same encrypt/decrypt interface, while CI and staging test against real Seal on testnet.

Costs are negligible for small payloads — Walrus storage for 1,000 locations costs ~$0.11/year. Sui gas is the primary recurring cost (~$5-50/year at scale). Seal mainnet decryption pricing is the unknown. All costs can be sponsored so players never hold SUI or WAL.

Start with Phase 1 (abstraction layer) — it's zero-risk and makes the migration incremental.
