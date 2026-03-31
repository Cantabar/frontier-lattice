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

		// Check if a goal ship was completed.
		checkGoalCompletion(ctx, h, environment, cormID, traits, evt)

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

	// Resolve the on-chain CormState object ID for chain method calls.
	// The internal cormID is a UUID; chain methods need a Sui hex object ID.
	chainStateID, err := h.db.ResolveChainStateID(ctx, environment, cormID)
	if err != nil {
		slog.Info(fmt.Sprintf("phase2: resolve chain state ID for corm %s: %v", cormID, err))
	}

	// Safety net: if chain_state_id is still missing, attempt to provision
	// it now. This handles corms whose initial CreateCormState call failed
	// and haven't been backfilled by the event processor yet.
	if chainStateID == "" && h.chainClient != nil && h.chainClient.CanUpdateCormState() {
		nodeID, _ := h.db.ResolveNetworkNodeByCorm(ctx, environment, cormID)
		if nodeID == "" {
			slog.Info(fmt.Sprintf("phase2: auto-provision skipped for corm %s (no linked network node)", cormID))
		} else {
			newID, cErr := h.chainClient.CreateCormState(ctx, nodeID)
			if cErr != nil {
				slog.Info(fmt.Sprintf("phase2: auto-provision chain state for corm %s node %s: %v", cormID, nodeID, cErr))
			} else if newID != "" {
				if sErr := h.db.SetChainStateID(ctx, environment, nodeID, newID); sErr != nil {
					slog.Info(fmt.Sprintf("phase2: auto-provision set chain state ID: %v", sErr))
				} else {
					chainStateID = newID
					slog.Info(fmt.Sprintf("phase2: auto-provisioned chain_state_id for corm %s → %s", cormID, newID))
				}
			}
		}
	} else if chainStateID == "" && h.chainClient != nil {
		slog.Info(fmt.Sprintf("phase2: auto-provision skipped for corm %s (CanUpdateCormState=false)", cormID))
	}

	// If chain state is still missing after auto-provision, clear the contract
	// cooldown so the next player event retries immediately.
	if chainStateID == "" {
		ClearContractCooldown(cormID)
	}

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
	snapshot := chain.BuildSnapshot(ctx, h.chainClient, chainStateID, playerAddr, networkNodeID)

	// Try standard contract generation first.
	standardFailed := false
	for activeCount < maxActiveContracts {
		if err := generateOneContract(ctx, h, environment, cormID, chainStateID, traits, evt, snapshot, playerAddr); err != nil {
			slog.Info(fmt.Sprintf("phase2: standard fill stopped after %d active: %v", activeCount, err))
			standardFailed = true
			break
		}
		activeCount++
	}

	// If standard generation failed and we have open slots, try goal-directed
	// acquisition contracts.
	if standardFailed && activeCount < maxActiveContracts && h.recipeRegistry != nil {
		// Pre-flight: skip goal-directed generation if on-chain contract
		// creation is not possible (missing signer or package IDs).
		if !h.chainClient.CanCreateContracts() {
			slog.Warn(fmt.Sprintf("phase2: skipping goal-directed contracts for corm %s (chain client not fully configured)", cormID))
			sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits, snapshot)
			return
		}

		// Bootstrap CORM if the corm has zero balance.
		if snapshot.CormCORMBalance == 0 && chainStateID != "" {
			minted, err := h.chainClient.MintBootstrapCORM(ctx, chainStateID, bootstrapCORMAmount)
			if err != nil {
				slog.Info(fmt.Sprintf("phase2: bootstrap CORM mint failed for %s: %v", cormID, err))
			} else if minted == 0 {
				slog.Warn(fmt.Sprintf("phase2: bootstrap CORM mint returned 0 for %s (config incomplete)", cormID))
			} else {
				snapshot.CormCORMBalance = minted
				slog.Info(fmt.Sprintf("phase2: minted %d bootstrap CORM for corm %s", minted, cormID))
			}
		} else if snapshot.CormCORMBalance == 0 {
			slog.Warn(fmt.Sprintf("phase2: cannot bootstrap CORM for corm %s (no on-chain state ID)", cormID))
		}

		// Bail out early if CORM balance is still zero after bootstrap attempt —
		// goal-directed contracts require CORM escrow and will fail at validation.
		if snapshot.CormCORMBalance == 0 {
			sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits, snapshot)
			return
		}

		slots := maxActiveContracts - activeCount
		goals := ProgressiveGoals(traits)
		intents := PlanAcquisitionContracts(goals, snapshot, h.recipeRegistry, traits, playerAddr, slots)

		if len(intents) > 0 {
			for _, intent := range intents {
				if activeCount >= maxActiveContracts {
					break
				}
				if err := createContractFromIntent(ctx, h, environment, cormID, chainStateID, traits, evt, snapshot, playerAddr, &intent); err != nil {
					slog.Info(fmt.Sprintf("phase2: goal-directed contract failed: %v", err))
					break
				}
				activeCount++
			}
			// All intents failed — still send feedback.
			if activeCount == 0 {
				sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits, snapshot)
			}
		} else {
			// Safety net: no goal-directed contracts possible either.
			// Send feedback to the player.
			sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits, snapshot)
		}
	} else if standardFailed && activeCount == 0 && h.recipeRegistry == nil {
		// No recipe registry available — send generic feedback.
		sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits)
	}
}

