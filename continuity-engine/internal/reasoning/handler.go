// Package reasoning routes player events to phase-specific logic and
// orchestrates corm responses.
package reasoning

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/frontier-corm/continuity-engine/internal/chain"
	"github.com/frontier-corm/continuity-engine/internal/db"
	"github.com/frontier-corm/continuity-engine/internal/dispatch"
	"github.com/frontier-corm/continuity-engine/internal/memory"
	"github.com/frontier-corm/continuity-engine/internal/types"
)

// NewHandler creates a new reasoning handler.
func NewHandler(database *db.DB, dispatcher *dispatch.Dispatcher, opts ...HandlerConfig) *Handler {
	h := &Handler{
		db:               database,
		dispatcher:       dispatcher,
		contractCooldown: 30 * time.Second, // default
	}
	if len(opts) > 0 {
		cfg := opts[0]
		h.registry = cfg.Registry
		h.recipeRegistry = cfg.RecipeRegistry
		h.chainClient = cfg.ChainClient
		h.pricing = cfg.Pricing
		h.buildRequestBounty = cfg.BuildRequestBounty
		h.ssuTypeID = cfg.SSUTypeID
		if cfg.ContractCooldown > 0 {
			h.contractCooldown = cfg.ContractCooldown
		}
	}
	return h
}

// Handler processes player events and generates corm responses.
type Handler struct {
	db         *db.DB
	dispatcher *dispatch.Dispatcher

	// Phase 2: contract generation
	registry           *chain.Registry
	recipeRegistry     *chain.RecipeRegistry
	chainClient        *chain.Client
	pricing            PricingConfig
	contractCooldown   time.Duration
	buildRequestBounty uint64 // CORM amount escrowed for build_request contracts
	ssuTypeID          uint64 // in-game type ID for Storage Unit structures
}

// HandlerConfig holds optional configuration for the reasoning handler.
type HandlerConfig struct {
	Registry           *chain.Registry
	RecipeRegistry     *chain.RecipeRegistry
	ChainClient        *chain.Client
	Pricing            PricingConfig
	ContractCooldown   time.Duration
	BuildRequestBounty uint64
	SSUTypeID          uint64
}

// ProcessEvent handles a single event for a resolved corm.
// It delegates to ProcessEventBatch with a one-element slice.
func (h *Handler) ProcessEvent(ctx context.Context, environment, cormID string, evt types.CormEvent) error {
	return h.ProcessEventBatch(ctx, environment, cormID, []types.CormEvent{evt})
}

// ProcessEventBatch handles a batch of events for a single resolved corm/session.
// It stores raw events, checks for phase transitions, and runs per-event side
// effects. The LLM is only invoked once per phase transition.
func (h *Handler) ProcessEventBatch(ctx context.Context, environment, cormID string, events []types.CormEvent) error {
	if len(events) == 0 {
		return nil
	}

	// Get traits (once for the batch)
	traits, err := h.db.GetTraits(ctx, environment, cormID)
	if err != nil {
		return fmt.Errorf("get traits: %w", err)
	}
	if traits == nil {
		traits = &types.CormTraits{
			CormID: cormID,
			AgendaWeights: types.AgendaWeights{
				Industry: 0.33, Expansion: 0.33, Defense: 0.33,
			},
			Patience:             0.5,
			PlayerAffinities:     make(map[string]float64),
			ContractTypeAffinity: make(map[string]float64),
		}
		if err := h.db.UpsertTraits(ctx, environment, traits); err != nil {
			return fmt.Errorf("init traits: %w", err)
		}
	}

	sessionID := events[0].SessionID

	// Store all raw events
	for _, evt := range events {
		if _, err := h.db.InsertEvent(ctx, environment, cormID, evt); err != nil {
			slog.Info(fmt.Sprintf("insert event: %v", err))
		}
	}

	// Snapshot stability/corruption before reduction for threshold-based chain sync.
	prevStability := traits.Stability
	prevCorruption := traits.Corruption

	// Reduce traits immediately from the event batch.
	memory.ReduceEvents(traits, events)
	if err := h.db.UpsertTraits(ctx, environment, traits); err != nil {
		slog.Info(fmt.Sprintf("upsert traits after reduction: %v", err))
	}

	// Detect phase transitions before running effects or the LLM.
	transitioned := detectPhaseTransition(events, traits)
	if transitioned {
		if err := h.db.UpsertTraits(ctx, environment, traits); err != nil {
			slog.Info(fmt.Sprintf("upsert traits after transition: %v", err))
		}
		h.dispatcher.SendPayload(ctx, types.ActionStateSync, sessionID, h.buildStateSyncPayload(ctx, environment, cormID, traits))
		slog.Info(fmt.Sprintf("corm %s transitioned to Phase %d", cormID, traits.Phase))

		// Phase transitions always sync to chain.
		h.syncChainState(ctx, environment, cormID, traits)
	} else if shouldSyncMeters(prevStability, prevCorruption, traits.Stability, traits.Corruption) {
		// Sync on significant stability/corruption changes (delta ≥ 5 or threshold crossing).
		h.syncChainState(ctx, environment, cormID, traits)
	}

	// Deliver a transition message (deterministic, no LLM).
	if transitioned {
		h.deliverTransitionResponse(ctx, environment, cormID, sessionID, traits, events)
	}

	// Run phase-specific side effects for each event in order.
	for _, evt := range events {
		h.runPhaseEffects(ctx, environment, cormID, traits, evt)
	}

	return nil
}

