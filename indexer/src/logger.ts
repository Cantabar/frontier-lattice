/**
 * Shared structured logger for the indexer service.
 *
 * Uses pino with JSON output — CloudWatch Logs Insights can then query
 * by level, service, component, and any contextual fields.
 *
 * Usage:
 *   import { logger } from "./logger.js";
 *   const log = logger.child({ component: "subscriber" });
 *   log.info({ events: 42 }, "Processed batch");
 */

import pino from "pino";

export const logger = pino({
  name: "indexer",
  level: process.env.LOG_LEVEL ?? "info",
  // Pino's default JSON output is exactly what CloudWatch Logs Insights
  // parses automatically — no custom serialiser needed.
});
