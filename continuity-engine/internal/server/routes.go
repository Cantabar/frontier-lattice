package server

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/frontier-corm/continuity-engine/internal/puzzle"
)

// GameHandlers groups all handler functions needed by the router.
type GameHandlers struct {
	Health           http.HandlerFunc
	Phase0Page       http.HandlerFunc
	Phase0Interact   http.HandlerFunc
	PuzzlePage       http.HandlerFunc
	PuzzleDecrypt    http.HandlerFunc
	PuzzleSubmit     http.HandlerFunc
	PuzzleGrid       http.HandlerFunc
	Phase2Transition http.HandlerFunc
	Phase2Page       http.HandlerFunc
	Phase2BindNode   http.HandlerFunc
	Stream           http.HandlerFunc
	Status           http.HandlerFunc
	ContractsPage        http.HandlerFunc
	DebugFillContracts   http.HandlerFunc
	DebugPhase2          http.HandlerFunc
}

// NewRouter builds the HTTP mux with all routes registered.
// secureCookies controls the session cookie's SameSite/Secure flags
// (true for HTTPS production, false for local HTTP dev).
func NewRouter(gh GameHandlers, store *puzzle.SessionStore, staticFS embed.FS, secureCookies bool) http.Handler {
	mux := http.NewServeMux()

	// Static files
	staticSub, _ := fs.Sub(staticFS, "static")
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticSub))))

	// Health
	mux.HandleFunc("GET /health", gh.Health)

	// Game routes — both root and SSU-prefixed
	registerGameRoutes(mux, gh, "")
	registerGameRoutes(mux, gh, "/ssu/{entity_id}")

	return CORSMiddleware(SessionMiddleware(store, secureCookies)(mux))
}

// registerGameRoutes registers Phase 0, puzzle, stream, status, and contracts routes
// under the given prefix (empty string or "/ssu/{entity_id}").
func registerGameRoutes(mux *http.ServeMux, gh GameHandlers, prefix string) {
	// Phase 0
	mux.HandleFunc("GET "+prefix+"/phase0", gh.Phase0Page)
	mux.HandleFunc("POST "+prefix+"/phase0/interact", gh.Phase0Interact)

	// Puzzle (Phase 1)
	mux.HandleFunc("GET "+prefix+"/puzzle", gh.PuzzlePage)
	mux.HandleFunc("GET "+prefix+"/puzzle/grid", gh.PuzzleGrid)
	mux.HandleFunc("POST "+prefix+"/puzzle/decrypt", gh.PuzzleDecrypt)
	mux.HandleFunc("POST "+prefix+"/puzzle/submit", gh.PuzzleSubmit)

	// Phase 2 (contracts)
	mux.HandleFunc("GET "+prefix+"/phase2/transition", gh.Phase2Transition)
	mux.HandleFunc("GET "+prefix+"/phase2", gh.Phase2Page)
	mux.HandleFunc("POST "+prefix+"/phase2/bind-node", gh.Phase2BindNode)

	// SSE stream
	mux.HandleFunc("GET "+prefix+"/stream", gh.Stream)

	// Status
	mux.HandleFunc("GET "+prefix+"/status", gh.Status)

	// Contracts
	mux.HandleFunc("GET "+prefix+"/contracts", gh.ContractsPage)

	// Debug
	mux.HandleFunc("POST "+prefix+"/debug/fill-contracts", gh.DebugFillContracts)
	mux.HandleFunc("POST "+prefix+"/debug/phase2", gh.DebugPhase2)

	// Root redirect — route to the correct phase handler and preserve query params
	// (the ?player= param is needed if the session cookie was lost/blocked).
	if prefix == "" {
		mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/" {
				target := phaseRedirectTarget(r, "")
				if r.URL.RawQuery != "" {
					target += "?" + r.URL.RawQuery
				}
				http.Redirect(w, r, target, http.StatusFound)
				return
			}
			http.NotFound(w, r)
		})
	} else {
		mux.HandleFunc("GET "+prefix+"/", func(w http.ResponseWriter, r *http.Request) {
			target := phaseRedirectTarget(r, prefix)
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusFound)
		})
	}
}

// phaseRedirectTarget returns the appropriate route for the session's current phase.
// Falls back to /phase0 when no session is available (new visitor).
func phaseRedirectTarget(r *http.Request, prefix string) string {
	sess, _ := r.Context().Value(puzzle.SessionContextKey).(*puzzle.Session)
	if sess == nil {
		return prefix + "/phase0"
	}
	switch {
	case sess.Phase >= puzzle.PhaseContracts:
		return prefix + "/phase2"
	case sess.Phase >= puzzle.PhasePuzzle:
		return prefix + "/puzzle"
	default:
		return prefix + "/phase0"
	}
}
