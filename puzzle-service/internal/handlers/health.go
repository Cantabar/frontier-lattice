package handlers

import (
	"encoding/json"
	"net/http"
)

// Health serves GET /health.
func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":          "ok",
		"service":         "puzzle-service",
		"corm_ws_clients": h.relay.ConnectedCount(),
	})
}
