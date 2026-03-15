/**
 * seed-ores.ts
 *
 * Seeds 100 of every Frontier item type into the SSU for Player A.
 * Run after world-contracts seed-world.sh has completed.
 *
 * Designed to run from the world-contracts directory so that dotenv/config
 * loads the correct .env and extracted object IDs resolve from deployments/.
 *
 * Usage (from frontier-corm):
 *   cd ../world-contracts && NODE_PATH=$PWD/node_modules npx tsx ../frontier-corm/scripts/seed-ores.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Transaction } from "@mysten/sui/transactions";
import { getConfig, MODULES } from "../../world-contracts/ts-scripts/utils/config";
import { deriveObjectId } from "../../world-contracts/ts-scripts/utils/derive-object-id";
import {
    hydrateWorldConfig,
    initializeContext,
    handleError,
    getEnvConfig,
    shareHydratedConfig,
    requireEnv,
} from "../../world-contracts/ts-scripts/utils/helper";
import { executeSponsoredTransaction } from "../../world-contracts/ts-scripts/utils/transaction";
import {
    GAME_CHARACTER_ID,
    STORAGE_A_ITEM_ID,
} from "../../world-contracts/ts-scripts/utils/constants";
import { getOwnerCap } from "../../world-contracts/ts-scripts/storage-unit/helper";

// ---------------------------------------------------------------------------
// Load every item type from the curated items.json catalogue
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const ITEMS_PATH = resolve(__dirname, "../web/public/items.json");
const FSD = resolve(__dirname, "../static-data/data/phobos/fsd_built");

interface ItemEntry {
    typeId: number;
    name: string;
}

interface TypeEntry {
    volume?: number;
}

const typesData: Record<string, TypeEntry> = JSON.parse(
    readFileSync(resolve(FSD, "types.json"), "utf-8"),
);

/** Look up real volume for a type from static data. On-chain volume is u64, so
 *  we round to the nearest integer and clamp to a minimum of 1. */
function volumeForType(typeId: bigint): bigint {
    const raw = typesData[String(typeId)]?.volume ?? 1;
    return BigInt(Math.max(1, Math.round(raw)));
}

const ALL_ITEMS: { typeId: bigint; name: string }[] = (JSON.parse(
    readFileSync(ITEMS_PATH, "utf-8"),
) as ItemEntry[]).map((item) => ({ typeId: BigInt(item.typeId), name: item.name }));

const QUANTITY = 100;
const DELAY_MS = parseInt(process.env.SEED_DELAY_MS || "2000", 10);

/** Deterministic itemId per item type — avoids collisions with test-resources IDs. */
function itemIdForType(typeId: bigint): bigint {
    return typeId * 10000n + 1n;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    try {
        // ── Initialise contexts ────────────────────────────────────
        const env = getEnvConfig();
        const ctx = initializeContext(env.network, env.adminExportedKey);
        await hydrateWorldConfig(ctx);

        const playerKey = requireEnv("PLAYER_A_PRIVATE_KEY");
        const playerCtx = initializeContext(env.network, playerKey);
        shareHydratedConfig(ctx, playerCtx);

        const { client, keypair, config } = ctx;
        const playerAddress = playerCtx.address;
        const adminAddress = keypair.getPublicKey().toSuiAddress();

        // ── Derive on-chain objects ────────────────────────────────
        const characterObject = deriveObjectId(
            config.objectRegistry,
            GAME_CHARACTER_ID,
            config.packageId,
        );

        const storageUnit = deriveObjectId(
            config.objectRegistry,
            STORAGE_A_ITEM_ID,
            config.packageId,
        );

        const ownerCapId = await getOwnerCap(storageUnit, client, config, playerAddress);
        if (!ownerCapId) {
            throw new Error(`OwnerCap not found for SSU ${storageUnit}`);
        }

        // ── Seed each item type ─────────────────────────────────────
        console.log("\n==== Seeding All Items into SSU ====");
        console.log(`SSU:       ${storageUnit}`);
        console.log(`Character: ${characterObject}`);
        console.log(`OwnerCap:  ${ownerCapId}`);
        console.log(`Player:    ${playerAddress}`);
        console.log(`Admin:     ${adminAddress}`);
        console.log(`Items:     ${ALL_ITEMS.length} types x ${QUANTITY} each\n`);

        for (let i = 0; i < ALL_ITEMS.length; i++) {
            const item = ALL_ITEMS[i];
            const itemId = itemIdForType(item.typeId);
            const volume = volumeForType(item.typeId);

            console.log(
                `[${i + 1}/${ALL_ITEMS.length}] Minting ${QUANTITY}x ${item.name} ` +
                `(typeId=${item.typeId}, itemId=${itemId}, vol=${volume})...`,
            );

            const tx = new Transaction();
            tx.setSender(playerAddress);
            tx.setGasOwner(adminAddress);

            // Borrow OwnerCap from Character
            const [ownerCap, receipt] = tx.moveCall({
                target: `${config.packageId}::${MODULES.CHARACTER}::borrow_owner_cap`,
                typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
                arguments: [tx.object(characterObject), tx.object(ownerCapId)],
            });

            // Mint items into SSU inventory
            tx.moveCall({
                target: `${config.packageId}::${MODULES.STORAGE_UNIT}::game_item_to_chain_inventory`,
                typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
                arguments: [
                    tx.object(storageUnit),
                    tx.object(config.adminAcl),
                    tx.object(characterObject),
                    ownerCap,
                    tx.pure.u64(itemId),
                    tx.pure.u64(item.typeId),
                    tx.pure.u64(volume),
                    tx.pure.u32(QUANTITY),
                ],
            });

            // Return OwnerCap to Character
            tx.moveCall({
                target: `${config.packageId}::${MODULES.CHARACTER}::return_owner_cap`,
                typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
                arguments: [tx.object(characterObject), ownerCap, receipt],
            });

            const result = await executeSponsoredTransaction(
                tx,
                client,
                playerCtx.keypair,
                keypair,
                playerAddress,
                adminAddress,
                { showEvents: true },
            );

            console.log(`  done — digest: ${result.digest}`);

            if (i < ALL_ITEMS.length - 1) {
                await sleep(DELAY_MS);
            }
        }

        console.log(
            `\n==== Seeded ${ALL_ITEMS.length * QUANTITY} items ` +
            `(${ALL_ITEMS.length} types x ${QUANTITY}) ====\n`,
        );
    } catch (error) {
        handleError(error);
    }
}

main();
