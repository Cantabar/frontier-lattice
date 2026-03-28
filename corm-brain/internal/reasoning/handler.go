// Package reasoning routes player events to phase-specific logic and
// orchestrates LLM inference for corm responses.
package reasoning

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

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
}

// NewHandler creates a new reasoning handler.
func NewHandler(database *db.DB, llmClient *llm.Client, retriever *memory.Retriever, tm *transport.Manager) *Handler {
	return &Handler{
		db:        database,
		llm:       llmClient,
		retriever: retriever,
		tm:        tm,
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

	// Store all raw events
	for _, evt := range events {
		if _, err := h.db.InsertEvent(ctx, environment, cormID, evt); err != nil {
			log.Printf("insert event: %v", err)
		}
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
	sessionID := events[0].SessionID
	entryID := fmt.Sprintf("corm_%s_%d", safePrefix(cormID, 8), queryEvent.Seq)

	// Send stream start
	sender.SendPayload(ctx, types.ActionLogStreamStart, sessionID, types.LogStreamStartPayload{
		EntryID: entryID,
	})

	// Stream LLM tokens
	tokenCh, errCh := h.llm.Complete(ctx, task, prompt)

	var fullResponse string
	for token := range tokenCh {
		processed := llm.PostProcessToken(token, traits.Corruption)
		processed = llm.SanitizeResponse(processed)
		if processed == "" {
			continue
		}
		fullResponse += processed

		sender.SendPayload(ctx, types.ActionLogStreamDelta, sessionID, types.LogStreamDeltaPayload{
			EntryID: entryID,
			Text:    processed,
		})
	}

	if err := <-errCh; err != nil {
		log.Printf("llm error for corm %s: %v", cormID, err)
	}

	// Send stream end
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

	// Run phase-specific side effects for each event in order
	for _, evt := range events {
		h.runPhaseEffects(ctx, environment, cormID, sender, traits, evt)
	}

	return nil
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
