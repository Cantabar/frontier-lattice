/**
 * seed-ores.ts
 *
 * Seeds 100 of each Frontier ore type into the SSU for Player A.
 * Run after world-contracts seed-world.sh has completed.
 *
 * Designed to run from the world-contracts directory so that dotenv/config
 * loads the correct .env and extracted object IDs resolve from deployments/.
 *
 * Usage (from frontier-corm):
 *   cd ../world-contracts && NODE_PATH=$PWD/node_modules npx tsx ../frontier-corm/scripts/seed-ores.ts
 */
import "dotenv/config";
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
// Frontier ore types (from static-data/data/phobos/fsd_built/types.json)
// All ores have volume = 1.
// ---------------------------------------------------------------------------
const ORE_TYPES: { typeId: bigint; name: string }[] = [
    { typeId: 77800n, name: "Feldspar Crystals" },
    { typeId: 77810n, name: "Platinum-Palladium Matrix" },
    { typeId: 77811n, name: "Hydrated Sulfide Matrix" },
    { typeId: 78426n, name: "Iridosmine Nodules" },
    { typeId: 78446n, name: "Methane Ice Shards" },
    { typeId: 78447n, name: "Primitive Kerogen Matrix" },
    { typeId: 78448n, name: "Aromatic Carbon Veins" },
    { typeId: 78449n, name: "Tholin Nodules" },
];

const QUANTITY = 100;
const VOLUME = 1n;
const DELAY_MS = parseInt(process.env.SEED_ORE_DELAY_MS || "2000", 10);

/** Deterministic itemId per ore type — avoids collisions with test-resources IDs. */
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

        // ── Seed each ore type ─────────────────────────────────────
        console.log("\n==== Seeding Ore Items into SSU ====");
        console.log(`SSU:       ${storageUnit}`);
        console.log(`Character: ${characterObject}`);
        console.log(`OwnerCap:  ${ownerCapId}`);
        console.log(`Player:    ${playerAddress}`);
        console.log(`Admin:     ${adminAddress}`);
        console.log(`Ores:      ${ORE_TYPES.length} types x ${QUANTITY} each\n`);

        for (let i = 0; i < ORE_TYPES.length; i++) {
            const ore = ORE_TYPES[i];
            const itemId = itemIdForType(ore.typeId);

            console.log(
                `[${i + 1}/${ORE_TYPES.length}] Minting ${QUANTITY}x ${ore.name} ` +
                `(typeId=${ore.typeId}, itemId=${itemId})...`,
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

            // Mint ore items into SSU inventory
            tx.moveCall({
                target: `${config.packageId}::${MODULES.STORAGE_UNIT}::game_item_to_chain_inventory`,
                typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
                arguments: [
                    tx.object(storageUnit),
                    tx.object(config.adminAcl),
                    tx.object(characterObject),
                    ownerCap,
                    tx.pure.u64(itemId),
                    tx.pure.u64(ore.typeId),
                    tx.pure.u64(VOLUME),
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

            if (i < ORE_TYPES.length - 1) {
                await sleep(DELAY_MS);
            }
        }

        console.log(
            `\n==== Seeded ${ORE_TYPES.length * QUANTITY} ore items ` +
            `(${ORE_TYPES.length} types x ${QUANTITY}) ====\n`,
        );
    } catch (error) {
        handleError(error);
    }
}

main();
