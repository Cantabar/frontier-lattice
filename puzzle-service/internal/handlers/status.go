package handlers

import (
	"encoding/json"
	"net/http"
)

// Status serves GET /status — returns session state for meter sync.
func (h *Handlers) Status(w http.ResponseWriter, r *http.Request) {
	sess := getSession(r)
	if sess == nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"session_id":         sess.ID,
		"phase":              sess.Phase,
		"stability":          sess.Stability,
		"corruption":         sess.Corruption,
		"solve_count":        sess.SolveCount,
		"incorrect_attempts": sess.IncorrectAttempts,
		"puzzle_id":          sess.PuzzleID,
	})
}
