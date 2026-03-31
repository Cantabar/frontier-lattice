package reasoning

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/frontier-corm/continuity-engine/internal/chain"
	"github.com/frontier-corm/continuity-engine/internal/dispatch"
	"github.com/frontier-corm/continuity-engine/internal/types"
)

// contractCooldowns tracks per-corm contract generation timestamps.
var (
	contractCooldownMu sync.Mutex
	contractCooldowns  = make(map[string]time.Time) // cormID → last generation attempt
)

// ClearContractCooldown removes the per-corm cooldown entry so the next
// attemptContractFill call proceeds immediately. Used by debug commands.
func ClearContractCooldown(cormID string) {
	contractCooldownMu.Lock()
	delete(contractCooldowns, cormID)
	contractCooldownMu.Unlock()
}

// handlePhase2Effects handles side effects for Phase 2 (contracts).
func handlePhase2Effects(ctx context.Context, h *Handler, environment, cormID string, traits *types.CormTraits, evt types.CormEvent) {
	switch evt.EventType {
	case types.EventDebugFillContracts:
		// Debug: bypass cooldown and force contract fill.
		ClearContractCooldown(cormID)
		if h.registry != nil && h.chainClient != nil {
			attemptContractFill(ctx, h, environment, cormID, traits, evt)
		}

	case types.EventContractComplete:
		// Sync updated state
		h.dispatcher.SendPayload(ctx, types.ActionStateSync, evt.SessionID, h.buildStateSyncPayload(ctx, environment, cormID, traits))

		// TODO: Evaluate pattern alignment and mint CORM reward
		// TODO: Check if progression requirements met for Phase 3

		// Backfill: generate a replacement contract for the completed slot.
		if h.registry != nil && h.chainClient != nil {
			attemptContractFill(ctx, h, environment, cormID, traits, evt)
		}

	case types.EventContractFailed:
		h.dispatcher.SendPayload(ctx, types.ActionStateSync, evt.SessionID, h.buildStateSyncPayload(ctx, environment, cormID, traits))

		// Backfill: generate a replacement contract for the failed slot.
		if h.registry != nil && h.chainClient != nil {
			attemptContractFill(ctx, h, environment, cormID, traits, evt)
		}

	default:
		// Attempt contract generation (rate-limited)
		if h.registry != nil && h.chainClient != nil {
			attemptContractFill(ctx, h, environment, cormID, traits, evt)
		}
	}
}

// maxActiveContracts is the per-corm contract slot cap.
const maxActiveContracts = 5

// bootstrapCORMAmount is the seed CORM minted when a corm has zero balance
// and needs to create acquisition contracts.
const bootstrapCORMAmount uint64 = 1000

// attemptContractFill generates contracts until all slots are filled or
// generation fails. When standard generation fails (empty inventories), it
// falls back to goal-directed acquisition contracts and sends player feedback.
func attemptContractFill(ctx context.Context, h *Handler, environment, cormID string, traits *types.CormTraits, evt types.CormEvent) {
	// Rate limit: skip if cooldown hasn't elapsed
	contractCooldownMu.Lock()
	lastAttempt, ok := contractCooldowns[cormID]
	if ok && time.Since(lastAttempt) < h.contractCooldown {
		contractCooldownMu.Unlock()
		return
	}
	contractCooldowns[cormID] = time.Now()
	contractCooldownMu.Unlock()

	// Count active contracts from the session to enforce the cap,
	// since WorldSnapshot.ActiveContracts is not yet populated from chain.
	activeCount := countActiveSessionContracts(h.dispatcher, evt.SessionID)

	if activeCount >= maxActiveContracts {
		slog.Info(fmt.Sprintf("phase2: contract cap reached for corm %s (%d/%d)", cormID, activeCount, maxActiveContracts))
		return
	}

	// Build the world state snapshot once for the whole fill pass.
	playerAddr := evt.PlayerAddress
	networkNodeID := evt.NetworkNodeID
	snapshot := chain.BuildSnapshot(ctx, h.chainClient, cormID, playerAddr, networkNodeID)

	// Try standard contract generation first.
	standardFailed := false
	for activeCount < maxActiveContracts {
		if err := generateOneContract(ctx, h, environment, cormID, traits, evt, snapshot, playerAddr); err != nil {
			slog.Info(fmt.Sprintf("phase2: standard fill stopped after %d active: %v", activeCount, err))
			standardFailed = true
			break
		}
		activeCount++
	}

	// If standard generation failed and we have open slots, try goal-directed
	// acquisition contracts.
	if standardFailed && activeCount < maxActiveContracts && h.recipeRegistry != nil {
		// Bootstrap CORM if the corm has zero balance.
		if snapshot.CormCORMBalance == 0 {
			minted, err := h.chainClient.MintBootstrapCORM(ctx, cormID, bootstrapCORMAmount)
			if err != nil {
				slog.Info(fmt.Sprintf("phase2: bootstrap CORM mint failed for %s: %v", cormID, err))
			} else {
				snapshot.CormCORMBalance = minted
				slog.Info(fmt.Sprintf("phase2: minted %d bootstrap CORM for corm %s", minted, cormID))
			}
		}

		slots := maxActiveContracts - activeCount
		goals := DefaultGoals()
		intents := PlanAcquisitionContracts(goals, snapshot, h.recipeRegistry, traits, playerAddr, slots)

		if len(intents) > 0 {
			for _, intent := range intents {
				if activeCount >= maxActiveContracts {
					break
				}
				if err := createContractFromIntent(ctx, h, environment, cormID, traits, evt, snapshot, playerAddr, &intent); err != nil {
					slog.Info(fmt.Sprintf("phase2: goal-directed contract failed: %v", err))
					break
				}
				activeCount++
			}
			// All intents failed — still send feedback.
			if activeCount == 0 {
				sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits)
			}
		} else {
			// Safety net: no goal-directed contracts possible either.
			// Send feedback to the player.
			sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits)
		}
	} else if standardFailed && activeCount == 0 && h.recipeRegistry == nil {
		// No recipe registry available — send generic feedback.
		sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits)
	}
}