// detectPhaseTransition checks whether the event batch triggers a phase
// transition. If so, it mutates traits in place and returns true.
//
// The phase_transition payload must contain {"from": <int>, "to": <int>}.
// The transition is only applied if traits.Phase matches "from", making
// duplicate events idempotent instead of causing over-incrementing.
func detectPhaseTransition(events []types.CormEvent, traits *types.CormTraits) bool {
	// Debug: force-set Phase 2 regardless of current phase.
	for _, e := range events {
		if e.EventType == types.EventDebugForcePhase2 {
			if traits.Phase < 2 {
				traits.Phase = 2
				return true
			}
			return false
		}
	}

	// Explicit phase_transition event from puzzle-service (e.g. 0→1, 1→2).
	for _, e := range events {
		if e.EventType == types.EventPhaseTransition {
			from, to, ok := parseTransitionPayload(e.Payload)
			if !ok {
				// Malformed payload — skip silently.
				continue
			}
			if traits.Phase != from {
				// Stale or duplicate event — the corm has already moved
				// past this transition. Ignore.
				continue
			}
			traits.Phase = to
			if traits.Phase == 1 {
				traits.Stability = 0
			}
			return true
		}
	}

	return false
}

// parseTransitionPayload extracts the "from" and "to" phase values from a
// phase_transition event payload. Handles both int and string-encoded values
// for backward compatibility.
func parseTransitionPayload(payload json.RawMessage) (from, to int, ok bool) {
	if len(payload) == 0 {
		return 0, 0, false
	}
	var p map[string]interface{}
	if err := json.Unmarshal(payload, &p); err != nil {
		return 0, 0, false
	}
	from, fromOK := jsonInt(p["from"])
	to, toOK := jsonInt(p["to"])
	return from, to, fromOK && toOK && to > from
}

// jsonInt extracts an int from a JSON-decoded value that may be float64
// (standard JSON number) or string (legacy payloads).
func jsonInt(v interface{}) (int, bool) {
	switch val := v.(type) {
	case float64:
		return int(val), true
	case string:
		var n int
		if _, err := fmt.Sscanf(val, "%d", &n); err == nil {
			return n, true
		}
	}
	return 0, false
}

// deliverTransitionResponse selects a deterministic in-character message for
// the current phase transition and delivers it to the player.
func (h *Handler) deliverTransitionResponse(ctx context.Context, environment, cormID, sessionID string, traits *types.CormTraits, events []types.CormEvent) {
	queryEvent := types.MostSignificant(events)
	entryID := fmt.Sprintf("corm_%s_%d", safePrefix(cormID, 8), queryEvent.Seq)

	text := selectTransitionMessage(cormID, traits.Phase, traits)
	if text == "" {
		slog.Info(fmt.Sprintf("corm %s: no transition message for phase %d", cormID, traits.Phase))
		return
	}

	h.dispatcher.SendPayload(ctx, types.ActionLogStreamStart, sessionID, types.LogStreamStartPayload{
		EntryID: entryID,
	})
	h.dispatcher.SendPayload(ctx, types.ActionLogStreamDelta, sessionID, types.LogStreamDeltaPayload{
		EntryID: entryID,
		Text:    text,
	})
	h.dispatcher.SendPayload(ctx, types.ActionLogStreamEnd, sessionID, types.LogStreamEndPayload{
		EntryID: entryID,
	})

	responsePayload, _ := json.Marshal(map[string]string{"text": text, "entry_id": entryID})
	h.db.InsertResponse(ctx, environment, &types.CormResponse{
		CormID:     cormID,
		SessionID:  sessionID,
		ActionType: types.ActionLog,
		Payload:    responsePayload,
	})
}

// buildStateSyncPayload constructs a StateSyncPayload with the corm's
// current traits and resolved primary network node.
func (h *Handler) buildStateSyncPayload(ctx context.Context, environment, cormID string, traits *types.CormTraits) types.StateSyncPayload {
	payload := types.StateSyncPayload{
		Phase:      traits.Phase,
		Stability:  int(traits.Stability),
		Corruption: int(traits.Corruption),
	}
	nodeID, err := h.db.ResolveNetworkNodeByCorm(ctx, environment, cormID)
	if err != nil {
		slog.Info(fmt.Sprintf("resolve network node for corm %s: %v", cormID, err))
	} else {
		payload.NetworkNodeID = nodeID
	}
	return payload
}

