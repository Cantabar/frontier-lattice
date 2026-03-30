/**
 * Express HTTP server for the Frontier Corm indexer query API.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import cors from "cors";
import type pg from "pg";
import { createRouter } from "./routes.js";
import { createLocationRouter } from "./location-routes.js";
import { createZkRouter } from "./zk-routes.js";
import { initVerifier } from "../location/zk-verifier.js";
import { logger } from "../logger.js";

const log = logger.child({ component: "api" });
const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(pool: pg.Pool, port: number) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Serve ZK circuit artifacts used by the web client for proof generation.
  app.use(
    "/zk",
    express.static(resolve(__dirname, "../../circuits/artifacts"), {
      maxAge: "7d",
    }),
  );

  // Mount API routes under /api/v1
  app.use("/api/v1", createRouter(pool));

  // Mount Shadow Location Network routes
  app.use("/api/v1/locations", createLocationRouter(pool));

  // Mount ZK proof routes and try to load verification keys
  app.use("/api/v1/locations/proofs", createZkRouter(pool));
  initVerifier();

  // Health check (used by ALB and docker-compose)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/", (_req, res) => {
    res.json({
      service: "frontier-corm-indexer",
      version: "0.1.0",
      api: "/api/v1",
    });
  });

  const server = app.listen(port, () => {
    log.info(`Indexer API listening on http://localhost:${port}`);
    log.info(`Endpoints: GET /api/v1/events, /api/v1/reputation/:tribeId/:characterId, /api/v1/proof/:eventId`);
    log.info(`Shadow Location Network: /api/v1/locations/*`);
    log.info(`ZK Proofs: /api/v1/locations/proofs/*`);
    log.info(`ZK Artifacts: /zk/*`);
  });

  return server;
}
