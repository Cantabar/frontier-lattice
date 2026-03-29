package handlers

import (
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"strings"

	"github.com/frontier-corm/puzzle-service/internal/corm"
	"github.com/frontier-corm/puzzle-service/internal/puzzle"
)

// Stream serves GET /stream — SSE endpoint per player session.
func (h *Handlers) Stream(w http.ResponseWriter, r *http.Request) {
	sess := getSession(r)
	if sess == nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ctx := r.Context()

	for {
		select {
		case <-ctx.Done():
			return
		case action := <-sess.ActionChan:
			writeSSEAction(w, flusher, action, sess, h)
		}
	}
}

// writeSSEAction converts a CormAction into an SSE event and writes it.
func writeSSEAction(w http.ResponseWriter, flusher http.Flusher, action corm.CormAction, sess *puzzle.Session, h *Handlers) {
	switch action.ActionType {
	case corm.ActionLog:
		var p corm.LogPayload
		json.Unmarshal(action.Payload, &p)
		data := fmt.Sprintf(`<div class="boot-line boot-line--corm">%s</div>`, html.EscapeString(p.Text))
		writeSSE(w, "corm-log", data)

	case corm.ActionLogStreamStart:
		var p corm.LogStreamStartPayload
		json.Unmarshal(action.Payload, &p)
		data := fmt.Sprintf(`<span id="entry-%s" class="boot-line-stream boot-line--corm corm-typing"></span>`, html.EscapeString(p.EntryID))
		writeSSE(w, "corm-log-start", data)

	case corm.ActionLogStreamDelta:
		var p corm.LogStreamDeltaPayload
		json.Unmarshal(action.Payload, &p)
		// HTMX will append this inside the target span
		writeSSE(w, "corm-log-delta", html.EscapeString(p.Text))

	case corm.ActionLogStreamEnd:
		var p corm.LogStreamEndPayload
		json.Unmarshal(action.Payload, &p)
		// Signal to remove typing class
		data := fmt.Sprintf(`<span id="entry-%s" class="corm-complete"></span>`, html.EscapeString(p.EntryID))
		writeSSE(w, "corm-log-end", data)

	case corm.ActionBoost:
		var p corm.BoostPayload
		json.Unmarshal(action.Payload, &p)
		// Re-render each boosted cell with effect class
		for _, cell := range p.Cells {
			data := fmt.Sprintf(`<button id="cell-%d-%d" class="cell cell--revealed cell--boost-%s" `+
				`hx-post="/puzzle/decrypt" hx-vals='{"row":%d,"col":%d}' `+
				`hx-target="#cell-%d-%d" hx-swap="outerHTML">?</button>`,
				cell.Row, cell.Col, html.EscapeString(p.Effect),
				cell.Row, cell.Col, cell.Row, cell.Col)
			writeSSE(w, "corm-boost", data)
		}

	case corm.ActionHintToggle:
		var p corm.HintTogglePayload
		json.Unmarshal(action.Payload, &p)
		// Update session hint state
		sess.SetHint(p.HintType, p.Enabled)
		// Trigger full grid re-render via HTMX
		data := `<div id="grid-refresh" hx-get="/puzzle/grid" hx-trigger="load" hx-target=".grid-container" hx-swap="innerHTML"></div>`
		writeSSE(w, "corm-hint", data)

	case corm.ActionHintCell:
		var p corm.HintCellPayload
		json.Unmarshal(action.Payload, &p)
		// Add per-cell hints and re-render each targeted cell
		for _, cellRef := range p.Cells {
			sess.AddCellHint(cellRef.Row, cellRef.Col, p.HintType)
			cellData := buildCellData(sess, cellRef.Row, cellRef.Col)
			var buf strings.Builder
			h.templates.ExecuteTemplate(&buf, "cell.html", cellData)
			writeSSE(w, "corm-hint-cell", buf.String())
		}

	case corm.ActionGuideCell:
		var p corm.GuideCellPayload
		json.Unmarshal(action.Payload, &p)
		// Store the guided cell target silently — no SSE to the browser.
		// The AI communicates guidance via its log stream; the hint is
		// revealed only when the player clicks the target cell.
		sess.SetGuidedCell(p.Cell.Row, p.Cell.Col, p.HintType)

	case corm.ActionContractCreated:
		var p corm.ContractCreatedPayload
		json.Unmarshal(action.Payload, &p)
		// Store the AI contract on the session
		sess.AddAIContract(puzzle.AIContract{
			ID:           p.ContractID,
			ContractType: p.ContractType,
			Description:  p.Description,
			Reward:       p.Reward,
			Deadline:     p.Deadline,
			DetailURL:    p.DetailURL,
			Status:       "active",
		})
		// Remove the empty-state placeholder if present
		writeSSE(w, "corm-contract-clear", `<div id="phase2-empty" hx-swap-oob="delete"></div>`)
		// Render the Phase 2 card into the contracts panel
		var buf strings.Builder
		h.templates.ExecuteTemplate(&buf, "phase2-card.html", puzzle.AIContract{
			ID:           p.ContractID,
			ContractType: p.ContractType,
			Description:  p.Description,
			Reward:       p.Reward,
			Deadline:     p.Deadline,
			DetailURL:    p.DetailURL,
			Status:       "active",
		})
		writeSSE(w, "corm-contract", buf.String())

	case corm.ActionContractUpdated:
		var p corm.ContractUpdatedPayload
		json.Unmarshal(action.Payload, &p)
		// Update status on the session
		sess.UpdateAIContract(p.ContractID, p.Status)
		if p.Status == "completed" {
			// Re-render card with completed state
			data := fmt.Sprintf(`<div class="phase2-card phase2-card--completed" id="ai-contract-%s" hx-swap-oob="outerHTML:#ai-contract-%s">`+
				`<div class="phase2-card-header">`+
				`<span class="phase2-card-status phase2-card-status--completed">✓ COMPLETE</span>`+
				`</div></div>`,
				html.EscapeString(p.ContractID), html.EscapeString(p.ContractID))
			writeSSE(w, "corm-contract", data)
		} else if p.Status == "expired" || p.Status == "cancelled" {
			// Remove the contract card
			data := fmt.Sprintf(`<div id="ai-contract-%s" hx-swap-oob="delete"></div>`, html.EscapeString(p.ContractID))
			writeSSE(w, "corm-contract", data)
		}

	case corm.ActionStateSync:
		var p corm.StateSyncPayload
		json.Unmarshal(action.Payload, &p)
		prevPhase := sess.Phase
		sess.Phase = puzzle.Phase(p.Phase)
		sess.Stability = p.Stability
		sess.Corruption = p.Corruption
		// Reveal meters via OOB swap when values become non-zero
		if p.Stability > 0 || p.Corruption > 0 {
			var buf strings.Builder
			h.templates.ExecuteTemplate(&buf, "meters.html", map[string]any{
				"Stability":    p.Stability,
				"Corruption":   p.Corruption,
				"MetersHidden": false,
			})
			writeSSE(w, "corm-meters", buf.String())
		}
		// Trigger Phase 2 transition if corm-brain advanced the phase
		if prevPhase < puzzle.PhaseContracts && puzzle.Phase(p.Phase) >= puzzle.PhaseContracts {
			var buf strings.Builder
			h.templates.ExecuteTemplate(&buf, "transition-phase2.html", nil)
			writeSSE(w, "corm-phase-transition", buf.String())
		}
	}

	flusher.Flush()
}

// writeSSE writes a single SSE event.
func writeSSE(w http.ResponseWriter, event, data string) {
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
}
