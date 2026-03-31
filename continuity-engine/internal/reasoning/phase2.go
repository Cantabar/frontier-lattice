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

		// Track distribution completions and check goal lifecycle.
		checkGoalLifecycle(ctx, h, environment, cormID, traits, evt)

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
// generation fails. The fill strategy depends on the goal lifecycle phase:
//   - acquiring: standard generation (goal-protected) + goal-directed acquisition
//   - distributing: distribution contracts to give materials to the player
//   - verifying: standard generation only (surplus redistribution)
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
	chainStateID, err := h.db.ResolveChainStateID(ctx, environment, cormID)
	if err != nil {
		slog.Info(fmt.Sprintf("phase2: resolve chain state ID for corm %s: %v", cormID, err))
	}

	// Safety net: if chain_state_id is still missing, attempt to provision it now.
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

	if chainStateID == "" {
		ClearContractCooldown(cormID)
	}

	activeCount := countActiveSessionContracts(h.dispatcher, evt.SessionID)
	if activeCount >= maxActiveContracts {
		slog.Info(fmt.Sprintf("phase2: contract cap reached for corm %s (%d/%d)", cormID, activeCount, maxActiveContracts))
		return
	}

	playerAddr := evt.PlayerAddress
	networkNodeID := evt.NetworkNodeID
	snapshot := chain.BuildSnapshot(ctx, h.chainClient, chainStateID, playerAddr, networkNodeID)

	goalPhase := traits.Goals.EffectiveGoalPhase()

	switch goalPhase {
	case types.GoalPhaseDistributing:
		attemptDistributionFill(ctx, h, environment, cormID, chainStateID, traits, evt, snapshot, playerAddr, activeCount)
	case types.GoalPhaseVerifying:
		// Standard generation only — no goal-specific contracts.
		// No reserved materials in verifying phase.
		attemptStandardFill(ctx, h, environment, cormID, chainStateID, traits, evt, snapshot, playerAddr, activeCount, nil)
	default: // GoalPhaseAcquiring
		attemptAcquisitionFill(ctx, h, environment, cormID, chainStateID, traits, evt, snapshot, playerAddr, activeCount)
	}
}

// attemptAcquisitionFill handles the acquiring goal phase:
// 1. Standard generation with goal-reserved inventory protection
// 2. Goal-directed acquisition contracts
// 3. Check if acquisition is now complete → transition to distributing
func attemptAcquisitionFill(ctx context.Context, h *Handler, environment, cormID, chainStateID string, traits *types.CormTraits, evt types.CormEvent, snapshot chain.WorldSnapshot, playerAddr string, activeCount int) {
	goals := ProgressiveGoals(traits)
	var reserved map[uint64]uint64
	if h.recipeRegistry != nil && len(goals) > 0 {
		reserved = ReservedMaterials(goals, h.recipeRegistry, snapshot.CormInventory)
	}

	// Try standard generation with goal protection.
	standardFailed := attemptStandardFill(ctx, h, environment, cormID, chainStateID, traits, evt, snapshot, playerAddr, activeCount, reserved)
	if standardFailed {
		activeCount = countActiveSessionContracts(h.dispatcher, evt.SessionID)
	}

	// If standard failed + open slots, try goal-directed acquisition.
	if standardFailed && activeCount < maxActiveContracts && h.recipeRegistry != nil {
		if !h.chainClient.CanCreateContracts() {
			slog.Warn(fmt.Sprintf("phase2: skipping goal-directed contracts for corm %s (chain client not fully configured)", cormID))
			sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits, snapshot)
			return
		}

		// Bootstrap CORM if needed.
		if snapshot.CormCORMBalance == 0 && chainStateID != "" {
			minted, err := h.chainClient.MintBootstrapCORM(ctx, chainStateID, bootstrapCORMAmount)
			if err != nil {
				slog.Info(fmt.Sprintf("phase2: bootstrap CORM mint failed for %s: %v", cormID, err))
			} else if minted == 0 {
				slog.Warn(fmt.Sprintf("phase2: bootstrap CORM mint returned 0 for %s (config incomplete)", cormID))
			} else {
				snapshot.CormCORMBalance = minted
				slog.Info(fmt.Sprintf("phase2: minted %d bootstrap CORM for corm %s", minted, cormID))
				verifiedBalance, _ := h.chainClient.GetCORMBalance(ctx, chainStateID)
				if verifiedBalance == 0 {
					slog.Info(fmt.Sprintf("phase2: minted CORM not yet visible for %s, deferring contract creation", cormID))
					ClearContractCooldown(cormID)
					sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits, snapshot)
					return
				}
			}
		} else if snapshot.CormCORMBalance == 0 {
			slog.Warn(fmt.Sprintf("phase2: cannot bootstrap CORM for corm %s (no on-chain state ID)", cormID))
		}

		if snapshot.CormCORMBalance == 0 {
			sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits, snapshot)
			return
		}

		slots := maxActiveContracts - activeCount
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
			if activeCount == 0 {
				sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits, snapshot)
			}
		} else {
			sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits, snapshot)
		}
	} else if standardFailed && activeCount == 0 && h.recipeRegistry == nil {
		sendEmptyStateFeedback(ctx, h, cormID, evt.SessionID, traits)
	}

	// Check if the current goal's materials are now fully acquired.
	if h.recipeRegistry != nil && len(goals) > 0 {
		if IsGoalFullyAcquired(goals[0], h.recipeRegistry, snapshot.CormInventory) {
			traits.Goals.GoalPhase = types.GoalPhaseDistributing
			if err := h.db.UpsertTraits(ctx, environment, traits); err != nil {
				slog.Info(fmt.Sprintf("phase2: upsert traits after acquisition complete: %v", err))
			}
			announce(ctx, h, cormID, evt.SessionID, GoalAcquiredAnnouncement(goals[0].TargetName))
			slog.Info(fmt.Sprintf("phase2: corm %s goal %s → distributing", cormID, goals[0].TargetName))
		}
	}
}

