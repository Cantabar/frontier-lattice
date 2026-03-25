package handlers

import "net/http"

// ContractsPage serves GET /contracts — renders the contracts list panel.
func (h *Handlers) ContractsPage(w http.ResponseWriter, r *http.Request) {
	sess := getSession(r)
	if sess == nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}

	// Contracts are populated dynamically via SSE from corm-brain actions.
	// This endpoint renders the empty container that SSE will populate.
	h.renderTemplate(w, "contracts.html", map[string]any{
		"SessionID": sess.ID,
	})
}
