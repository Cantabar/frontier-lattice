package reasoning

import (
	"context"

	"github.com/frontier-corm/corm-brain/internal/transport"
	"github.com/frontier-corm/corm-brain/internal/types"
)

// handlePhase0Effects handles side effects for Phase 0 (dormant/awakening).
// Phase transitions are now detected centrally by detectPhaseTransition in
// handler.go before effects run, so this handler only needs to cover any
// Phase-0-specific non-transition side effects.
func handlePhase0Effects(ctx context.Context, h *Handler, environment, cormID string, sender *transport.ActionSender, traits *types.CormTraits, evt types.CormEvent) {
	// No Phase 0 side effects beyond the transition (handled by handler.go).
}
