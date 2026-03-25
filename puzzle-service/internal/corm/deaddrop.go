package corm

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// HandleGetEvents serves GET /corm/events?after=N — pull buffered events.
func (r *Relay) HandleGetEvents(w http.ResponseWriter, req *http.Request) {
	afterStr := req.URL.Query().Get("after")
	afterSeq, _ := strconv.ParseUint(afterStr, 10, 64)

	// Collect events from all sessions
	var allEvents []CormEvent
	for _, target := range r.sessions.All() {
		events := target.GetEventBuffer().After(afterSeq)
		allEvents = append(allEvents, events...)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(allEvents)
}

// HandlePostActions serves POST /corm/actions — push actions (no streaming).
func (r *Relay) HandlePostActions(w http.ResponseWriter, req *http.Request) {
	var action CormAction
	if err := json.NewDecoder(req.Body).Decode(&action); err != nil {
		http.Error(w, "invalid action payload", http.StatusBadRequest)
		return
	}

	r.dispatchAction(action)
	w.WriteHeader(http.StatusAccepted)
}