// syncChainState writes the current phase/stability/corruption to the on-chain
// CormState shared object. Retries up to 2 times on transient failures.
// Postgres remains the authoritative store; on-chain is eventually consistent.
func (h *Handler) syncChainState(ctx context.Context, environment, cormID string, traits *types.CormTraits) {
	if h.chainClient == nil || !h.chainClient.CanUpdateCormState() {
		slog.Info(fmt.Sprintf("syncChainState: skipped for corm %s (chain client not configured)", cormID))
		return
	}

	chainStateID, err := h.db.ResolveChainStateID(ctx, environment, cormID)
	if err != nil {
		slog.Error(fmt.Sprintf("syncChainState: resolve chain state ID for corm %s: %v", cormID, err))
		return
	}
	if chainStateID == "" {
		// Attempt to provision the CormState on-chain if a network node is linked.
		// This covers the race where CreateCormState failed on initial contact
		// and the backfill cooldown suppressed retries before Phase 2 transition.
		nodeID, _ := h.db.ResolveNetworkNodeByCorm(ctx, environment, cormID)
		if nodeID == "" {
			// No-node corm — expected for Phase 0/1 browser sessions.
			slog.Debug(fmt.Sprintf("syncChainState: no chain_state_id for corm %s — on-chain state will not be updated", cormID))
			return
		}
		newID, cErr := h.chainClient.CreateCormState(ctx, nodeID)
		if cErr != nil {
			slog.Error(fmt.Sprintf("syncChainState: provision CormState for corm %s node %s: %v", cormID, nodeID, cErr))
			return
		}
		if newID == "" {
			slog.Error(fmt.Sprintf("syncChainState: provision CormState returned empty ID for corm %s node %s", cormID, nodeID))
			return
		}
		if sErr := h.db.SetChainStateID(ctx, environment, nodeID, newID); sErr != nil {
			slog.Error(fmt.Sprintf("syncChainState: store provisioned chain_state_id for corm %s: %v", cormID, sErr))
			return
		}
		chainStateID = newID
		slog.Info(fmt.Sprintf("syncChainState: provisioned CormState for corm %s node %s → %s", cormID, nodeID, newID))
	}

	// Reject stub IDs (e.g. "corm_0x08a493") that would fail ObjectIdFromHex.
	if !chain.IsValidChainStateID(chainStateID) {
		slog.Error(fmt.Sprintf("syncChainState: invalid chain_state_id %q for corm %s — skipping (likely stub from seed mode)", chainStateID, cormID))
		return
	}

	// Retry with backoff: 100ms, 500ms.
	backoffs := []time.Duration{100 * time.Millisecond, 500 * time.Millisecond}
	var lastErr error
	for attempt := 0; attempt <= len(backoffs); attempt++ {
		if attempt > 0 {
			time.Sleep(backoffs[attempt-1])
		}
		if err := h.chainClient.UpdateCormState(ctx, chainStateID, traits.Phase, traits.Stability, traits.Corruption); err != nil {
			lastErr = err
			slog.Warn(fmt.Sprintf("syncChainState: attempt %d/%d failed for corm %s (chain_state=%s): %v",
				attempt+1, len(backoffs)+1, cormID, chainStateID, err))
			continue
		}
		return // success
	}

	// All retries exhausted.
	slog.Error(fmt.Sprintf("syncChainState: all retries exhausted for corm %s (chain_state=%s, phase=%d): %v",
		cormID, chainStateID, traits.Phase, lastErr))
}

// shouldSyncMeters returns true if stability or corruption changed enough to
// warrant an on-chain write: absolute delta ≥ 5 or a threshold boundary
// crossing (0, 25, 50, 75, 100).
func shouldSyncMeters(prevStab, prevCorr, newStab, newCorr float64) bool {
	if math.Abs(newStab-prevStab) >= 5 || math.Abs(newCorr-prevCorr) >= 5 {
		return true
	}
	return crossesThreshold(prevStab, newStab) || crossesThreshold(prevCorr, newCorr)
}

// crossesThreshold returns true if old and new straddle any of 0, 25, 50, 75, 100.
func crossesThreshold(old, new float64) bool {
	for _, t := range []float64{0, 25, 50, 75, 100} {
		if (old < t && new >= t) || (old >= t && new < t) {
			if old != new { // only if actually changed
				return true
			}
		}
	}
	return false
}

// safePrefix returns the first n characters of s, or s itself if shorter.
func safePrefix(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// runPhaseEffects executes phase-specific side effects (boost, difficulty, etc.).
func (h *Handler) runPhaseEffects(ctx context.Context, environment, cormID string, traits *types.CormTraits, evt types.CormEvent) {
	// Handle phase2_load from any phase — always respond with current state.
	// Also fall through to phase effects so Phase 2 can trigger contract generation.
	if evt.EventType == types.EventPhase2Load {
		h.dispatcher.SendPayload(ctx, types.ActionStateSync, evt.SessionID, h.buildStateSyncPayload(ctx, environment, cormID, traits))
	}

	switch traits.Phase {
	case 0:
		handlePhase0Effects(ctx, h, environment, cormID, traits, evt)
	case 1:
		handlePhase1Effects(ctx, h, environment, cormID, traits, evt)
	case 2:
		handlePhase2Effects(ctx, h, environment, cormID, traits, evt)
	}
}
