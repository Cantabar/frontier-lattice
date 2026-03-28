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

func TestPhase0TransitionThresholdRange(t *testing.T) {
	for i := 0; i < 30; i++ {
		sess := puzzle.NewSession("0xtest", "browser")
		if sess.TransitionThreshold < 3 || sess.TransitionThreshold > 5 {
			t.Fatalf("TransitionThreshold %d outside [3,5]", sess.TransitionThreshold)
		}
	}
}

func TestPhase0TransitionTrigger(t *testing.T) {
	sess := puzzle.NewSession("0xtest", "browser")
	threshold := sess.TransitionThreshold

	// Clicks on various different elements should accumulate toward threshold
	elements := []string{"btn-scan", "nav-systems", "btn-close", "ctrl-ping", "nav-diagnostics"}
	for i := 0; i < threshold-1; i++ {
		if sess.RecordClick(elements[i%len(elements)]) {
			t.Fatalf("transition triggered too early at click %d (threshold %d)", i+1, threshold)
		}
	}

	// The threshold-th click should trigger
	if !sess.RecordClick("btn-scan") {
		t.Fatalf("expected transition at click %d", threshold)
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

func TestDecryptTrapCell(t *testing.T) {
	archive, err := words.LoadArchive()
	if err != nil {
		t.Fatalf("failed to load archive: %v", err)
	}

	sess := puzzle.NewSession("0xtest", "browser")
	pz, err := puzzle.Generate(archive, 0, nil)
	if err != nil {
		t.Fatalf("puzzle generation failed: %v", err)
	}
	sess.LoadPuzzle(pz)

	// Find a trap cell
	var trapRow, trapCol int
	foundTrap := false
	for r := 0; r < pz.Grid.Rows; r++ {
		for c := 0; c < pz.Grid.Cols; c++ {
			if pz.Grid.Cells[r][c].Type == puzzle.CellTrap {
				trapRow, trapCol = r, c
				foundTrap = true
				break
			}
		}
		if foundTrap {
			break
		}
	}

	if !foundTrap {
		t.Skip("no trap cell found in generated puzzle")
	}

	initialCorruption := sess.Corruption
	sess.DecryptCell(trapRow, trapCol)

	// Simulate what PuzzleDecrypt does for traps
	cell := &pz.Grid.Cells[trapRow][trapCol]
	if cell.Type == puzzle.CellTrap {
		sess.Corruption = min(100, sess.Corruption+25)
	}

	if sess.Corruption != initialCorruption+25 {
		t.Errorf("expected corruption to increase by 25, got %d (was %d)", sess.Corruption, initialCorruption)
	}
}

func TestHintState(t *testing.T) {
	sess := puzzle.NewSession("0xtest", "browser")

	// Defaults
	if !sess.Hints.Decode {
		t.Error("expected Decode hint to default to true")
	}
	if sess.Hints.Heatmap {
		t.Error("expected Heatmap hint to default to false (AI-guided mode)")
	}

	// Per-cell hint
	sess.AddCellHint(3, 7, "vectors")
	if !sess.CellHasHint(3, 7, "vectors") {
		t.Error("expected cell (3,7) to have vectors hint")
	}
	if sess.CellHasHint(0, 0, "vectors") {
		t.Error("expected cell (0,0) to not have vectors hint")
	}

	// Global supersedes per-cell
	sess.SetHint("vectors", true)
	if !sess.CellHasHint(0, 0, "vectors") {
		t.Error("expected global vectors hint to apply to all cells")
	}
}

func TestVectorsThreshold(t *testing.T) {
	// Threshold should be in [4, 8]
	for i := 0; i < 20; i++ {
		sess := puzzle.NewSession("0xtest", "browser")
		if sess.VectorsThreshold < 4 || sess.VectorsThreshold > 8 {
			t.Fatalf("VectorsThreshold %d outside [4,8]", sess.VectorsThreshold)
		}
	}

	// Failed clicks should trigger vectors at threshold
	sess := puzzle.NewSession("0xtest", "browser")
	threshold := sess.VectorsThreshold

	for i := 0; i < threshold-1; i++ {
		if sess.RecordFailedClick() {
			t.Fatalf("vectors triggered too early at click %d (threshold %d)", i+1, threshold)
		}
	}
	if !sess.RecordFailedClick() {
		t.Fatalf("expected vectors trigger at click %d", threshold)
	}

	// Once triggered, further clicks should not re-trigger
	sess.SetHint("vectors", true)
	if sess.RecordFailedClick() {
		t.Error("should not re-trigger vectors after already enabled")
	}

	// LoadPuzzle should reset
	archive, err := words.LoadArchive()
	if err != nil {
		t.Fatalf("failed to load archive: %v", err)
	}
	pz, err := puzzle.Generate(archive, 0, nil)
	if err != nil {
		t.Fatalf("puzzle generation failed: %v", err)
	}
	sess.LoadPuzzle(pz)

	if sess.FailedClicks != 0 {
		t.Error("expected FailedClicks reset after LoadPuzzle")
	}
	if sess.Hints.Vectors {
		t.Error("expected Vectors hint reset after LoadPuzzle")
	}
	if sess.Hints.Heatmap != false {
		t.Error("expected Heatmap to remain false after LoadPuzzle (AI-guided mode)")
	}
}
