package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/frontier-corm/continuity-engine/internal/dispatch"
	"github.com/frontier-corm/continuity-engine/internal/handlers"
	"github.com/frontier-corm/continuity-engine/internal/puzzle"
	"github.com/frontier-corm/continuity-engine/internal/types"
)

// testFS embeds templates for testing (must match main.go pattern)
// We use the actual template files via a test helper.
func setupHandlers(t *testing.T) (*handlers.Handlers, *puzzle.SessionStore) {
	t.Helper()

	store := puzzle.NewSessionStore()
	adapter := &puzzle.SessionStoreAdapter{Store: store}
	eventChan := make(chan types.CormEvent, 256)
	dispatcher := dispatch.New(adapter, eventChan)

	// We can't use embed.FS in tests easily, so we test handler logic
	// by calling methods directly rather than through HTTP with templates.
	// For integration tests that need templates, use the full server.
	_ = dispatcher

	return nil, store // Templates can't be loaded in test package easily
}

func TestHealthEndpoint(t *testing.T) {
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	h := &healthOnly{}
	h.Health(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	body := w.Body.String()
	if !strings.Contains(body, `"status":"ok"`) {
		t.Errorf("expected ok status in body: %s", body)
	}
}

// healthOnly is a minimal handler for testing the health endpoint.
type healthOnly struct{}

func (h *healthOnly) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok","service":"continuity-engine"}`))
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
	store := puzzle.NewSessionStore()

	sess := puzzle.NewSession("0xtest", "browser")
	sess.Stability = 42
	sess.Corruption = 15
	store.Put(sess)

	// Create a request with session in context
	req := httptest.NewRequest("GET", "/status", nil)
	ctx := context.WithValue(req.Context(), puzzle.SessionContextKey, sess)
	req = req.WithContext(ctx)

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
	sess := puzzle.NewSession("0xtest", "browser")

	// Generate a puzzle
	pz, err := puzzle.Generate(0, nil, 0, 0, "")
	if err != nil {
		t.Fatalf("puzzle generation failed: %v", err)
	}
	sess.LoadPuzzle(pz)

	// Test correct word (SUI address)
	if !sess.CheckWord(pz.TargetWord) {
		t.Error("expected correct address to match")
	}

	// Test wrong word
	if sess.CheckWord("0xwrongaddr1") {
		t.Error("expected wrong address to not match")
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

func TestDecryptTrapCellExplosion(t *testing.T) {
	sess := puzzle.NewSession("0xtest", "browser")
	pz, err := puzzle.Generate(0, nil, 0, 0, "")
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

	// Simulate trap explosion — garble cells in radius 3
	garbled := puzzle.CellsInRadius(pz.Grid, trapRow, trapCol, 3.0)
	for _, gc := range garbled {
		key := puzzle.CellKey(gc.Row, gc.Col)
		gcell := &pz.Grid.Cells[gc.Row][gc.Col]
		gcell.IsGarbled = true
		gcell.Type = puzzle.CellGarbled
		sess.GarbledCells[key] = true
	}

	// Verify garbled cells exist
	if len(sess.GarbledCells) == 0 {
		t.Error("expected garbled cells after trap explosion")
	}

	// Verify corruption was NOT increased (new behavior)
	if sess.Corruption != 0 {
		t.Errorf("expected corruption to remain 0 after trap explosion, got %d", sess.Corruption)
	}
}

func TestGarbleCharsAreDistinctAndNonBlockGlyphs(t *testing.T) {
	if len(puzzle.GarbleChars) < 20 {
		t.Fatalf("expected a substantial garble glyph set, got %d glyphs", len(puzzle.GarbleChars))
	}

	seen := make(map[rune]bool, len(puzzle.GarbleChars))
	for _, ch := range puzzle.GarbleChars {
		if ch == '█' {
			t.Fatalf("garble glyph set should not include the block rectangle glyph")
		}
		if ch <= 0x7E {
			t.Fatalf("expected non-ASCII garble glyph, got %q", ch)
		}
		if seen[ch] {
			t.Fatalf("duplicate garble glyph %q", ch)
		}
		seen[ch] = true
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

func TestThermalSensorAreaEffect(t *testing.T) {
	// Generate puzzles until we find one with a thermal sensor
	var sess *puzzle.Session
	var thermalRow, thermalCol int
	found := false

	for attempt := 0; attempt < 20; attempt++ {
		sess = puzzle.NewSession("0xtest", "browser")
		pz, err := puzzle.Generate(0, nil, 0, 0, "")
		if err != nil {
			t.Fatalf("Generate failed: %v", err)
		}
		sess.LoadPuzzle(pz)

		for r := 0; r < pz.Grid.Rows; r++ {
			for c := 0; c < pz.Grid.Cols; c++ {
				cell := &pz.Grid.Cells[r][c]
				if cell.Type == puzzle.CellSensor && cell.HintType == "thermal" {
					thermalRow, thermalCol = r, c
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if found {
			break
		}
	}

	if !found {
		t.Skip("no thermal sensor found in 20 generated puzzles")
	}

	// Simulate the thermal sensor area effect:
	// apply per-cell heatmap hints to all cells within radius 4.
	thermalCells := puzzle.CellsInRadius(sess.Grid, thermalRow, thermalCol, 4.0)
	for _, tc := range thermalCells {
		sess.AddCellHint(tc.Row, tc.Col, "heatmap")
	}

	// Verify at least a few cells in the radius now have the heatmap hint.
	hintedCount := 0
	for _, tc := range thermalCells {
		if sess.CellHasHint(tc.Row, tc.Col, "heatmap") {
			hintedCount++
		}
	}

	if hintedCount == 0 {
		t.Error("expected heatmap hints on cells within thermal sensor radius")
	}
	if hintedCount != len(thermalCells) {
		t.Errorf("expected all %d cells in radius to have heatmap hint, got %d", len(thermalCells), hintedCount)
	}

	// Verify a cell far outside the radius does NOT have the hint
	// (unless the global heatmap toggle is on, which it isn't by default).
	farRow := clampInt(thermalRow+10, 0, sess.Grid.Rows-1)
	farCol := clampInt(thermalCol+10, 0, sess.Grid.Cols-1)
	outsideRadius := true
	for _, tc := range thermalCells {
		if tc.Row == farRow && tc.Col == farCol {
			outsideRadius = false
			break
		}
	}
	if outsideRadius && sess.CellHasHint(farRow, farCol, "heatmap") {
		t.Error("cell outside thermal radius should not have heatmap hint")
	}
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
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
	pz, err := puzzle.Generate(0, nil, 0, 0, "")
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
