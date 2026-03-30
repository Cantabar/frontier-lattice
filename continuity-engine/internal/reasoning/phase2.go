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

// handlePhase2Effects handles side effects for Phase 2 (contracts).
func handlePhase2Effects(ctx context.Context, h *Handler, environment, cormID string, traits *types.CormTraits, evt types.CormEvent) {
	switch evt.EventType {
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

// attemptContractFill generates contracts until all slots are filled or
// generation fails. The per-corm cooldown gates the entire fill operation.
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

	for activeCount < maxActiveContracts {
		if err := generateOneContract(ctx, h, environment, cormID, traits, evt, snapshot, playerAddr); err != nil {
			slog.Info(fmt.Sprintf("phase2: fill stopped after %d active: %v", activeCount, err))
			break
		}
		activeCount++
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