// attemptDistributionFill generates distribution contracts (item_for_coin at
// token prices) to give collected goal materials back to the player.
func attemptDistributionFill(ctx context.Context, h *Handler, environment, cormID, chainStateID string, traits *types.CormTraits, evt types.CormEvent, snapshot chain.WorldSnapshot, playerAddr string, activeCount int) {
	goals := ProgressiveGoals(traits)
	if len(goals) == 0 || h.recipeRegistry == nil {
		return
	}

	if !h.chainClient.CanCreateItemContracts() {
		slog.Warn(fmt.Sprintf("phase2: skipping distribution for corm %s (item contracts not configured)", cormID))
		return
	}

	goal := goals[0]
	slots := maxActiveContracts - activeCount
	intents := PlanDistributionContracts(goal, snapshot, h.recipeRegistry, traits, playerAddr, slots)

	if len(intents) == 0 {
		// All materials distributed or no inventory — check if done.
		distributed := traits.Goals.DistributedMaterials
		if distributed == nil {
			distributed = make(map[uint64]uint64)
		}
		if IsFullyDistributed(goal, h.recipeRegistry, distributed) {
			traits.Goals.GoalPhase = types.GoalPhaseVerifying
			if err := h.db.UpsertTraits(ctx, environment, traits); err != nil {
				slog.Info(fmt.Sprintf("phase2: upsert traits after distribution complete: %v", err))
			}
			announce(ctx, h, cormID, evt.SessionID, GoalDistributedAnnouncement(goal.TargetName))
			slog.Info(fmt.Sprintf("phase2: corm %s goal %s → verifying", cormID, goal.TargetName))
		}
		return
	}

	for _, intent := range intents {
		if activeCount >= maxActiveContracts {
			break
		}
		if err := createContractFromIntent(ctx, h, environment, cormID, chainStateID, traits, evt, snapshot, playerAddr, &intent); err != nil {
			slog.Info(fmt.Sprintf("phase2: distribution contract failed: %v", err))
			break
		}
		activeCount++
	}
}

// attemptStandardFill tries standard contract generation with optional
// reserved-material filtering. Returns true if generation failed (no viable contracts).
func attemptStandardFill(ctx context.Context, h *Handler, environment, cormID, chainStateID string, traits *types.CormTraits, evt types.CormEvent, snapshot chain.WorldSnapshot, playerAddr string, activeCount int, reserved map[uint64]uint64) bool {
	failed := false
	for activeCount < maxActiveContracts {
		if err := generateOneContract(ctx, h, environment, cormID, chainStateID, traits, evt, snapshot, playerAddr, reserved); err != nil {
			slog.Info(fmt.Sprintf("phase2: standard fill stopped after %d active: %v", activeCount, err))
			failed = true
			break
		}
		activeCount++
	}
	return failed
}

