package handlers

import (
	"bytes"
	"embed"
	"html/template"
	"log/slog"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/frontier-corm/continuity-engine/internal/dispatch"
	"github.com/frontier-corm/continuity-engine/internal/puzzle"
)

// Handlers holds shared dependencies for all HTTP handlers.
type Handlers struct {
	templates    *template.Template
	sessions     *puzzle.SessionStore
	dispatcher   *dispatch.Dispatcher
	rateLimiter  *RateLimiter
	defaultEnv   string
}

// New creates a new Handlers instance, parsing templates from the embedded FS.
// defaultEnv is the environment name to stamp on emitted events (e.g. "default").
func New(templateFS embed.FS, sessions *puzzle.SessionStore, dispatcher *dispatch.Dispatcher, defaultEnv string) *Handlers {
	tmpl := template.Must(template.ParseFS(templateFS, "internal/templates/*.html"))
	return &Handlers{
		templates:   tmpl,
		sessions:    sessions,
		dispatcher:  dispatcher,
		rateLimiter: NewRateLimiter(2, 4), // 2 req/s, burst 4
		defaultEnv:  defaultEnv,
	}
}

// SessionStore returns the session store (used by middleware/routes).
func (h *Handlers) SessionStore() *puzzle.SessionStore {
	return h.sessions
}

// renderTemplate executes a named template into a buffer and writes the
// complete output to the response only on success.  This prevents partial
// HTML from being flushed when template execution fails.
func (h *Handlers) renderTemplate(w http.ResponseWriter, name string, data any) {
	var buf bytes.Buffer
	if err := h.templates.ExecuteTemplate(&buf, name, data); err != nil {
		slog.Info(fmt.Sprintf("renderTemplate %s: %v", name, err))
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	buf.WriteTo(w)
}

// renderPartial renders an HTMX partial (no layout wrapper) into a buffer.
// On error it returns a 500 instead of sending partial HTML.
func (h *Handlers) renderPartial(w http.ResponseWriter, name string, data any) {
	var buf bytes.Buffer
	if err := h.templates.ExecuteTemplate(&buf, name, data); err != nil {
		slog.Info(fmt.Sprintf("renderPartial %s: %v", name, err))
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	buf.WriteTo(w)
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
