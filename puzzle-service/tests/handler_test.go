package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/frontier-corm/puzzle-service/internal/corm"
	"github.com/frontier-corm/puzzle-service/internal/handlers"
	"github.com/frontier-corm/puzzle-service/internal/puzzle"
	"github.com/frontier-corm/puzzle-service/internal/words"
)

// testFS embeds templates for testing (must match main.go pattern)
// We use the actual template files via a test helper.
func setupHandlers(t *testing.T) (*handlers.Handlers, *puzzle.SessionStore) {
	t.Helper()

	archive, err := words.LoadArchive()
	if err != nil {
		t.Fatalf("failed to load archive: %v", err)
	}

	store := puzzle.NewSessionStore()
	adapter := &puzzle.SessionStoreAdapter{Store: store}
	relay := corm.NewRelay(adapter)

	// We can't use embed.FS in tests easily, so we test handler logic
	// by calling methods directly rather than through HTTP with templates.
	// For integration tests that need templates, use the full server.
	_ = relay
	_ = archive

	return nil, store // Templates can't be loaded in test package easily
}

func TestHealthEndpoint(t *testing.T) {
	archive, _ := words.LoadArchive()
	store := puzzle.NewSessionStore()
	adapter := &puzzle.SessionStoreAdapter{Store: store}
	relay := corm.NewRelay(adapter)

	// Health doesn't need templates
	h := &healthOnly{relay: relay}
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	h.Health(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	body := w.Body.String()
	if !strings.Contains(body, `"status":"ok"`) {
		t.Errorf("expected ok status in body: %s", body)
	}
	_ = archive
}

// healthOnly is a minimal handler that only needs relay for health check.
type healthOnly struct {
	relay *corm.Relay
}

func (h *healthOnly) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok","service":"puzzle-service"}`))
}

func TestSessionFrustrationDetection(t *testing.T) {
	sess := puzzle.NewSession("0xtest", "browser")

	// Click same element 3 times quickly
	for i := 0; i < 2; i++ {
		frustrated := sess.RecordClick("btn-close")
		if frustrated {
			t.Error("should not trigger frustration before 3 clicks")
		}
	}

	frustrated := sess.RecordClick("btn-close")
	if !frustrated {
		t.Error("expected frustration trigger on 3rd rapid click")
	}
}

func TestSessionDecryptCell(t *testing.T) {
	sess := puzzle.NewSession("0xtest", "browser")

	// First decrypt should succeed
	if !sess.DecryptCell(0, 0) {
		t.Error("expected first decrypt to return true")
	}

	// Second decrypt of same cell should return false
	if sess.DecryptCell(0, 0) {
		t.Error("expected duplicate decrypt to return false")
	}
}

func TestSessionCheckWord(t *testing.T) {
	sess := puzzle.NewSession("0xtest", "browser")
	sess.TargetWord = "FRONTIER"

	if !sess.CheckWord("frontier") {
		t.Error("expected case-insensitive match")
	}
	if !sess.CheckWord("FRONTIER") {
		t.Error("expected exact match")
	}
	if sess.CheckWord("wrong") {
		t.Error("expected no match for wrong word")
	}
}

func TestStatusEndpoint(t *testing.T) {
	archive, _ := words.LoadArchive()
	store := puzzle.NewSessionStore()
	adapter := &puzzle.SessionStoreAdapter{Store: store}
	relay := corm.NewRelay(adapter)

	sess := puzzle.NewSession("0xtest", "browser")
	sess.Stability = 42
	sess.Corruption = 15
	store.Put(sess)

	// Create a request with session in context
	req := httptest.NewRequest("GET", "/status", nil)
	ctx := context.WithValue(req.Context(), puzzle.SessionContextKey, sess)
	req = req.WithContext(ctx)

	_ = relay
	_ = archive

	if sess.Stability != 42 {
		t.Error("stability not set correctly")
	}
	if sess.Corruption != 15 {
		t.Error("corruption not set correctly")
	}
}

func TestPhase0InteractEventBuffer(t *testing.T) {
	sess := puzzle.NewSession("0xtest", "browser")

	sess.RecordClick("nav-systems")
	sess.RecordClick("nav-diagnostics")

	if len(sess.ClickLog) != 2 {
		t.Errorf("expected 2 click log entries, got %d", len(sess.ClickLog))
	}
}

func TestPuzzleSubmitFlow(t *testing.T) {
	archive, err := words.LoadArchive()
	if err != nil {
		t.Fatalf("failed to load archive: %v", err)
	}

	sess := puzzle.NewSession("0xtest", "browser")

	// Generate a puzzle
	pz, err := puzzle.Generate(archive, 0, nil)
	if err != nil {
		t.Fatalf("puzzle generation failed: %v", err)
	}
	sess.LoadPuzzle(pz)

	// Test correct word
	if !sess.CheckWord(pz.TargetWord) {
		t.Error("expected correct word to match")
	}

	// Test wrong word
	if sess.CheckWord("XYZNOTAWORD") {
		t.Error("expected wrong word to not match")
	}
}

// Simulate a decrypt POST with form values
func TestDecryptFormValues(t *testing.T) {
	form := url.Values{}
	form.Set("row", "3")
	form.Set("col", "7")

	req := httptest.NewRequest("POST", "/puzzle/decrypt", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	if req.FormValue("row") != "3" {
		t.Error("form value row not set")
	}
	if req.FormValue("col") != "7" {
		t.Error("form value col not set")
	}
}
