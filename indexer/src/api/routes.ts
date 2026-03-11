/**
 * Query API routes for the Frontier Lattice event indexer.
 *
 * All routes return JSON. Pagination via `limit` and `offset` query params.
 * Events include full checkpoint proof metadata for independent verification.
 */

import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import type { EventTypeName } from "../types.js";
import { EVENT_TYPES } from "../types.js";
import {
  getEvents,
  getEventsByType,
  getEventsByTribe,
  getEventsByCharacter,
  getEventsByPrimaryId,
  getEventById,
  getReputation,
  getTribeLeaderboard,
  getReputationAuditTrail,
  getStats,
} from "../db/queries.js";

export function createRouter(db: Database.Database): Router {
  const router = Router();

  // ---- Health / Stats ----

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  router.get("/stats", (_req: Request, res: Response) => {
    const stats = getStats(db);
    res.json(stats);
  });

  // ---- Events ----

  /**
   * GET /events
   * Query params: limit, offset, order (asc|desc), type (event name filter)
   */
  router.get("/events", (req: Request, res: Response) => {
    const params = parsePagination(req);
    const eventName = req.query.type as string | undefined;

    if (eventName) {
      if (!isValidEventType(eventName)) {
        res.status(400).json({ error: `Unknown event type: ${eventName}` });
        return;
      }
      const events = getEventsByType(db, eventName as EventTypeName, params);
      res.json({ events, ...params });
      return;
    }

    const events = getEvents(db, params);
    res.json({ events, ...params });
  });

  /**
   * GET /events/tribe/:tribeId
   * All events for a tribe. Optional `type` query param to filter.
   */
  router.get("/events/tribe/:tribeId", (req: Request, res: Response) => {
    const tribeId = req.params.tribeId as string;
    const params = parsePagination(req);
    const eventName = req.query.type as string | undefined;

    if (eventName && !isValidEventType(eventName)) {
      res.status(400).json({ error: `Unknown event type: ${eventName}` });
      return;
    }

    const events = getEventsByTribe(db, tribeId, {
      ...params,
      eventName: eventName as EventTypeName | undefined,
    });
    res.json({ events, tribe_id: tribeId, ...params });
  });

  /**
   * GET /events/character/:characterId
   * All events involving a specific character.
   */
  router.get("/events/character/:characterId", (req: Request, res: Response) => {
    const characterId = req.params.characterId as string;
    const params = parsePagination(req);
    const events = getEventsByCharacter(db, characterId, params);
    res.json({ events, character_id: characterId, ...params });
  });

  /**
   * GET /events/object/:objectId
   * All events for a primary object (job, order, tribe, registry, proposal).
   */
  router.get("/events/object/:objectId", (req: Request, res: Response) => {
    const objectId = req.params.objectId as string;
    const params = parsePagination(req);
    const events = getEventsByPrimaryId(db, objectId, params);
    res.json({ events, object_id: objectId, ...params });
  });

  // ---- Reputation ----

  /**
   * GET /reputation/:tribeId/:characterId
   * Current reputation snapshot + full audit trail with checkpoint proofs.
   */
  router.get("/reputation/:tribeId/:characterId", (req: Request, res: Response) => {
    const tribeId = req.params.tribeId as string;
    const characterId = req.params.characterId as string;
    const snapshot = getReputation(db, tribeId, characterId);
    const auditTrail = getReputationAuditTrail(db, tribeId, characterId);

    res.json({
      snapshot: snapshot ?? null,
      audit_trail: auditTrail,
      tribe_id: tribeId,
      character_id: characterId,
    });
  });

  /**
   * GET /reputation/:tribeId/leaderboard
   * Top members by reputation in a tribe.
   */
  router.get("/reputation/:tribeId/leaderboard", (req: Request, res: Response) => {
    const tribeId = req.params.tribeId as string;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const leaderboard = getTribeLeaderboard(db, tribeId, limit);
    res.json({ leaderboard, tribe_id: tribeId });
  });

  // ---- Jobs (convenience: filtered Contract Board events) ----

  /**
   * GET /jobs/:tribeId
   * Job event history for a tribe (created, accepted, completed, etc.)
   */
  router.get("/jobs/:tribeId", (req: Request, res: Response) => {
    const tribeId = req.params.tribeId as string;
    const params = parsePagination(req);
    const jobEventTypes: EventTypeName[] = [
      "JobCreatedEvent", "JobAcceptedEvent", "JobCompletedEvent",
      "JobExpiredEvent", "JobCancelledEvent",
    ];

    // Get all job events for this tribe
    const events = getEventsByTribe(db, tribeId, params);
    const jobEvents = events.filter((e) =>
      jobEventTypes.includes(e.event_name as EventTypeName),
    );
    res.json({ events: jobEvents, tribe_id: tribeId, ...params });
  });

  // ---- Manufacturing (convenience: filtered Forge Planner events) ----

  /**
   * GET /manufacturing/:tribeId
   * Manufacturing event history for a tribe.
   */
  router.get("/manufacturing/:tribeId", (req: Request, res: Response) => {
    const tribeId = req.params.tribeId as string;
    const params = parsePagination(req);
    const mfgEventTypes: EventTypeName[] = [
      "RecipeRegistryCreatedEvent", "RecipeAddedEvent", "RecipeRemovedEvent",
      "OrderCreatedEvent", "OrderFulfilledEvent", "OrderCancelledEvent",
    ];

    const events = getEventsByTribe(db, tribeId, params);
    const mfgEvents = events.filter((e) =>
      mfgEventTypes.includes(e.event_name as EventTypeName),
    );
    res.json({ events: mfgEvents, tribe_id: tribeId, ...params });
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
  router.get("/proof/:eventId", (req: Request, res: Response) => {
    const eventId = Number(req.params.eventId);
    if (isNaN(eventId)) {
      res.status(400).json({ error: "Invalid event ID" });
      return;
    }

    const event = getEventById(db, eventId);
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

  // ---- Event Type Metadata ----

  /**
   * GET /event-types
   * Lists all known event types the indexer tracks.
   */
  router.get("/event-types", (_req: Request, res: Response) => {
    res.json({ event_types: EVENT_TYPES });
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
