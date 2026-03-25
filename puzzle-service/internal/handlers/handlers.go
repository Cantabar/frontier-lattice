package handlers

import (
	"embed"
	"html/template"
	"net/http"
	"sync"
	"time"

	"github.com/frontier-corm/puzzle-service/internal/corm"
	"github.com/frontier-corm/puzzle-service/internal/puzzle"
	"github.com/frontier-corm/puzzle-service/internal/words"
)

// Handlers holds shared dependencies for all HTTP handlers.
type Handlers struct {
	templates    *template.Template
	archive      *words.Archive
	sessions     *puzzle.SessionStore
	relay        *corm.Relay
	rateLimiter  *RateLimiter
}

// New creates a new Handlers instance, parsing templates from the embedded FS.
func New(templateFS embed.FS, archive *words.Archive, sessions *puzzle.SessionStore, relay *corm.Relay) *Handlers {
	tmpl := template.Must(template.ParseFS(templateFS, "internal/templates/*.html"))
	return &Handlers{
		templates:   tmpl,
		archive:     archive,
		sessions:    sessions,
		relay:       relay,
		rateLimiter: NewRateLimiter(2, 4), // 2 req/s, burst 4
	}
}

// SessionStore returns the session store (used by middleware/routes).
func (h *Handlers) SessionStore() *puzzle.SessionStore {
	return h.sessions
}

// renderTemplate executes a named template and writes to the response.
func (h *Handlers) renderTemplate(w http.ResponseWriter, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := h.templates.ExecuteTemplate(w, name, data); err != nil {
		http.Error(w, "template error", http.StatusInternalServerError)
	}
}

// getSession extracts the session from the request context.
func getSession(r *http.Request) *puzzle.Session {
	s, _ := r.Context().Value(puzzle.SessionContextKey).(*puzzle.Session)
	return s
}

// --- Rate Limiter (local to handlers) ---

// RateLimiter provides per-session rate limiting for decrypt requests.
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*tokenBucket
	rate    float64
	burst   int
}

type tokenBucket struct {
	tokens   float64
	lastTime time.Time
}

// NewRateLimiter creates a rate limiter with the given rate (req/sec) and burst.
func NewRateLimiter(rate float64, burst int) *RateLimiter {
	return &RateLimiter{
		buckets: make(map[string]*tokenBucket),
		rate:    rate,
		burst:   burst,
	}
}

// Allow returns true if the request is allowed for the given session ID.
func (rl *RateLimiter) Allow(sessionID string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[sessionID]
	if !ok {
		b = &tokenBucket{tokens: float64(rl.burst), lastTime: time.Now()}
		rl.buckets[sessionID] = b
	}

	now := time.Now()
	elapsed := now.Sub(b.lastTime).Seconds()
	b.tokens += elapsed * rl.rate
	if b.tokens > float64(rl.burst) {
		b.tokens = float64(rl.burst)
	}
	b.lastTime = now

	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}
