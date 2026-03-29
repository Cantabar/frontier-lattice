/**
 * Witness Service — watches for world events (structure anchoring,
 * extension authorization) and matches them against open build request
 * contracts. When conditions are met, signs a BuildAttestation and
 * submits it as a `fulfill` transaction.
 *
 * Architecture:
 *   1. Query open BuildRequestContracts from the SUI RPC
 *   2. For each open contract, query the archived events table for
 *      matching anchor events (StorageUnitCreatedEvent, GateCreatedEvent,
 *      TurretCreatedEvent) and ExtensionAuthorizedEvent with CormAuth
 *   3. If match found: encode + sign a BuildAttestation, submit a
 *      `fulfill` transaction
 *
 * The service runs alongside the indexer and shares the same Postgres
 * connection pool for reading archived events.
 */

import type pg from "pg";
import { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { WitnessConfig } from "./witness-config.js";
import {
  encodeBuildAttestation,
  signAttestation,
  loadKeypair,
  type BuildAttestationData,
} from "./attestation.js";
import { getMutualProximityProof } from "../db/location-queries.js";

const CORM_AUTH_EXT_SUFFIX = "corm_auth::CormAuth";

/** Anchor event names emitted by the world contracts when a structure is deployed. */
const ANCHOR_EVENT_NAMES = [
  "StorageUnitCreatedEvent",
  "GateCreatedEvent",
  "TurretCreatedEvent",
] as const;

/** Extension authorization event emitted by SSU, Gate, and Turret modules. */
const EXTENSION_EVENT_NAME = "ExtensionAuthorizedEvent";

/** Parsed fields from an open BuildRequestContract on-chain object. */
interface OpenBuildRequest {
  contractId: string;
  posterId: string;
  posterAddress: string;
  requestedTypeId: number;
  requireCormAuth: boolean;
  deadlineMs: string;
  bountyAmount: string;
  allowedCharacters: string[];
  allowedTribes: number[];
  /** Optional: reference structure ID for proximity-gated contracts */
  referenceStructureId?: string;
  /** Optional: max distance (ly) for proximity-gated contracts */
  maxDistance?: number;
  /** Optional: tribe ID for ZK proof lookup */
  proximityTribeId?: string;
}

/** Row returned by the anchor event query. */
interface AnchorEventRow {
  primary_id: string;       // assembly_id (structure ID)
  event_data: string;       // JSON
  tx_digest: string;
  checkpoint_seq: string;
  timestamp_ms: string;
}

/** Row returned by the extension event query. */
interface ExtensionEventRow {
  event_data: string;       // JSON
  tx_digest: string;
}

export class WitnessService {
  private pool: pg.Pool;
  private client: SuiClient;
  private config: WitnessConfig;
  private keypair: Ed25519Keypair;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Track contract IDs we've already fulfilled to avoid double-submitting. */
  private fulfilledContracts = new Set<string>();

  constructor(pool: pg.Pool, suiRpcUrl: string, config: WitnessConfig) {
    this.pool = pool;
    this.client = new SuiClient({ url: suiRpcUrl });
    this.config = config;
    this.keypair = loadKeypair(config.privateKey);
  }

  /** Start the polling loop. */
  start(): void {
    if (this.running) return;
    if (!this.config.enabled) {
      console.log("[witness] Service disabled, skipping.");
      return;
    }
    this.running = true;
    console.log(
      `[witness] Starting (interval=${this.config.intervalMs}ms, ` +
      `address=${this.keypair.toSuiAddress()})`,
    );
    this.poll();
  }

  /** Stop the polling loop. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[witness] Stopped.");
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      await this.processOnce();
    } catch (err) {
      console.error("[witness] Poll error:", err);
    }

    if (this.running) {
      this.timer = setTimeout(() => this.poll(), this.config.intervalMs);
    }
  }

  // ================================================================
  // Core: match open contracts against archived world events
  // ================================================================

  /**
   * Single poll iteration:
   *   1. Fetch open BuildRequestContracts from SUI RPC
   *   2. For each, search archived anchor + extension events
   *   3. On match, sign attestation and submit fulfill tx
   */
  private async processOnce(): Promise<void> {
    const openContracts = await this.fetchOpenBuildRequests();
    if (openContracts.length === 0) return;

    for (const contract of openContracts) {
      if (this.fulfilledContracts.has(contract.contractId)) continue;

      try {
        await this.tryFulfill(contract);
      } catch (err) {
        console.error(
          `[witness] Error processing contract ${contract.contractId}:`,
          err,
        );
      }
    }
  }

  /**
   * Attempt to fulfill a single open contract by finding a matching
   * anchor event (and optionally an extension event) in the archive.
   */
  private async tryFulfill(contract: OpenBuildRequest): Promise<void> {
    // 1. Find anchor events matching the requested type_id
    const anchorRows = await this.findMatchingAnchorEvents(
      contract.requestedTypeId,
    );
    if (anchorRows.length === 0) return;

    for (const anchor of anchorRows) {
      const anchorData = parseJson(anchor.event_data);
      const structureId: string =
        anchorData.storage_unit_id ?? anchorData.assembly_id ?? anchorData.turret_id;
      const ownerCapId: string = anchorData.owner_cap_id;
      const typeId: number = Number(anchorData.type_id);

      if (!structureId || !ownerCapId) continue;

      // 2. If CormAuth required, check for matching ExtensionAuthorizedEvent
      let extensionAuthorized = false;
      let extensionTxDigest = "";
      if (contract.requireCormAuth) {
        const extRow = await this.findExtensionEvent(structureId);
        if (!extRow) continue; // no CormAuth yet — skip this structure
        extensionAuthorized = true;
        extensionTxDigest = extRow.tx_digest;
      }

      // 3. Resolve builder address from the OwnerCap's parent Character
      const builderInfo = await this.resolveBuilder(ownerCapId);
      if (!builderInfo) {
        console.warn(
          `[witness] Could not resolve builder for ownerCap ${ownerCapId}, skipping`,
        );
        continue;
      }

      // 4. Check access control (character allowlist)
      if (
        contract.allowedCharacters.length > 0 &&
        !contract.allowedCharacters.includes(builderInfo.characterId)
      ) {
        continue; // builder not in allowlist
      }

      // 4b. Check proximity requirement if specified
      if (
        contract.referenceStructureId &&
        contract.maxDistance != null &&
        contract.proximityTribeId
      ) {
        const proximityProof = await this.checkProximityProof(
          structureId,
          contract.referenceStructureId,
          contract.proximityTribeId,
        );
        if (!proximityProof) {
          continue; // no verified mutual proximity proof yet — skip
        }
      }

      // 5. Encode, sign, and submit
      console.log(
        `[witness] Match found: contract=${contract.contractId} ` +
        `structure=${structureId} type=${typeId} builder=${builderInfo.address}`,
      );

      const now = Date.now();
      const attestationData: BuildAttestationData = {
        contractId: contract.contractId,
        witnessAddress: this.keypair.toSuiAddress(),
        builderCharacterId: builderInfo.characterId,
        builderAddress: builderInfo.address,
        structureId,
        structureTypeId: BigInt(typeId),
        ownerCapId,
        extensionAuthorized,
        anchorTxDigest: hexToBytes(anchor.tx_digest),
        anchorCheckpointSeq: BigInt(anchor.checkpoint_seq),
        extensionTxDigest: extensionTxDigest
          ? hexToBytes(extensionTxDigest)
          : new Uint8Array(),
        deadlineMs: BigInt(now + this.config.attestationTtlMs),
      };

      const attestationBytes = encodeBuildAttestation(attestationData);
      const signature = signAttestation(attestationBytes, this.keypair);

      await this.submitFulfillTx(
        contract.contractId,
        attestationBytes,
        signature,
      );

      this.fulfilledContracts.add(contract.contractId);
      return; // one fulfillment per contract per poll
    }
  }

  // ================================================================
  // SUI RPC: fetch open BuildRequestContracts
  // ================================================================

  /**
   * Query all open BuildRequestContract objects from SUI RPC.
   * Uses `queryObjects` with a struct type filter.
   */
  private async fetchOpenBuildRequests(): Promise<OpenBuildRequest[]> {
    const pkg = this.config.witnessedContractsPackageId;
    if (!pkg) return [];

    const structType = `${pkg}::build_request::BuildRequestContract<${this.config.coinType}>`;

    const results: OpenBuildRequest[] = [];
    let cursor: string | null | undefined = undefined;
    let hasMore = true;

    while (hasMore) {
      const page = await this.client.queryObjects({
        filter: { StructType: structType },
        options: { showContent: true },
        cursor: cursor ?? undefined,
        limit: 50,
      });

      for (const obj of page.data) {
        const parsed = this.parseContract(obj);
        if (parsed) results.push(parsed);
      }

      hasMore = page.hasNextPage;
      cursor = page.nextCursor;
    }

    return results;
  }

  /**
   * Parse a SUI object response into an OpenBuildRequest.
   * Returns null if the contract is not Open or has unexpected shape.
   */
  private parseContract(obj: { data?: { objectId: string; content?: unknown } | null }): OpenBuildRequest | null {
    const content = obj.data?.content as {
      dataType: string;
      fields?: Record<string, unknown>;
    } | undefined;
    if (!content?.fields || content.dataType !== "moveObject") return null;

    const f = content.fields;

    // Status is an enum — check for Open variant
    const status = f.status as { variant?: string } | string | undefined;
    const statusStr = typeof status === "string"
      ? status
      : (status as { variant?: string })?.variant;
    if (statusStr !== "Open") return null;

    // Check deadline hasn't passed
    const deadlineMs = String(f.deadline_ms ?? "0");
    if (Number(deadlineMs) <= Date.now()) return null;

    // Proximity fields (optional — may be absent from older contracts)
    const refStructure = f.reference_structure_id as string | undefined;
    const maxDist = f.max_distance != null ? Number(f.max_distance) : undefined;
    const proxTribe = f.proximity_tribe_id as string | undefined;

    return {
      contractId: obj.data!.objectId,
      posterId: String(f.poster_id ?? ""),
      posterAddress: String(f.poster_address ?? ""),
      requestedTypeId: Number(f.requested_type_id ?? 0),
      requireCormAuth: Boolean(f.require_corm_auth),
      deadlineMs,
      bountyAmount: String(f.bounty_amount ?? "0"),
      allowedCharacters: (f.allowed_characters as string[] | undefined) ?? [],
      allowedTribes: (f.allowed_tribes as number[] | undefined) ?? [],
      ...(refStructure ? { referenceStructureId: refStructure } : {}),
      ...(maxDist != null ? { maxDistance: maxDist } : {}),
      ...(proxTribe ? { proximityTribeId: proxTribe } : {}),
    };
  }

  // ================================================================
  // Proximity: check for a verified mutual proximity proof
  // ================================================================

  /**
   * Query the location_filter_proofs table for a verified mutual
   * proximity proof linking two structures within the given tribe.
   */
  private async checkProximityProof(
    structureId: string,
    referenceStructureId: string,
    tribeId: string,
  ): Promise<boolean> {
    try {
      const proof = await getMutualProximityProof(
        this.pool,
        structureId,
        referenceStructureId,
        tribeId,
      );
      if (proof) {
        console.log(
          `[witness] Mutual proximity proof found: ` +
          `${structureId} ↔ ${referenceStructureId} (tribe=${tribeId})`,
        );
        return true;
      }
      return false;
    } catch (err) {
      console.warn(
        `[witness] Failed to check proximity proof for ` +
        `${structureId} ↔ ${referenceStructureId}:`,
        err,
      );
      return false;
    }
  }

  // ================================================================
  // Postgres: query archived world events
  // ================================================================

  /**
   * Find anchor events (StorageUnitCreated, GateCreated, TurretCreated)
   * that match a requested type_id. Uses a JSON containment query
   * against the archived event_data.
   */
  private async findMatchingAnchorEvents(
    typeId: number,
  ): Promise<AnchorEventRow[]> {
    const names = ANCHOR_EVENT_NAMES as readonly string[];
    const placeholders = names.map((_, i) => `$${i + 1}`).join(", ");

    // event_data is stored as JSON text; parse and filter by type_id.
    // Cast to jsonb for the containment check.
    const result = await this.pool.query(
      `SELECT primary_id, event_data, tx_digest, checkpoint_seq, timestamp_ms
       FROM events
       WHERE event_name IN (${placeholders})
         AND event_data::jsonb @> $${names.length + 1}::jsonb
       ORDER BY id DESC
       LIMIT 100`,
      [...names, JSON.stringify({ type_id: String(typeId) })],
    );

    return result.rows as AnchorEventRow[];
  }

  /**
   * Find an ExtensionAuthorizedEvent with CormAuth for a given structure.
   * Returns the first matching row, or null.
   */
  private async findExtensionEvent(
    structureId: string,
  ): Promise<ExtensionEventRow | null> {
    // ExtensionAuthorizedEvent is emitted by SSU, Gate, and Turret modules.
    // The event_data contains assembly_id and extension_type.
    // We need assembly_id to match structureId and extension_type to contain
    // "corm_auth::CormAuth".
    const result = await this.pool.query(
      `SELECT event_data, tx_digest
       FROM events
       WHERE event_name = $1
         AND event_data::jsonb @> $2::jsonb
       ORDER BY id DESC
       LIMIT 1`,
      [
        EXTENSION_EVENT_NAME,
        JSON.stringify({ assembly_id: structureId }),
      ],
    );

    if (result.rows.length === 0) return null;

    // Verify the extension_type contains CormAuth
    const row = result.rows[0] as ExtensionEventRow;
    const data = parseJson(row.event_data);
    const extType = String(data.extension_type ?? "");

    if (!extType.includes(CORM_AUTH_EXT_SUFFIX)) return null;

    return row;
  }

  // ================================================================
  // SUI RPC: resolve builder from OwnerCap
  // ================================================================

  /**
   * Resolve the builder's character ID and address from an OwnerCap.
   *
   * OwnerCaps are owned by Character objects. We fetch the OwnerCap
   * to find its owner (the Character's object address), then fetch
   * the Character to get the player's wallet address.
   */
  private async resolveBuilder(
    ownerCapId: string,
  ): Promise<{ characterId: string; address: string } | null> {
    try {
      const capObj = await this.client.getObject({
        id: ownerCapId,
        options: { showOwner: true },
      });

      // OwnerCap is owned by a Character (ObjectOwner)
      const owner = capObj.data?.owner;
      if (!owner || typeof owner !== "object") return null;

      let characterAddress: string | undefined;
      if ("ObjectOwner" in owner) {
        characterAddress = (owner as { ObjectOwner: string }).ObjectOwner;
      } else if ("AddressOwner" in owner) {
        // Fallback: directly owned by an address
        characterAddress = (owner as { AddressOwner: string }).AddressOwner;
      }
      if (!characterAddress) return null;

      // Fetch the Character object to get the player's wallet address
      const charObj = await this.client.getObject({
        id: characterAddress,
        options: { showContent: true },
      });

      const charContent = charObj.data?.content as {
        dataType: string;
        fields?: Record<string, unknown>;
      } | undefined;

      if (!charContent?.fields) {
        // If we can't resolve the Character, use the characterAddress directly
        return { characterId: characterAddress, address: characterAddress };
      }

      const playerAddress = String(
        charContent.fields.character_address ?? characterAddress,
      );

      return {
        characterId: charObj.data!.objectId,
        address: playerAddress,
      };
    } catch (err) {
      console.warn(
        `[witness] Failed to resolve builder for ownerCap ${ownerCapId}:`,
        err,
      );
      return null;
    }
  }

  // ================================================================
  // SUI RPC: submit fulfill transaction
  // ================================================================

  /**
   * Build and submit the `build_request::fulfill` transaction.
   */
  private async submitFulfillTx(
    contractId: string,
    attestationBytes: Uint8Array,
    signature: Uint8Array,
  ): Promise<void> {
    const pkg = this.config.witnessedContractsPackageId;
    const tx = new Transaction();

    tx.moveCall({
      target: `${pkg}::build_request::fulfill`,
      typeArguments: [this.config.coinType],
      arguments: [
        tx.object(contractId),
        tx.pure.vector("u8", Array.from(attestationBytes)),
        tx.pure.vector("u8", Array.from(signature)),
        tx.object(this.config.witnessRegistryId),
        tx.object("0x6"), // SUI Clock
      ],
    });

    const senderAddress = this.keypair.toSuiAddress();
    tx.setSender(senderAddress);
    tx.setGasBudget(this.config.gasBudget);

    const txBytes = await tx.build({ client: this.client });
    const { signature: txSig } = await this.keypair.signTransaction(txBytes);

    const result = await this.client.executeTransactionBlock({
      transactionBlock: txBytes,
      signature: txSig,
      options: { showEffects: true },
    });

    const status = result.effects?.status?.status;
    if (status === "success") {
      console.log(
        `[witness] ✓ Fulfilled contract ${contractId} (tx=${result.digest})`,
      );
    } else {
      const errMsg = result.effects?.status?.error ?? "unknown error";
      console.warn(
        `[witness] ✗ Fulfill tx failed for ${contractId}: ${errMsg}`,
      );
    }
  }
}

// ============================================================
// Helpers
// ============================================================

function parseJson(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof raw === "string") return JSON.parse(raw);
  return raw;
}

/** Convert a hex digest string (with or without 0x prefix) to bytes. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 0) return new Uint8Array();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
