package handlers

import (
	"encoding/json"
	"fmt"
	"html"
	"net/http"

	"github.com/frontier-corm/puzzle-service/internal/corm"
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
			writeSSEAction(w, flusher, action)
		}
	}
}

// writeSSEAction converts a CormAction into an SSE event and writes it.
func writeSSEAction(w http.ResponseWriter, flusher http.Flusher, action corm.CormAction) {
	switch action.ActionType {
	case corm.ActionLog:
		var p corm.LogPayload
		json.Unmarshal(action.Payload, &p)
		data := fmt.Sprintf(`<div class="log-entry"><span class="log-prefix">&gt; </span>%s</div>`, html.EscapeString(p.Text))
		writeSSE(w, "corm-log", data)

	case corm.ActionLogStreamStart:
		var p corm.LogStreamStartPayload
		json.Unmarshal(action.Payload, &p)
		data := fmt.Sprintf(`<span id="entry-%s" class="corm-typing"></span>`, html.EscapeString(p.EntryID))
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
		// State sync doesn't emit SSE; it updates session state.
		// Handled elsewhere.
	}

	flusher.Flush()
}

// writeSSE writes a single SSE event.
func writeSSE(w http.ResponseWriter, event, data string) {
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
}
