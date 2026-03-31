package handlers

import (
	"fmt"
	"net/http"

	"github.com/frontier-corm/continuity-engine/internal/puzzle"
)

// DebugFillContracts handles POST /debug/fill-contracts — emits a
// debug_fill_contracts event so the reasoning engine force-generates
// contracts up to the 5-slot cap (bypassing the per-corm cooldown).
func (h *Handlers) DebugFillContracts(w http.ResponseWriter, r *http.Request) {
	sess := getSession(r)
	if sess == nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}

	// Must be in Phase 2 for contract generation to make sense.
	if sess.Phase < puzzle.PhaseContracts {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, `<div class="boot-line boot-line--warn">[DEBUG] session not in Phase 2 — use 'phase2' command first</div>`)
		return
	}

	active := sess.ActiveAIContractCount()
	if active >= 5 {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<div class="boot-line boot-line--warn">[DEBUG] contract cap already reached (%d/5)</div>`, active)
		return
	}

	evt := h.buildEvent(sess, "debug_fill_contracts", nil)
	sess.EventBuffer.Push(evt)
	go h.dispatcher.EmitEvent(evt)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<div class="boot-line boot-line--sys">[DEBUG] requesting contract fill (%d/5 active, filling %d slots)...</div>`, active, 5-active)
}

// DebugPhase2 handles POST /debug/phase2 — forces the session into Phase 2
// and redirects to the contracts dashboard.
func (h *Handlers) DebugPhase2(w http.ResponseWriter, r *http.Request) {
	sess := getSession(r)
	if sess == nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}

	if sess.Phase < puzzle.PhaseContracts {
		sess.TransitionToPhase2()
	}

	w.Header().Set("HX-Redirect", "/phase2")
	w.WriteHeader(http.StatusNoContent)
}
