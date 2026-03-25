package handlers

import (
	"encoding/json"
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
	h.renderTemplate(w, "phase0.html", map[string]any{
		"SessionID": sess.ID,
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

		// Return HTMX redirect to puzzle page
		w.Header().Set("HX-Redirect", "/puzzle")
		w.WriteHeader(http.StatusOK)
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
