# Assembly Naming — Research Findings

## Problem

On the Eve Frontier "My Structures" page, assemblies are identified by their raw on-chain object IDs (long numeric/hex addresses). There is no built-in way to assign a human-readable name, making the page difficult to navigate when managing multiple structures.

## Current State

The Eve Frontier web UI (and the Nexus community UI at ef-nexus.com) both surface the assembly object ID as the primary identifier. No first-party naming mechanism exists in the current world contracts or game client.

## Options

### Option 1 — On-Chain Name Field (Recommended for Sui showcase)

Add a `name: String` field directly to the assembly struct in Move.

- Name is stored on-chain as part of the assembly object
- Readable by any frontend via Sui RPC object fetch
- Visible to other players
- Demonstrates Sui object model usage
- Requires a `set_name` entry function gated by the assembly owner (OwnerCap pattern)

### Option 2 — Dynamic Field Attachment

Attach the name as a Sui dynamic field on the existing assembly object without modifying the core struct.

- Avoids changing the base struct layout
- Still on-chain and composable
- Slightly more complex to query (need to enumerate dynamic fields by key)
- Useful if we cannot modify the base assembly struct

### Option 3 — Off-Chain Name Mapping

Store an `assembly_id → user_defined_name` mapping in the web app backend (Postgres) or browser `localStorage`.

- No contract changes required
- Names are private/local and not visible to other players
- Does not contribute to Sui on-chain architecture

## Recommendation

Use **Option 1** for any assembly structs we define in Frontier Corm (e.g., `ManufacturingOrder`, `JobPosting`). Add a `name: String` field with a `set_name` entry function protected by the owner capability.

For EVE Frontier world contract assemblies we do not own (SSU, Smart Gate, Smart Turret), use **Option 2** (dynamic field) if we need naming, or **Option 3** if a lightweight local solution is acceptable.

## Relevance to Frontier Corm

The web UI for Frontier Corm should display assembly names wherever a user manages or views structures. This is especially relevant for:

- The Forge Planner UI, which lists `ManufacturingOrder` objects tied to specific SSUs
- The Contract Board UI, which references delivery destination SSUs
- Any "My Structures" equivalent page in our own dApp

## References

- Eve Frontier builder docs: https://docs.evefrontier.com/
- World contracts repo: https://github.com/evefrontier/world-contracts
- ef-nexus.com "My Structures" page (community reference UI)
