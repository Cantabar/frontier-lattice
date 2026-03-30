/**
 * Frontier Corm Event Indexer — Entry Point
 *
 * Initialises:
 *   1. Postgres database (schema migration)
 *   2. Event archiver (write-side)
 *   3. Checkpoint subscriber (Sui RPC polling)
 *   4. Express API server (read-side)
 *
 * Environment variables (all optional, sensible defaults for local dev):
 *   SUI_RPC_URL          — Sui RPC endpoint (default: http://127.0.0.1:9000)
 *   PACKAGE_TRIBE              — Deployed tribe package ID
 *   PACKAGE_TRUSTLESS_CONTRACTS — Deployed trustless_contracts package ID
 *   DATABASE_URL         — Postgres connection string (default: postgresql://corm:corm@localhost:5432/frontier_corm)
 *   API_PORT             — API server port (default: 3100)
 *   POLL_INTERVAL_MS     — Event poll interval in ms (default: 2000)
 */

import { initDatabase } from "./db/schema.js";
import { initLocationSchema } from "./db/location-schema.js";
import { EventArchiver } from "./archiver/event-archiver.js";
import { CheckpointSubscriber } from "./subscriber/checkpoint-subscriber.js";
import { CleanupWorker } from "./cleanup/cleanup-worker.js";
import { createServer } from "./api/server.js";
import { DEFAULT_CONFIG } from "./types.js";
import { logger } from "./logger.js";

const log = logger.child({ component: "main" });

async function main() {
  const config = DEFAULT_CONFIG;

  log.info("=== Frontier Corm Event Indexer ===");
  log.info(`  Sui RPC:   ${config.suiRpcUrl}`);
  log.info(`  DB:        ${config.databaseUrl.replace(/\/\/.*@/, "//***@")}`);
  log.info(`  API port:  ${config.apiPort}`);
  log.info(`  Poll:      ${config.pollIntervalMs}ms`);

  // Validate package IDs
  const missingPackages = Object.entries(config.packageIds)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missingPackages.length > 0) {
    log.warn(
      `\n  ⚠  Missing package IDs: ${missingPackages.join(", ")}`,
    );
    log.warn(
      "     Set PACKAGE_TRIBE, PACKAGE_TRUSTLESS_CONTRACTS env vars.",
    );
    log.warn(
      "     The indexer will start but won't subscribe to events for missing packages.\n",
    );
  }

  // 1. Init database
  const pool = await initDatabase(config.databaseUrl);
  await initLocationSchema(pool);
  log.info("Database initialised (including location tables).");

  // 2. Init archiver
  const archiver = new EventArchiver(pool);

  // 3. Init subscriber
  const subscriber = new CheckpointSubscriber(config, pool, archiver);

  // 4. Start API server
  const server = createServer(pool, config.apiPort);

  // 5. Start subscriber (only if at least one package ID is configured)
  if (missingPackages.length < Object.keys(config.packageIds).length) {
    subscriber.start();
  } else {
    log.info("No package IDs configured — subscriber not started.");
    log.info("The API server is running; set package IDs and restart to begin indexing.");
  }

  // 6. Start cleanup worker (if enabled and private key is configured)
  let cleanupWorker: CleanupWorker | null = null;
  if (config.cleanup.enabled && config.cleanup.privateKey) {
    cleanupWorker = new CleanupWorker(config, pool);
    cleanupWorker.start();
  } else if (config.cleanup.enabled && !config.cleanup.privateKey) {
    log.warn("CLEANUP_ENABLED=true but no CLEANUP_WORKER_PRIVATE_KEY set — cleanup worker not started.");
  } else {
    log.info("Cleanup worker disabled (set CLEANUP_ENABLED=true to enable).");
  }

  // Graceful shutdown
  const shutdown = () => {
    log.info("\nShutting down...");
    subscriber.stop();
    cleanupWorker?.stop();
    server.close(async () => {
      await pool.end();
      log.info("Goodbye.");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error({ err }, "Fatal error");
  process.exit(1);
});
