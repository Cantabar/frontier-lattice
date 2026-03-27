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
		data := fmt.Sprintf(`<div class="boot-line">%s</div>`, html.EscapeString(p.Text))
		writeSSE(w, "corm-log", data)

	case corm.ActionLogStreamStart:
		var p corm.LogStreamStartPayload
		json.Unmarshal(action.Payload, &p)
		data := fmt.Sprintf(`<span id="entry-%s" class="boot-line-stream corm-typing"></span>`, html.EscapeString(p.EntryID))
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

	case corm.ActionContractCreated:
		var p corm.ContractCreatedPayload
		json.Unmarshal(action.Payload, &p)
		data := fmt.Sprintf(`<div class="contract-card" id="contract-%s">`+
			`<div class="contract-type">%s</div>`+
			`<div class="contract-desc">%s</div>`+
			`<div class="contract-reward">%s</div>`+
			`<a href="%s" class="contract-link" target="_blank">Details</a>`+
			`</div>`,
			html.EscapeString(p.ContractID),
			html.EscapeString(p.ContractType),
			html.EscapeString(p.Description),
			html.EscapeString(p.Reward),
			html.EscapeString(p.DetailURL))
		writeSSE(w, "corm-contract", data)

	case corm.ActionContractUpdated:
		var p corm.ContractUpdatedPayload
		json.Unmarshal(action.Payload, &p)
		if p.Status == "completed" || p.Status == "expired" || p.Status == "cancelled" {
			// Remove the contract card
			data := fmt.Sprintf(`<div id="contract-%s"></div>`, html.EscapeString(p.ContractID))
			writeSSE(w, "corm-contract", data)
		}

	case corm.ActionStateSync:
		var p corm.StateSyncPayload
		json.Unmarshal(action.Payload, &p)
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
	}

	flusher.Flush()
}

// writeSSE writes a single SSE event.
func writeSSE(w http.ResponseWriter, event, data string) {
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
}
