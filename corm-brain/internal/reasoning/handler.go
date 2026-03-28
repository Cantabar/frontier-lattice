// Package reasoning routes player events to phase-specific logic and
// orchestrates LLM inference for corm responses.
package reasoning

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/frontier-corm/corm-brain/internal/db"
	"github.com/frontier-corm/corm-brain/internal/llm"
	"github.com/frontier-corm/corm-brain/internal/memory"
	"github.com/frontier-corm/corm-brain/internal/transport"
	"github.com/frontier-corm/corm-brain/internal/types"
)

// Handler processes player events and generates corm responses.
type Handler struct {
	db        *db.DB
	llm       *llm.Client
	retriever *memory.Retriever
	tm        *transport.Manager

	// Response gating
	responseCooldown   time.Duration
	lowSigAccumulation int

	gateMu   sync.Mutex
	sessions map[string]*sessionGate // keyed by "environment:sessionID"
}

// sessionGate tracks per-session response gating state.
type sessionGate struct {
	lastResponseTime time.Time
	accumulatedCount int // count of low-significance events since last response
}

// highSignificanceThreshold is the minimum event significance that always
// triggers a corm response regardless of cooldown or accumulation.
const highSignificanceThreshold = 50

// NewHandler creates a new reasoning handler.
func NewHandler(database *db.DB, llmClient *llm.Client, retriever *memory.Retriever, tm *transport.Manager, responseCooldown time.Duration, lowSigAccumulation int) *Handler {
	return &Handler{
		db:                 database,
		llm:                llmClient,
		retriever:          retriever,
		tm:                 tm,
		responseCooldown:   responseCooldown,
		lowSigAccumulation: lowSigAccumulation,
		sessions:           make(map[string]*sessionGate),
	}
}

// ProcessEvent handles a single event for a resolved corm.
// It delegates to ProcessEventBatch with a one-element slice.
func (h *Handler) ProcessEvent(ctx context.Context, environment, cormID string, evt types.CormEvent) error {
	return h.ProcessEventBatch(ctx, environment, cormID, []types.CormEvent{evt})
}

// ProcessEventBatch handles a batch of events for a single resolved corm/session.
// It performs one LLM call for the entire batch, then runs per-event side effects.
func (h *Handler) ProcessEventBatch(ctx context.Context, environment, cormID string, events []types.CormEvent) error {
	if len(events) == 0 {
		return nil
	}

	sender := h.tm.SenderFor(environment)
	if sender == nil {
		return fmt.Errorf("no transport for environment %q", environment)
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
			log.Printf("insert event: %v", err)
		}
	}

	// Response gating: decide whether the corm should respond to this batch.
	if !h.shouldRespond(environment, sessionID, events) {
		// Still run phase effects (phase transitions, boosts) even when silent.
		for _, evt := range events {
			h.runPhaseEffects(ctx, environment, cormID, sender, traits, evt)
		}
		return nil
	}

	// Retrieve episodic memories using the most significant event as the query
	queryEvent := types.MostSignificant(events)
	memories, err := h.retriever.Recall(ctx, environment, cormID, queryEvent, 5)
	if err != nil {
		log.Printf("recall memories: %v", err)
	}

	// Get recent events and responses for working memory (once)
	recentEvents, _ := h.db.RecentEvents(ctx, environment, cormID, 15)
	recentResponses, _ := h.db.RecentResponses(ctx, environment, cormID, 5)

	// Build batch-aware prompt and stream one LLM response
	prompt := llm.BuildBatchPrompt(traits, memories, recentEvents, recentResponses, events)

	task := types.Task{
		CormID:      cormID,
		Phase:       traits.Phase,
		EventType:   queryEvent.EventType,
		Corruption:  traits.Corruption,
		Environment: environment,
	}

	// Use the most significant event's seq for the entry ID
	entryID := fmt.Sprintf("corm_%s_%d", safePrefix(cormID, 8), queryEvent.Seq)

	// Stream LLM tokens into a buffer so we can validate the full response
	// before sending anything to the player.
	tokenCh, errCh := h.llm.Complete(ctx, task, prompt)

	var rawTokens []string
	for token := range tokenCh {
		processed := llm.PostProcessToken(token, traits.Corruption)
		if processed != "" {
			rawTokens = append(rawTokens, processed)
		}
	}

	if err := <-errCh; err != nil {
		log.Printf("llm error for corm %s: %v", cormID, err)
	}

	// Sanitize the full response once (regexes work correctly on complete text).
	fullResponse := llm.SanitizeResponse(strings.Join(rawTokens, ""))

	// Suppress responses that are too short to be meaningful (single chars, bare symbols).
	if !llm.IsValidResponse(fullResponse) {
		log.Printf("suppressed invalid corm response for %s: %q", cormID, fullResponse)
		// Still run phase effects even when response is suppressed.
		for _, evt := range events {
			h.runPhaseEffects(ctx, environment, cormID, sender, traits, evt)
		}
		return nil
	}

	// Response is valid — deliver to the player.
	sender.SendPayload(ctx, types.ActionLogStreamStart, sessionID, types.LogStreamStartPayload{
		EntryID: entryID,
	})
	sender.SendPayload(ctx, types.ActionLogStreamDelta, sessionID, types.LogStreamDeltaPayload{
		EntryID: entryID,
		Text:    fullResponse,
	})
	sender.SendPayload(ctx, types.ActionLogStreamEnd, sessionID, types.LogStreamEndPayload{
		EntryID: entryID,
	})

	// Log the response for conversational continuity
	responsePayload, _ := json.Marshal(map[string]string{"text": fullResponse, "entry_id": entryID})
	h.db.InsertResponse(ctx, environment, &types.CormResponse{
		CormID:     cormID,
		SessionID:  sessionID,
		ActionType: types.ActionLog,
		Payload:    responsePayload,
	})

	// Mark that we responded (update gate state)
	h.recordResponse(environment, sessionID)

	// Run phase-specific side effects for each event in order
	for _, evt := range events {
		h.runPhaseEffects(ctx, environment, cormID, sender, traits, evt)
	}

	return nil
}