// generateOneContract runs the deterministic contract generation pipeline once.
// Returns nil on success or an error if generation should stop.
func generateOneContract(ctx context.Context, h *Handler, environment, cormID string, traits *types.CormTraits, evt types.CormEvent, snapshot chain.WorldSnapshot, playerAddr string) error {
	// Generate contract intent deterministically (no LLM call)
	intent, err := GenerateContractIntent(traits, snapshot, h.registry, playerAddr, nil)
	if err != nil {
		return fmt.Errorf("generate intent: %w", err)
	}

	return createContractFromIntent(ctx, h, environment, cormID, traits, evt, snapshot, playerAddr, intent)
}

// createContractFromIntent resolves, validates, and creates a contract from
// an intent. Shared by both standard and goal-directed generation.
func createContractFromIntent(ctx context.Context, h *Handler, environment, cormID string, traits *types.CormTraits, evt types.CormEvent, snapshot chain.WorldSnapshot, playerAddr string, intent *types.ContractIntent) error {
	// Resolve intent to exact parameters
	params, err := ResolveIntent(*intent, snapshot, h.registry, traits, h.pricing, playerAddr)
	if err != nil {
		return fmt.Errorf("resolve intent: %w", err)
	}

	// Validate
	if err := ValidateParams(params, snapshot, h.registry); err != nil {
		return fmt.Errorf("validation: %w", err)
	}

	// Create contract on-chain (stub)
	contractID, err := h.chainClient.CreateContract(ctx, cormID, *params)
	if err != nil {
		return fmt.Errorf("create contract: %w", err)
	}

	// Notify player session with generic narrative
	h.dispatcher.SendPayload(ctx, types.ActionContractCreated, evt.SessionID, types.ContractCreatedPayload{
		ContractID:   contractID,
		ContractType: params.ContractType,
		Description:  intent.Narrative,
		Reward:       fmt.Sprintf("%d CORM", params.CORMEscrowAmount),
		Deadline:     time.UnixMilli(params.DeadlineMs).Format(time.RFC3339),
	})

	// Log for memory continuity
	responsePayload, _ := json.Marshal(map[string]string{
		"text":          intent.Narrative,
		"contract_id":   contractID,
		"contract_type": params.ContractType,
	})
	h.db.InsertResponse(ctx, environment, &types.CormResponse{
		CormID:     cormID,
		SessionID:  evt.SessionID,
		ActionType: types.ActionContractCreated,
		Payload:    responsePayload,
	})

	slog.Info(fmt.Sprintf("phase2: created %s contract %s for corm %s → %s", params.ContractType, contractID, cormID, playerAddr))
	return nil
}

// sendEmptyStateFeedback delivers an in-character log message to the player
// explaining that no contracts could be generated and what materials to gather.
// It also updates the contracts panel placeholder with the same message.
func sendEmptyStateFeedback(ctx context.Context, h *Handler, cormID, sessionID string, traits *types.CormTraits) {
	goals := DefaultGoals()
	text := EmptyStateMessage(goals, h.recipeRegistry, traits.Corruption)

	entryID := fmt.Sprintf("corm_%s_empty_%d", safePrefix(cormID, 8), time.Now().UnixMilli())

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

	// Update the contracts panel placeholder so the player sees the status
	// even without watching the log stream.
	h.dispatcher.SendPayload(ctx, types.ActionContractStatus, sessionID, types.ContractStatusPayload{
		Status:  "empty",
		Message: text,
	})

	slog.Info(fmt.Sprintf("phase2: sent empty-state feedback for corm %s", cormID))
}

// countActiveSessionContracts queries the dispatcher's session lookup for
// the number of active AI contracts. Returns 0 if the session is not found
// (the fill will proceed and be capped by generation failures instead).
func countActiveSessionContracts(d *dispatch.Dispatcher, sessionID string) int {
	target := d.GetSession(sessionID)
	if target == nil {
		return 0
	}
	return target.ActiveAIContractCount()
}

func truncateStr(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}
