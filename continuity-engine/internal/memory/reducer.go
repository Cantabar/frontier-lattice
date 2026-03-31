// Package memory handles episodic memory consolidation, trait reduction,
// retrieval, and pruning for the corm-brain service.
package memory

import (
	"encoding/json"
	"math"

	"github.com/frontier-corm/continuity-engine/internal/types"
)

// ReduceEvents applies deterministic mutations to corm traits based on new events.
// The LLM never writes traits — only these pure reducers do.
func ReduceEvents(traits *types.CormTraits, events []types.CormEvent) {
	for _, evt := range events {
		switch evt.EventType {
		case types.EventContractComplete:
			reduceContractComplete(traits, evt)
		case types.EventContractFailed:
			reduceContractFailed(traits, evt)
		case types.EventWordSubmit:
			reduceWordSubmit(traits, evt)
		case types.EventPurge:
			reducePurge(traits)
		case types.EventClick, types.EventDecrypt:
			reduceInteraction(traits, evt)
		case types.EventPhaseTransition:
			// Phase 1→2 is driven by unlocking all contracts in the puzzle
			// minigame; the actual phase update comes from the puzzle-service
			// emitting a phase_transition event.
		}
	}

	// Volatility rises with sustained corruption
	if traits.Corruption > 50 {
		traits.Volatility = clamp(traits.Volatility+0.01, 0, 1)
	} else if traits.Volatility > 0 {
		traits.Volatility = clamp(traits.Volatility-0.005, 0, 1)
	}
}

func reduceContractComplete(traits *types.CormTraits, evt types.CormEvent) {
	// Stability bonus for successful contract
	traits.Stability = clamp(traits.Stability+3, 0, 100)

	// Patient corms reward consistency
	traits.Patience = clamp(traits.Patience+0.02, 0, 1)

	// Update player affinity
	if evt.PlayerAddress != "" {
		if traits.PlayerAffinities == nil {
			traits.PlayerAffinities = make(map[string]float64)
		}
		current := traits.PlayerAffinities[evt.PlayerAddress]
		traits.PlayerAffinities[evt.PlayerAddress] = clamp(current+0.1, -1, 1)
	}

	// Parse contract type from payload and update agenda weights + affinity
	var p map[string]interface{}
	if len(evt.Payload) > 0 {
		json.Unmarshal(evt.Payload, &p)
	}

	contractType, _ := p["contract_type"].(string)
	if contractType != "" {
		// Update contract type affinity
		if traits.ContractTypeAffinity == nil {
			traits.ContractTypeAffinity = make(map[string]float64)
		}
		current := traits.ContractTypeAffinity[contractType]
		traits.ContractTypeAffinity[contractType] = clamp(current+0.1, 0, 1)

		// Decay other affinities slightly (relative preference)
		for k, v := range traits.ContractTypeAffinity {
			if k != contractType {
				traits.ContractTypeAffinity[k] = clamp(v-0.02, 0, 1)
			}
		}

		// Update agenda weights based on contract type
		const delta = 0.03
		switch contractType {
		case "coin_for_item", "item_for_coin", "item_for_item":
			// Trade/manufacturing → industry
			traits.AgendaWeights.Industry = clamp(traits.AgendaWeights.Industry+delta, 0, 1)
			traits.AgendaWeights.Expansion = clamp(traits.AgendaWeights.Expansion-delta/2, 0, 1)
			traits.AgendaWeights.Defense = clamp(traits.AgendaWeights.Defense-delta/2, 0, 1)
		case "transport":
			// Transport/delivery → expansion
			traits.AgendaWeights.Expansion = clamp(traits.AgendaWeights.Expansion+delta, 0, 1)
			traits.AgendaWeights.Industry = clamp(traits.AgendaWeights.Industry-delta/2, 0, 1)
			traits.AgendaWeights.Defense = clamp(traits.AgendaWeights.Defense-delta/2, 0, 1)
		}

		// Normalize agenda weights to sum to ~1.0
		normalizeAgendaWeights(&traits.AgendaWeights)
	}
}

func reduceContractFailed(traits *types.CormTraits, evt types.CormEvent) {
	// Corruption penalty for failed/abandoned contract
	traits.Corruption = clamp(traits.Corruption+2, 0, 100)

	// Paranoia rises on failures
	traits.Paranoia = clamp(traits.Paranoia+0.05, 0, 1)

	// Patience decreases
	traits.Patience = clamp(traits.Patience-0.03, 0, 1)

	// Update player affinity negatively
	if evt.PlayerAddress != "" {
		if traits.PlayerAffinities == nil {
			traits.PlayerAffinities = make(map[string]float64)
		}
		current := traits.PlayerAffinities[evt.PlayerAddress]
		traits.PlayerAffinities[evt.PlayerAddress] = clamp(current-0.15, -1, 1)
	}
}

func reduceWordSubmit(traits *types.CormTraits, evt types.CormEvent) {
	// Payload should contain {"correct": true/false}
	// For now, we check if payload contains "correct":true
	payload := string(evt.Payload)
	if contains(payload, `"correct":true`) || contains(payload, `"correct": true`) {
		traits.Stability = clamp(traits.Stability+5, 0, 100)
	} else {
		traits.Corruption = clamp(traits.Corruption+3, 0, 100)
	}
}

func reducePurge(traits *types.CormTraits) {
	// Purge resets corruption at the cost of stability
	corruptionReduced := traits.Corruption * 0.5
	stabilityLost := corruptionReduced * 0.5 // 1:2 ratio

	traits.Corruption = clamp(traits.Corruption-corruptionReduced, 0, 100)
	traits.Stability = clamp(traits.Stability-stabilityLost, 0, 100)

	// Small patience bonus for using purge at low stability (brave/risky)
	if traits.Stability < 30 {
		traits.Patience = clamp(traits.Patience+0.03, 0, 1)
	}
}

func reduceInteraction(traits *types.CormTraits, evt types.CormEvent) {
	// Track player engagement
	if evt.PlayerAddress != "" {
		if traits.PlayerAffinities == nil {
			traits.PlayerAffinities = make(map[string]float64)
		}
		current := traits.PlayerAffinities[evt.PlayerAddress]
		// Tiny affinity boost for continued interaction
		traits.PlayerAffinities[evt.PlayerAddress] = clamp(current+0.01, -1, 1)
	}
}

func clamp(v, min, max float64) float64 {
	return math.Max(min, math.Min(max, v))
}

// normalizeAgendaWeights rescales weights so they sum to approximately 1.0.
func normalizeAgendaWeights(w *types.AgendaWeights) {
	total := w.Industry + w.Expansion + w.Defense
	if total <= 0 {
		w.Industry = 0.33
		w.Expansion = 0.33
		w.Defense = 0.33
		return
	}
	w.Industry /= total
	w.Expansion /= total
	w.Defense /= total
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSimple(s, substr))
}

func containsSimple(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
