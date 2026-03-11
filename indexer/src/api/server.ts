/**
 * Express HTTP server for the Frontier Lattice indexer query API.
 */

import express from "express";
import cors from "cors";
import type Database from "better-sqlite3";
import { createRouter } from "./routes.js";

export function createServer(db: Database.Database, port: number) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Mount API routes under /api/v1
  app.use("/api/v1", createRouter(db));

  // Root health check
  app.get("/", (_req, res) => {
    res.json({
      service: "frontier-lattice-indexer",
      version: "0.1.0",
      api: "/api/v1",
    });
  });

  const server = app.listen(port, () => {
    console.log(`[api] Indexer API listening on http://localhost:${port}`);
    console.log(`[api] Endpoints: GET /api/v1/events, /api/v1/reputation/:tribeId/:characterId, /api/v1/proof/:eventId`);
  });

  return server;
}
