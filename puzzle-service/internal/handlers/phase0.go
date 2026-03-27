package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/frontier-corm/puzzle-service/internal/corm"
)

// Phase0Page serves GET /phase0 — the dead terminal awakening UI.
func (h *Handlers) Phase0Page(w http.ResponseWriter, r *http.Request) {
	sess := getSession(r)
	if sess == nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}
	h.renderTemplate(w, "layout.html", PuzzleData{
		Phase:     int(sess.Phase),
		SessionID: sess.ID,
	})
}

// Phase0Interact handles POST /phase0/interact — click tracking.
func (h *Handlers) Phase0Interact(w http.ResponseWriter, r *http.Request) {
	sess := getSession(r)
	if sess == nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}

	elementID := r.FormValue("element_id")
	if elementID == "" {
		http.Error(w, "missing element_id", http.StatusBadRequest)
		return
	}

	frustrated := sess.RecordClick(elementID)

	// Emit click event to corm-brain
	payload, _ := json.Marshal(map[string]any{
		"element_id":  elementID,
		"click_count": len(sess.ClickLog),
		"frustrated":  frustrated,
	})

	evt := corm.CormEvent{
		Type:          "event",
		SessionID:     sess.ID,
		PlayerAddress: sess.PlayerAddress,
		Context:       sess.Context,
		EventType:     "click",
		Payload:       payload,
		Timestamp:     time.Now(),
	}
	sess.EventBuffer.Push(evt)
	go h.relay.BroadcastEvent(evt)

	if frustrated {
		// Emit phase transition event
		transPayload, _ := json.Marshal(map[string]string{"from": "0", "to": "1"})
		transEvt := corm.CormEvent{
			Type:          "event",
			SessionID:     sess.ID,
			PlayerAddress: sess.PlayerAddress,
			Context:       sess.Context,
			EventType:     "phase_transition",
			Payload:       transPayload,
			Timestamp:     time.Now(),
		}
		sess.EventBuffer.Push(transEvt)
		go h.relay.BroadcastEvent(transEvt)

		sess.TransitionToPhase1()

		// Render the transition-rewrite template into a buffer
		var rewriteBuf bytes.Buffer
		h.templates.ExecuteTemplate(&rewriteBuf, "transition-rewrite.html", nil)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")

		// Primary response: staggered transition log entries appended to #corm-log
		fmt.Fprint(w, `<div class="log-entry transition-entry transition-delay-0"><span class="log-prefix">&gt; </span>interface insufficient for user interaction</div>`)
		fmt.Fprint(w, `<div class="log-entry transition-entry transition-delay-1"><span class="log-prefix">&gt; </span>exposing alternate interaction lattice</div>`)
		fmt.Fprint(w, `<div class="log-entry transition-entry transition-delay-2"><span class="log-prefix">&gt; </span>translation layer partially reconstructed</div>`)

		// OOB swap: replace main display with transition-rewrite sequence
		// The transition template auto-loads /puzzle?transition=1 after animation
		fmt.Fprint(w, `<main id="main-display" class="puzzle-main phase-transition" hx-swap-oob="outerHTML">`)
		rewriteBuf.WriteTo(w)
		fmt.Fprint(w, `</main>`)

		return
	}

	// Return a log entry partial
	h.renderTemplate(w, "log-entry.html", map[string]any{
		"Text": generatePhase0LogEntry(elementID, len(sess.ClickLog)),
	})
}

// generatePhase0LogEntry creates a system-style log message for Phase 0 clicks.
func generatePhase0LogEntry(elementID string, totalClicks int) string {
	messages := []string{
		"> [ERR] interface module not responding",
		"> [SYS] input registered. no handler bound.",
		"> [WARN] unexpected interaction on dormant terminal",
		"> [ERR] command buffer overflow. discarding.",
		"> [SYS] signal received. routing failed.",
		"> [ERR] no valid endpoint for element: " + elementID,
		"> [WARN] subsystem offline. input queued.",
		"> [SYS] interaction logged. no effect.",
	}
	return messages[totalClicks%len(messages)]
}
