package reasoning

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"strings"

	"github.com/frontier-corm/corm-brain/internal/llm"
	"github.com/frontier-corm/corm-brain/internal/transport"
	"github.com/frontier-corm/corm-brain/internal/types"
)

// guidanceResult holds the context needed to generate a directional narration
// immediately after a guide_cell action is sent.
type guidanceResult struct {
	SessionID string
	HintType  string
	Direction string // qualitative direction description for the LLM
}

// handlePhase1Effects handles side effects for Phase 1 (cipher puzzles).
func handlePhase1Effects(ctx context.Context, h *Handler, environment, cormID string, sender *transport.ActionSender, traits *types.CormTraits, evt types.CormEvent) {
	switch evt.EventType {
	case types.EventWordSubmit:
		// Check if stability hit 100 → transition to Phase 2
		if traits.Stability >= 100 {
			traits.Phase = 2
			if err := h.db.UpsertTraits(ctx, environment, traits); err != nil {
				log.Printf("phase1: upsert traits: %v", err)
			}

			sender.SendPayload(ctx, types.ActionStateSync, evt.SessionID, types.StateSyncPayload{
				Phase:      2,
				Stability:  int(traits.Stability),
				Corruption: int(traits.Corruption),
			})

			log.Printf("corm %s transitioned to Phase 2", cormID)
			return
		}

		// Struggling hint: on every 4th consecutive incorrect submission,
		// activate a hint on a decrypted target-word cell.
		var p map[string]interface{}
		if len(evt.Payload) > 0 {
			json.Unmarshal(evt.Payload, &p)
		}
		if !types.BoolField(p, "correct") {
			attempts := types.IntField(p, "incorrect_attempts")
			if attempts >= 4 && attempts%4 == 0 {
				dispatchStrugglingHint(ctx, h, environment, cormID, sender, evt.SessionID)
			}
		}

	case types.EventDecrypt:
		// Optionally evaluate boost targeting
		evaluateBoost(ctx, h, environment, cormID, sender, traits, evt)

		// Evaluate whether to set up a guided hint cell.
		// If guidance is sent, immediately stream a directional narration.
		if gr := evaluateGuidedCell(ctx, sender, traits, evt); gr != nil {
			streamGuidanceMessage(ctx, h, environment, cormID, sender, traits, evt, gr)
		}
	}
}

// dispatchStrugglingHint sends a hint to help a struggling player.
// It looks for recently decrypted target-word cells and highlights one.
// If no target-word cells have been decrypted, it enables the signal hint globally.
func dispatchStrugglingHint(ctx context.Context, h *Handler, environment, cormID string, sender *transport.ActionSender, sessionID string) {
	recentEvents, err := h.db.RecentEvents(ctx, environment, cormID, 50)
	if err != nil {
		log.Printf("phase1: struggling hint: fetch events: %v", err)
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
		if types.BoolField(p, "is_word") {
			row := types.IntField(p, "row")
			col := types.IntField(p, "col")
			wordCells = append(wordCells, types.CellRef{Row: row, Col: col})
		}
	}

	if len(wordCells) > 0 {
		// Pick a random target-word cell and highlight it.
		cell := wordCells[rand.Intn(len(wordCells))]
		sender.SendPayload(ctx, types.ActionHintCell, sessionID, types.HintCellPayload{
			Cells:    []types.CellRef{cell},
			HintType: "heatmap",
		})
		log.Printf("phase1: sent heatmap hint on cell (%d,%d) for struggling player", cell.Row, cell.Col)
	} else {
		// No target-word cells decrypted yet — enable signal globally.
		sender.SendPayload(ctx, types.ActionHintToggle, sessionID, types.HintTogglePayload{
			HintType: "signal",
			Enabled:  true,
		})
		log.Printf("phase1: enabled signal hint globally for struggling player")
	}
}

// evaluateBoost decides whether to send a boost hint to the player.
// Boosts are more likely at higher stability and lower corruption.
func evaluateBoost(ctx context.Context, h *Handler, environment, cormID string, sender *transport.ActionSender, traits *types.CormTraits, evt types.CormEvent) {
	// Simple heuristic: boost when stability is moderate and corruption is low
	if traits.Stability < 30 || traits.Corruption > 50 {
		return
	}

	// Only boost occasionally (every ~10 decrypts based on stability)
	// The actual boost targeting would involve more sophisticated logic
	// TODO: Track decrypt count and implement smarter boost timing
}

