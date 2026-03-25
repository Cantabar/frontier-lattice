package server

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/frontier-corm/puzzle-service/internal/corm"
	"github.com/frontier-corm/puzzle-service/internal/puzzle"
)

// GameHandlers groups all handler functions needed by the router.
type GameHandlers struct {
	Health         http.HandlerFunc
	Phase0Page     http.HandlerFunc
	Phase0Interact http.HandlerFunc
	PuzzlePage     http.HandlerFunc
	PuzzleDecrypt  http.HandlerFunc
	PuzzleSubmit   http.HandlerFunc
	Stream         http.HandlerFunc
	Status         http.HandlerFunc
	ContractsPage  http.HandlerFunc
}

// NewRouter builds the HTTP mux with all routes registered.
func NewRouter(gh GameHandlers, store *puzzle.SessionStore, relay *corm.Relay, staticFS embed.FS) http.Handler {
	mux := http.NewServeMux()

	// Static files
	staticSub, _ := fs.Sub(staticFS, "static")
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticSub))))

	// Health
	mux.HandleFunc("GET /health", gh.Health)

	// Corm relay (no session middleware)
	mux.HandleFunc("GET /corm/ws", relay.HandleWS)
	mux.HandleFunc("GET /corm/events", relay.HandleGetEvents)
	mux.HandleFunc("POST /corm/actions", relay.HandlePostActions)

	// Game routes — both root and SSU-prefixed
	registerGameRoutes(mux, gh, "")
	registerGameRoutes(mux, gh, "/ssu/{entity_id}")

	return CORSMiddleware(SessionMiddleware(store)(mux))
}

// registerGameRoutes registers Phase 0, puzzle, stream, status, and contracts routes
// under the given prefix (empty string or "/ssu/{entity_id}").
func registerGameRoutes(mux *http.ServeMux, gh GameHandlers, prefix string) {
	// Phase 0
	mux.HandleFunc("GET "+prefix+"/phase0", gh.Phase0Page)
	mux.HandleFunc("POST "+prefix+"/phase0/interact", gh.Phase0Interact)

	// Puzzle (Phase 1)
	mux.HandleFunc("GET "+prefix+"/puzzle", gh.PuzzlePage)
	mux.HandleFunc("POST "+prefix+"/puzzle/decrypt", gh.PuzzleDecrypt)
	mux.HandleFunc("POST "+prefix+"/puzzle/submit", gh.PuzzleSubmit)

	// SSE stream
	mux.HandleFunc("GET "+prefix+"/stream", gh.Stream)

	// Status
	mux.HandleFunc("GET "+prefix+"/status", gh.Status)

	// Contracts
	mux.HandleFunc("GET "+prefix+"/contracts", gh.ContractsPage)

	// Root redirect — browser entry sends to phase0
	if prefix == "" {
		mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/" {
				http.Redirect(w, r, "/phase0", http.StatusFound)
				return
			}
			http.NotFound(w, r)
		})
	} else {
		mux.HandleFunc("GET "+prefix+"/", func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, prefix+"/phase0", http.StatusFound)
		})
	}
}