// generateOneContract runs the deterministic contract generation pipeline once.
// Returns nil on success or an error if generation should stop.
func generateOneContract(ctx context.Context, h *Handler, environment, cormID, chainStateID string, traits *types.CormTraits, evt types.CormEvent, snapshot chain.WorldSnapshot, playerAddr string, reserved map[uint64]uint64) error {
	intent, err := GenerateContractIntent(traits, snapshot, h.registry, playerAddr, nil, reserved)
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

// announce sends a one-shot log message to the player via the standard
// log stream start/delta/end pattern.
func announce(ctx context.Context, h *Handler, cormID, sessionID, text string) {
	entryID := fmt.Sprintf("corm_%s_goal_%d", safePrefix(cormID, 8), time.Now().UnixMilli())
	h.dispatcher.SendPayload(ctx, types.ActionLogStreamStart, sessionID, types.LogStreamStartPayload{EntryID: entryID})
	h.dispatcher.SendPayload(ctx, types.ActionLogStreamDelta, sessionID, types.LogStreamDeltaPayload{EntryID: entryID, Text: text})
	h.dispatcher.SendPayload(ctx, types.ActionLogStreamEnd, sessionID, types.LogStreamEndPayload{EntryID: entryID})
}

func truncateStr(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

// checkGoalLifecycle handles goal state transitions on contract completion events.
// During distribution: tracks which materials have been given out.
// During verification: treats full distribution as goal completion (ship build
// verification via indexer is a future enhancement).
func checkGoalLifecycle(ctx context.Context, h *Handler, environment, cormID string, traits *types.CormTraits, evt types.CormEvent) {
	goals := ProgressiveGoals(traits)
	if len(goals) == 0 || h.recipeRegistry == nil {
		return
	}

	goal := goals[0]
	goalPhase := traits.Goals.EffectiveGoalPhase()

	switch goalPhase {
	case types.GoalPhaseVerifying:
		// Treat entering verification as goal completion for now.
		// Future: check if the goal ship exists on the network via indexer.
		traits.Goals.CompletedGoals = append(traits.Goals.CompletedGoals, goal.TargetTypeID)
		// Keep legacy field in sync.
		traits.CompletedGoals = traits.Goals.CompletedGoals
		// Reset goal state for the next goal.
		traits.Goals.GoalPhase = types.GoalPhaseAcquiring
		traits.Goals.DistributedMaterials = nil
		if err := h.db.UpsertTraits(ctx, environment, traits); err != nil {
			slog.Info(fmt.Sprintf("phase2: upsert traits after goal completion: %v", err))
		}
		announce(ctx, h, cormID, evt.SessionID, GoalCompletedAnnouncement(goal.TargetName))
		slog.Info(fmt.Sprintf("phase2: goal %s completed for corm %s, advancing to next goal", goal.TargetName, cormID))

	case types.GoalPhaseDistributing:
		// Track material distribution from completed contracts.
		// Parse the contract_complete payload to identify distributed items.
		trackDistributedMaterials(traits, evt)
		if err := h.db.UpsertTraits(ctx, environment, traits); err != nil {
			slog.Info(fmt.Sprintf("phase2: upsert traits after distribution tracking: %v", err))
		}

		// Check if all materials are now distributed.
		distributed := traits.Goals.DistributedMaterials
		if distributed == nil {
			distributed = make(map[uint64]uint64)
		}
		if IsFullyDistributed(goal, h.recipeRegistry, distributed) {
			traits.Goals.GoalPhase = types.GoalPhaseVerifying
			if err := h.db.UpsertTraits(ctx, environment, traits); err != nil {
				slog.Info(fmt.Sprintf("phase2: upsert traits after full distribution: %v", err))
			}
			announce(ctx, h, cormID, evt.SessionID, GoalDistributedAnnouncement(goal.TargetName))
			slog.Info(fmt.Sprintf("phase2: corm %s goal %s → verifying", cormID, goal.TargetName))
		}
	}
}

// trackDistributedMaterials parses a contract_complete event payload to
// record which materials were distributed. The payload should contain
// offered_type_id and offered_quantity for item_for_coin contracts.
func trackDistributedMaterials(traits *types.CormTraits, evt types.CormEvent) {
	if len(evt.Payload) == 0 {
		return
	}
	var p map[string]interface{}
	if err := json.Unmarshal(evt.Payload, &p); err != nil {
		return
	}

	// Check if this was a distribution contract (item_for_coin).
	contractType, _ := p["contract_type"].(string)
	if contractType != types.ContractItemForCoin {
		return
	}

	typeID := uint64(types.IntField(p, "offered_type_id"))
	qty := uint64(types.IntField(p, "offered_quantity"))
	if typeID == 0 || qty == 0 {
		return
	}

	if traits.Goals.DistributedMaterials == nil {
		traits.Goals.DistributedMaterials = make(map[uint64]uint64)
	}
	traits.Goals.DistributedMaterials[typeID] += qty
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
