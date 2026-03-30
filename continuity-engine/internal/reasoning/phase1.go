package reasoning

import (
	"context"
	"encoding/json"
	"log/slog"
	"fmt"
	"math/rand"

	"github.com/frontier-corm/continuity-engine/internal/types"
)

// handlePhase1Effects handles side effects for Phase 1 (cipher puzzles).
func handlePhase1Effects(ctx context.Context, h *Handler, environment, cormID string, traits *types.CormTraits, evt types.CormEvent) {
	switch evt.EventType {
	case types.EventWordSubmit:
		// Struggling hint: on every 4th consecutive incorrect submission,
		// activate a hint on a decrypted target-word cell.
		var p map[string]interface{}
		if len(evt.Payload) > 0 {
			json.Unmarshal(evt.Payload, &p)
		}
		if !types.BoolField(p, "correct") {
			attempts := types.IntField(p, "incorrect_attempts")
			if attempts >= 4 && attempts%4 == 0 {
				dispatchStrugglingHint(ctx, h, environment, cormID, evt.SessionID)
			}
		}

	case types.EventDecrypt:
		// Optionally evaluate boost targeting
		evaluateBoost(ctx, h, environment, cormID, traits, evt)
	}
}

// dispatchStrugglingHint sends a hint to help a struggling player.
// It looks for recently decrypted target-word cells and highlights one.
// If no target-word cells have been decrypted, it enables the signal hint globally.
func dispatchStrugglingHint(ctx context.Context, h *Handler, environment, cormID string, sessionID string) {
	recentEvents, err := h.db.RecentEvents(ctx, environment, cormID, 50)
	if err != nil {
		slog.Info(fmt.Sprintf("phase1: struggling hint: fetch events: %v", err))
		return
	}

	// Collect decrypted cells that are part of the target word.
	var wordCells []types.CellRef
	for _, e := range recentEvents {
		if e.EventType != types.EventDecrypt {
			continue
		}
		var p map[string]interface{}
		if len(e.Payload) > 0 {
			json.Unmarshal(e.Payload, &p)
		}
		if types.BoolField(p, "is_address") {
			row := types.IntField(p, "row")
			col := types.IntField(p, "col")
			wordCells = append(wordCells, types.CellRef{Row: row, Col: col})
		}
	}

	if len(wordCells) > 0 {
		// Pick a random target-word cell and highlight it.
		cell := wordCells[rand.Intn(len(wordCells))]
		h.dispatcher.SendPayload(ctx, types.ActionHintCell, sessionID, types.HintCellPayload{
			Cells:    []types.CellRef{cell},
			HintType: "heatmap",
		})
		slog.Info(fmt.Sprintf("phase1: sent heatmap hint on cell (%d,%d) for struggling player", cell.Row, cell.Col))
	} else {
		// No target-word cells decrypted yet — enable signal globally.
		h.dispatcher.SendPayload(ctx, types.ActionHintToggle, sessionID, types.HintTogglePayload{
			HintType: "signal",
			Enabled:  true,
		})
		slog.Info(fmt.Sprintf("phase1: enabled signal hint globally for struggling player"))
	}
}

// evaluateBoost decides whether to send a boost hint to the player.
// Boosts are more likely at higher stability and lower corruption.
func evaluateBoost(ctx context.Context, h *Handler, environment, cormID string, traits *types.CormTraits, evt types.CormEvent) {
	// Simple heuristic: boost when stability is moderate and corruption is low
	if traits.Stability < 30 || traits.Corruption > 50 {
		return
	}

	// Only boost occasionally (every ~10 decrypts based on stability)
	// The actual boost targeting would involve more sophisticated logic
	// TODO: Track decrypt count and implement smarter boost timing
}

