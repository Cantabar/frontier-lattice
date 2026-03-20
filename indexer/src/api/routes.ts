/**
 * Query API routes for the Frontier Corm event indexer.
 *
 * All routes return JSON. Pagination via `limit` and `offset` query params.
 * Events include full checkpoint proof metadata for independent verification.
 */

import { Router, type Request, type Response } from "express";
import type pg from "pg";
import type { EventTypeName } from "../types.js";
import { EVENT_TYPES } from "../types.js";
import {
  getEvents,
  getEventsByType,
  getEventsByTribe,
  getEventsByCharacter,
  getEventsByPrimaryId,
  getEventById,
  getStats,
  getCleanupStats,
  getCleanupJobs,
  getPayoutEvents,
  getContractContext,
} from "../db/queries.js";

export function createRouter(pool: pg.Pool): Router {
  const router = Router();

  // ---- Health / Stats ----

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  router.get("/stats", async (_req: Request, res: Response) => {
    const stats = await getStats(pool);
    res.json(stats);
  });

  // ---- Events ----

  /**
   * GET /events
   * Query params: limit, offset, order (asc|desc), type (event name filter)
   */
  router.get("/events", async (req: Request, res: Response) => {
    const params = parsePagination(req);
    const eventName = req.query.type as string | undefined;

    if (eventName) {
      if (!isValidEventType(eventName)) {
        res.status(400).json({ error: `Unknown event type: ${eventName}` });
        return;
      }
      const events = await getEventsByType(pool, eventName as EventTypeName, params);
      res.json({ events: hydrateEvents(events), ...params });
      return;
    }

    const events = await getEvents(pool, params);
    res.json({ events: hydrateEvents(events), ...params });
  });

  /**
   * GET /events/tribe/:tribeId
   * All events for a tribe. Optional `type` query param to filter.
   */
  router.get("/events/tribe/:tribeId", async (req: Request, res: Response) => {
    const tribeId = req.params.tribeId as string;
    const params = parsePagination(req);
    const eventName = req.query.type as string | undefined;

    if (eventName && !isValidEventType(eventName)) {
      res.status(400).json({ error: `Unknown event type: ${eventName}` });
      return;
    }

    const events = await getEventsByTribe(pool, tribeId, {
      ...params,
      eventName: eventName as EventTypeName | undefined,
    });
    res.json({ events: hydrateEvents(events), tribe_id: tribeId, ...params });
  });

  /**
   * GET /events/character/:characterId
   * All events involving a specific character.
   */
  router.get("/events/character/:characterId", async (req: Request, res: Response) => {
    const characterId = req.params.characterId as string;
    const params = parsePagination(req);
    const events = await getEventsByCharacter(pool, characterId, params);
    res.json({ events: hydrateEvents(events), character_id: characterId, ...params });
  });

  /**
   * GET /events/object/:objectId
   * All events for a primary object (contract, order, tribe, registry, proposal).
   */
  router.get("/events/object/:objectId", async (req: Request, res: Response) => {
    const objectId = req.params.objectId as string;
    const params = parsePagination(req);
    const events = await getEventsByPrimaryId(pool, objectId, params);
    res.json({ events: hydrateEvents(events), object_id: objectId, ...params });
  });

  // ---- Proof Verification ----

  /**
   * GET /proof/:eventId
   * Returns the checkpoint inclusion proof for a single archived event.
   * Includes: event data, tx digest, checkpoint seq, checkpoint digest.
   *
   * A verifier can use this to independently confirm the event occurred
   * on-chain by checking the checkpoint against the validator set.
   */
  router.get("/proof/:eventId", async (req: Request, res: Response) => {
    const eventId = Number(req.params.eventId);
    if (isNaN(eventId)) {
      res.status(400).json({ error: "Invalid event ID" });
      return;
    }

    const event = await getEventById(pool, eventId);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    res.json({
      event_id: event.id,
      event_type: event.event_type,
      event_name: event.event_name,
      event_data: JSON.parse(event.event_data),
      proof: {
        tx_digest: event.tx_digest,
        event_seq: event.event_seq,
        checkpoint_seq: event.checkpoint_seq,
        checkpoint_digest: event.checkpoint_digest,
        timestamp_ms: event.timestamp_ms,
        verification_note:
          "To verify: (1) Confirm checkpoint_digest is signed by ≥2/3 validators " +
          "for the epoch. (2) Confirm tx_digest is included in the checkpoint's " +
          "transaction list. (3) Confirm event_data matches the event emitted by " +
          "tx_digest at event_seq.",
      },
    });
  });

  // ---- Multi-Input Orders ----

  /**
   * GET /multi-input-orders
   * List MultiInputContractCreatedEvents (all or filtered by contract_id).
   * Optional query param: contractId — returns all events for a specific contract.
   */
  router.get("/multi-input-orders", async (req: Request, res: Response) => {
    const contractId = req.query.contractId as string | undefined;
    const params = parsePagination(req);

    if (contractId) {
      const events = await getEventsByPrimaryId(pool, contractId, params);
      res.json({ events: hydrateEvents(events), contract_id: contractId, ...params });
      return;
    }

    const events = await getEventsByType(pool, "MultiInputContractCreatedEvent", params);
    res.json({ events: hydrateEvents(events), ...params });
  });

  // ---- Payout Notifications ----

  /**
   * GET /events/payouts/:characterId
   * Fill events where the character received a payout (as filler or poster).
   * Query params: since_id (watermark), limit
   */
  router.get("/events/payouts/:characterId", async (req: Request, res: Response) => {
    const characterId = req.params.characterId as string;
    const sinceId = req.query.since_id ? Number(req.query.since_id) : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    if (sinceId !== null && isNaN(sinceId)) {
      res.status(400).json({ error: "Invalid since_id" });
      return;
    }

    const events = await getPayoutEvents(pool, characterId, sinceId, limit);
    res.json({ events: hydrateEvents(events), character_id: characterId, since_id: sinceId });
  });

  /**
   * GET /events/contract-context/:contractId
   * Returns the creation event for a contract (by primary_id).
   * Used to resolve contract type, SSU IDs, and poster info.
   */
  router.get("/events/contract-context/:contractId", async (req: Request, res: Response) => {
    const contractId = req.params.contractId as string;
    const event = await getContractContext(pool, contractId);

    if (!event) {
      res.status(404).json({ error: "Contract creation event not found" });
      return;
    }

    res.json(hydrateEventData(event));
  });

  // ---- Event Type Metadata ----

  /**
   * GET /event-types
   * Lists all known event types the indexer tracks.
   */
  router.get("/event-types", (_req: Request, res: Response) => {
    res.json({ event_types: EVENT_TYPES });
  });

  // ---- Cleanup ----

  /**
   * GET /cleanup/stats
   * Cleanup worker statistics: job counts by status, total SUI reclaimed.
   */
  router.get("/cleanup/stats", async (_req: Request, res: Response) => {
    const stats = await getCleanupStats(pool);
    res.json(stats);
  });

  /**
   * GET /cleanup/jobs
   * Paginated list of cleanup jobs with rebate details.
   */
  router.get("/cleanup/jobs", async (req: Request, res: Response) => {
    const params = parsePagination(req);
    const jobs = await getCleanupJobs(pool, params);
    res.json({ jobs, ...params });
  });

  return router;
}

// ============================================================
// Helpers
// ============================================================

function parsePagination(req: Request) {
  return {
    limit: Math.min(Number(req.query.limit) || 50, 200),
    offset: Number(req.query.offset) || 0,
    order: (req.query.order === "asc" ? "asc" : "desc") as "asc" | "desc",
  };
}

function isValidEventType(name: string): boolean {
  return (EVENT_TYPES as readonly string[]).includes(name);
}

/**
 * Parse the event_data TEXT column from a JSON string into an object.
 * The DB stores event_data as TEXT; the web frontend expects an object.
 */
function hydrateEventData<T extends { event_data: string }>(event: T): T & { event_data: Record<string, unknown> } {
  return {
    ...event,
    event_data: typeof event.event_data === "string"
      ? JSON.parse(event.event_data)
      : event.event_data,
  };
}

function hydrateEvents<T extends { event_data: string }>(events: T[]) {
  return events.map(hydrateEventData);
}