// shouldRespond decides whether the corm should generate a response for this
// batch of events. High-significance events always trigger a response.
// Low-significance events must pass cooldown and accumulation checks.
func (h *Handler) shouldRespond(environment, sessionID string, events []types.CormEvent) bool {
	maxSig := 0
	for _, e := range events {
		if s := e.Significance(); s > maxSig {
			maxSig = s
		}
	}

	// High-significance events always get a response.
	if maxSig >= highSignificanceThreshold {
		return true
	}

	key := environment + ":" + sessionID

	h.gateMu.Lock()
	defer h.gateMu.Unlock()

	gate, ok := h.sessions[key]
	if !ok {
		gate = &sessionGate{}
		h.sessions[key] = gate
	}

	gate.accumulatedCount += len(events)

	// Check cooldown
	if time.Since(gate.lastResponseTime) < h.responseCooldown {
		return false
	}

	// Check accumulation threshold
	if gate.accumulatedCount < h.lowSigAccumulation {
		return false
	}

	return true
}

// recordResponse marks that a response was sent for this session,
// resetting the accumulation counter.
func (h *Handler) recordResponse(environment, sessionID string) {
	key := environment + ":" + sessionID

	h.gateMu.Lock()
	defer h.gateMu.Unlock()

	gate, ok := h.sessions[key]
	if !ok {
		gate = &sessionGate{}
		h.sessions[key] = gate
	}

	gate.lastResponseTime = time.Now()
	gate.accumulatedCount = 0
}

// safePrefix returns the first n characters of s, or s itself if shorter.
func safePrefix(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// runPhaseEffects executes phase-specific side effects (boost, difficulty, etc.).
func (h *Handler) runPhaseEffects(ctx context.Context, environment, cormID string, sender *transport.ActionSender, traits *types.CormTraits, evt types.CormEvent) {
	switch traits.Phase {
	case 0:
		handlePhase0Effects(ctx, h, environment, cormID, sender, traits, evt)
	case 1:
		handlePhase1Effects(ctx, h, environment, cormID, sender, traits, evt)
	case 2:
		handlePhase2Effects(ctx, h, environment, cormID, sender, traits, evt)
	}
}