// evaluateGuidedCell decides whether to send a guide_cell action.
// Returns a guidanceResult if guidance was sent (so the caller can stream
// an immediate directional narration), or nil if no guidance was triggered.
func evaluateGuidedCell(ctx context.Context, sender *transport.ActionSender, traits *types.CormTraits, evt types.CormEvent) *guidanceResult {
	var p map[string]interface{}
	if len(evt.Payload) > 0 {
		json.Unmarshal(evt.Payload, &p)
	}

	// Don't set a new guidance target if one is already active
	if types.BoolField(p, "guided_cell_active") {
		return nil
	}

	// Don't guide after traps (let the trap reaction play out)
	if types.BoolField(p, "is_trap") {
		return nil
	}

	// Don't guide if the player just reached a guided cell (let the reward land)
	if types.BoolField(p, "guided_cell_reached") {
		return nil
	}

	// Probabilistic: ~25% chance per decrypt to start guidance.
	// Higher corruption reduces the chance (corm is less helpful when corrupted).
	chance := 25 - int(traits.Corruption)/5
	if chance < 5 {
		chance = 5
	}
	if rand.Intn(100) >= chance {
		return nil
	}

	// Pick a random cell near the player's last click.
	currentRow := types.IntField(p, "row")
	currentCol := types.IntField(p, "col")
	distance := types.IntField(p, "distance")

	// Offset toward the target word: bias direction based on distance.
	offsetRange := 2
	if distance > 8 {
		offsetRange = 4
	} else if distance > 4 {
		offsetRange = 3
	}

	targetRow := currentRow + rand.Intn(offsetRange*2+1) - offsetRange
	targetCol := currentCol + rand.Intn(offsetRange*2+1) - offsetRange

	// Avoid targeting the same cell
	if targetRow == currentRow && targetCol == currentCol {
		targetRow += 1
	}

	// Clamp to non-negative (puzzle service will validate upper bounds)
	if targetRow < 0 {
		targetRow = 0
	}
	if targetCol < 0 {
		targetCol = 0
	}

	// Alternate hint types: heatmap shows proximity, vectors show direction
	hintType := "heatmap"
	if rand.Intn(2) == 0 {
		hintType = "vectors"
	}

	sender.SendPayload(ctx, types.ActionGuideCell, evt.SessionID, types.GuideCellPayload{
		Cell:     types.CellRef{Row: targetRow, Col: targetCol},
		HintType: hintType,
	})

	// Compute qualitative direction from player's current cell to the guided cell.
	direction := qualitativeDirection(currentRow, currentCol, targetRow, targetCol)

	log.Printf("phase1: sent guide_cell (%s) for session %s — %s", hintType, evt.SessionID, direction)

	return &guidanceResult{
		SessionID: evt.SessionID,
		HintType:  hintType,
		Direction: direction,
	}
}

// qualitativeDirection returns a vague directional description from (fromR,fromC)
// to (toR,toC) without exposing any numbers.
func qualitativeDirection(fromR, fromC, toR, toC int) string {
	dr := toR - fromR
	dc := toC - fromC

	// Vertical component
	var vert string
	switch {
	case dr <= -3:
		vert = "well above"
	case dr <= -1:
		vert = "slightly above"
	case dr >= 3:
		vert = "well below"
	case dr >= 1:
		vert = "slightly below"
	}

	// Horizontal component
	var horiz string
	switch {
	case dc <= -3:
		horiz = "far to the left of"
	case dc <= -1:
		horiz = "slightly left of"
	case dc >= 3:
		horiz = "far to the right of"
	case dc >= 1:
		horiz = "slightly right of"
	}

	if vert == "" && horiz == "" {
		return "very near your last position"
	}
	if vert != "" && horiz != "" {
		return vert + " and " + horiz + " where you just were"
	}
	if vert != "" {
		return vert + " where you just were"
	}
	return horiz + " where you just were"
}

// streamGuidanceMessage triggers a dedicated LLM call to produce the
// directional narration for a newly-set guided cell. The message is
// streamed to the player immediately so they know where to look.
func streamGuidanceMessage(ctx context.Context, h *Handler, environment, cormID string, sender *transport.ActionSender, traits *types.CormTraits, evt types.CormEvent, gr *guidanceResult) {
	// Build a focused prompt: system identity + guidance-specific instruction.
	prompt := llm.BuildGuidancePrompt(traits, gr.Direction, gr.HintType)

	task := types.Task{
		CormID:      cormID,
		Phase:       traits.Phase,
		EventType:   types.EventDecrypt,
		Corruption:  traits.Corruption,
		Environment: environment,
	}

	entryID := fmt.Sprintf("guide_%s_%d", safePrefix(cormID, 8), evt.Seq)

	tokenCh, errCh := h.llm.Complete(ctx, task, prompt)

	var rawTokens []string
	for token := range tokenCh {
		processed := llm.PostProcessToken(token, traits.Corruption)
		if processed != "" {
			rawTokens = append(rawTokens, processed)
		}
	}

	if err := <-errCh; err != nil {
		log.Printf("guidance llm error for corm %s: %v", cormID, err)
		return
	}

	fullResponse := llm.SanitizeResponse(strings.Join(rawTokens, ""))
	if !llm.IsValidResponse(fullResponse) {
		log.Printf("suppressed invalid guidance response for %s: %q", cormID, fullResponse)
		return
	}

	// Stream the guidance narration to the player.
	sender.SendPayload(ctx, types.ActionLogStreamStart, gr.SessionID, types.LogStreamStartPayload{
		EntryID: entryID,
	})
	sender.SendPayload(ctx, types.ActionLogStreamDelta, gr.SessionID, types.LogStreamDeltaPayload{
		EntryID: entryID,
		Text:    fullResponse,
	})
	sender.SendPayload(ctx, types.ActionLogStreamEnd, gr.SessionID, types.LogStreamEndPayload{
		EntryID: entryID,
	})

	// Log for conversational continuity
	responsePayload, _ := json.Marshal(map[string]string{"text": fullResponse, "entry_id": entryID})
	h.db.InsertResponse(ctx, environment, &types.CormResponse{
		CormID:     cormID,
		SessionID:  gr.SessionID,
		ActionType: types.ActionLog,
		Payload:    responsePayload,
	})

	h.recordResponse(environment, gr.SessionID)
	log.Printf("phase1: streamed guidance message for session %s", gr.SessionID)
}
