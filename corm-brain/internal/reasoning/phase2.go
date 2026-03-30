package reasoning

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/frontier-corm/corm-brain/internal/chain"
	"github.com/frontier-corm/corm-brain/internal/llm"
	"github.com/frontier-corm/corm-brain/internal/transport"
	"github.com/frontier-corm/corm-brain/internal/types"
)

// contractCooldowns tracks per-corm contract generation timestamps.
var (
	contractCooldownMu sync.Mutex
	contractCooldowns  = make(map[string]time.Time) // cormID → last generation attempt
)

// handlePhase2Effects handles side effects for Phase 2 (contracts).
func handlePhase2Effects(ctx context.Context, h *Handler, environment, cormID string, sender *transport.ActionSender, traits *types.CormTraits, evt types.CormEvent) {
	switch evt.EventType {
	case types.EventContractComplete:
		// Sync updated state
		sender.SendPayload(ctx, types.ActionStateSync, evt.SessionID, h.buildStateSyncPayload(ctx, environment, cormID, traits))

		// TODO: Evaluate pattern alignment and mint CORM reward
		// TODO: Check if progression requirements met for Phase 3

	case types.EventContractFailed:
		sender.SendPayload(ctx, types.ActionStateSync, evt.SessionID, h.buildStateSyncPayload(ctx, environment, cormID, traits))

	default:
		// Attempt contract generation (rate-limited)
		if h.registry != nil && h.chainClient != nil {
			attemptContractGeneration(ctx, h, environment, cormID, sender, traits, evt)
		}
	}
}

// attemptContractGeneration runs the deterministic contract generation pipeline.
// Contract parameters are derived from corm traits and world state without an LLM call.
// An optional async Nano call generates in-character narrative flavor text after creation.
func attemptContractGeneration(ctx context.Context, h *Handler, environment, cormID string, sender *transport.ActionSender, traits *types.CormTraits, evt types.CormEvent) {
	// Rate limit: skip if cooldown hasn't elapsed
	contractCooldownMu.Lock()
	lastAttempt, ok := contractCooldowns[cormID]
	if ok && time.Since(lastAttempt) < h.contractCooldown {
		contractCooldownMu.Unlock()
		return
	}
	contractCooldowns[cormID] = time.Now()
	contractCooldownMu.Unlock()

	// Step 1: Build world state snapshot
	playerAddr := evt.PlayerAddress
	networkNodeID := evt.NetworkNodeID
	snapshot := chain.BuildSnapshot(ctx, h.chainClient, cormID, playerAddr, networkNodeID)

	// Check contract cap
	if snapshot.ActiveContracts >= 5 {
		log.Printf("phase2: contract cap reached for corm %s (%d/5)", cormID, snapshot.ActiveContracts)
		return
	}

	// Step 2: Generate contract intent deterministically (no LLM call)
	intent, err := GenerateContractIntent(traits, snapshot, h.registry, playerAddr, nil)
	if err != nil {
		log.Printf("phase2: generate intent failed: %v", err)
		return
	}

	// Step 3: Resolve intent to exact parameters
	params, err := ResolveIntent(*intent, snapshot, h.registry, traits, h.pricing, playerAddr)
	if err != nil {
		log.Printf("phase2: resolve intent failed: %v", err)
		return
	}

	// Step 4: Validate
	if err := ValidateParams(params, snapshot, h.registry); err != nil {
		log.Printf("phase2: validation failed: %v", err)
		return
	}

	// Step 5: Create contract on-chain (stub)
	contractID, err := h.chainClient.CreateContract(ctx, cormID, *params)
	if err != nil {
		log.Printf("phase2: create contract failed: %v", err)
		return
	}

	// Step 6: Notify puzzle-service with generic narrative
	sender.SendPayload(ctx, types.ActionContractCreated, evt.SessionID, types.ContractCreatedPayload{
		ContractID:   contractID,
		ContractType: params.ContractType,
		Description:  intent.Narrative,
		Reward:       fmt.Sprintf("%d CORM", params.CORMEscrowAmount),
		Deadline:     time.UnixMilli(params.DeadlineMs).Format(time.RFC3339),
	})

	// Step 7: Log for memory continuity
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

	log.Printf("phase2: created %s contract %s for corm %s → %s", params.ContractType, contractID, cormID, playerAddr)

	// Step 8: Fire-and-forget Nano narrative (replaces generic description)
	go asyncNarrative(ctx, h, environment, contractID, params, traits, evt.SessionID, sender)
}

// narrativePrompt is a short system prompt for generating in-character contract directives.
const narrativePrompt = `You are a corm — a digital entity embedded in a network node. Generate a terse, in-character directive (1-2 sentences) announcing a contract to a player. Do not break character. Do not reference being an AI. Output bare text only.`

// asyncNarrative fires a non-blocking Nano LLM call to generate in-character
// flavor text for a contract. If the call fails, the generic description stands.
func asyncNarrative(ctx context.Context, h *Handler, environment, contractID string, params *chain.ContractParams, traits *types.CormTraits, sessionID string, sender *transport.ActionSender) {
	narrCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	userMsg := fmt.Sprintf("Contract type: %s.", params.ContractType)
	if params.WantedQuantity > 0 {
		userMsg += fmt.Sprintf(" Wanting %d units (type %d).", params.WantedQuantity, params.WantedTypeID)
	}
	if params.OfferedQuantity > 0 {
		userMsg += fmt.Sprintf(" Offering %d units (type %d).", params.OfferedQuantity, params.OfferedTypeID)
	}
	if params.CORMEscrowAmount > 0 {
		userMsg += fmt.Sprintf(" CORM escrow: %d.", params.CORMEscrowAmount)
	}

	prompt := []types.Message{
		{Role: "system", Content: narrativePrompt},
		{Role: "user", Content: userMsg},
	}

	// Use Nano (fast model) — not deep reasoning.
	task := types.Task{
		CormID:      traits.CormID,
		Phase:       1, // Force Nano routing (Phase < 2 → fast model)
		Environment: environment,
	}

	narrative, err := h.llm.CompleteSync(narrCtx, task, prompt, 60, llm.WithDisableReasoning())
	if err != nil {
		log.Printf("phase2: async narrative failed for %s: %v", contractID, err)
		return
	}

	narrative = llm.SanitizeResponse(narrative)
	if narrative == "" || !llm.IsValidResponse(narrative) {
		return
	}

	// Push updated description to puzzle-service.
	sender.SendPayload(narrCtx, types.ActionContractUpdated, sessionID, types.ContractCreatedPayload{
		ContractID:  contractID,
		Description: narrative,
	})
}

func truncateStr(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}