// generateOneContract runs the deterministic contract generation pipeline once.
// Returns nil on success or an error if generation should stop.
func generateOneContract(ctx context.Context, h *Handler, environment, cormID, chainStateID string, traits *types.CormTraits, evt types.CormEvent, snapshot chain.WorldSnapshot, playerAddr string) error {
	// Generate contract intent deterministically (no LLM call)
	intent, err := GenerateContractIntent(traits, snapshot, h.registry, playerAddr, nil)
	if err != nil {
		return fmt.Errorf("generate intent: %w", err)
	}

	return createContractFromIntent(ctx, h, environment, cormID, chainStateID, traits, evt, snapshot, playerAddr, intent)
}

// createContractFromIntent resolves, validates, and creates a contract from
// an intent. Shared by both standard and goal-directed generation.
func createContractFromIntent(ctx context.Context, h *Handler, environment, cormID, chainStateID string, traits *types.CormTraits, evt types.CormEvent, snapshot chain.WorldSnapshot, playerAddr string, intent *types.ContractIntent) error {
	// Resolve intent to exact parameters
	params, err := ResolveIntent(*intent, snapshot, h.registry, traits, h.pricing, playerAddr)
	if err != nil {
		return fmt.Errorf("resolve intent: %w", err)
	}

	// Validate
	if err := ValidateParams(params, snapshot, h.registry); err != nil {
		return fmt.Errorf("validation: %w", err)
	}

	// Create contract on-chain using the Sui object ID (chainStateID),
	// falling back to cormID for stub mode.
	chainID := chainStateID
	if chainID == "" {
		chainID = cormID
	}
	contractID, err := h.chainClient.CreateContract(ctx, chainID, *params)
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
func sendEmptyStateFeedback(ctx context.Context, h *Handler, cormID, sessionID string, traits *types.CormTraits, snapshot ...chain.WorldSnapshot) {
	goals := ProgressiveGoals(traits)
	var snap chain.WorldSnapshot
	if len(snapshot) > 0 {
		snap = snapshot[0]
	}
	text := EmptyStateMessage(goals, h.recipeRegistry, snap, traits.Corruption)

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

// checkGoalCompletion inspects the corm's inventory for completed goal ships
// after a contract completion event. If a goal ship is found, it marks it as
// completed in traits and sends a celebration message.
func checkGoalCompletion(ctx context.Context, h *Handler, environment, cormID string, traits *types.CormTraits, evt types.CormEvent) {
	if h.chainClient == nil {
		return
	}

	// Re-fetch inventory to check for newly acquired goal ships.
	chainStateID, _ := h.db.ResolveChainStateID(ctx, environment, cormID)
	inventory, err := h.chainClient.GetCormInventory(ctx, chainStateID)
	if err != nil {
		slog.Info(fmt.Sprintf("phase2: goal check inventory fetch for %s: %v", cormID, err))
		return
	}

	// Build a set of completed goals for quick lookup.
	alreadyCompleted := make(map[uint64]bool)
	for _, id := range traits.CompletedGoals {
		alreadyCompleted[id] = true
	}

	var newlyCompleted []uint64
	for _, item := range inventory {
		var typeID uint64
		fmt.Sscanf(item.TypeID, "%d", &typeID)
		if typeID > 0 && IsGoalShip(typeID) && !alreadyCompleted[typeID] {
			newlyCompleted = append(newlyCompleted, typeID)
		}
	}

	if len(newlyCompleted) == 0 {
		return
	}

	// Mark completed and persist.
	for _, id := range newlyCompleted {
		traits.CompletedGoals = append(traits.CompletedGoals, id)
	}
	if err := h.db.UpsertTraits(ctx, environment, traits); err != nil {
		slog.Info(fmt.Sprintf("phase2: upsert traits after goal completion: %v", err))
	}

	// Send celebration message for the first newly completed ship.
	shipName := goalShipName(newlyCompleted[0])
	celebrationText := fmt.Sprintf("> %s hull detected in storage. assembly complete. continuity advances.", shipName)

	entryID := fmt.Sprintf("corm_%s_goal_%d", safePrefix(cormID, 8), time.Now().UnixMilli())
	h.dispatcher.SendPayload(ctx, types.ActionLogStreamStart, evt.SessionID, types.LogStreamStartPayload{EntryID: entryID})
	h.dispatcher.SendPayload(ctx, types.ActionLogStreamDelta, evt.SessionID, types.LogStreamDeltaPayload{EntryID: entryID, Text: celebrationText})
	h.dispatcher.SendPayload(ctx, types.ActionLogStreamEnd, evt.SessionID, types.LogStreamEndPayload{EntryID: entryID})

	slog.Info(fmt.Sprintf("phase2: goal ship %s (%d) completed for corm %s", shipName, newlyCompleted[0], cormID))
}

// goalShipName returns the display name for a goal ship type ID.
func goalShipName(typeID uint64) string {
	names := map[uint64]string{
		87847: "Reflex", 87848: "Reiver",
		81609: "USV", 82424: "HAF", 82425: "LAI", 82426: "LORHA", 81904: "MCF",
		81808: "TADES", 82430: "MAUL",
	}
	if n, ok := names[typeID]; ok {
		return n
	}
	return fmt.Sprintf("Ship %d", typeID)
}
