package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/frontier-corm/puzzle-service/internal/corm"
	"github.com/frontier-corm/puzzle-service/internal/puzzle"
)

// CellData is the template data for rendering a single cell.
type CellData struct {
	Row            int
	Col            int
	Char           string
	Decrypted      bool
	IsWord         bool
	CSSClass       string
	HeatmapClass   string // distance-based coloring
	DirectionClass string // directional indicator toward target
	IsTrap         bool
}

// SignalData holds signal intensity feedback for a single decrypt.
type SignalData struct {
	Label   string // "CRITICAL", "STRONG", "WEAK", "NONE", "SPIKE"
	Percent int
	CSS     string // CSS class suffix
}

// PuzzleData is the template data for the full puzzle page.
type PuzzleData struct {
	Phase        int // 0 = awakening, 1 = puzzle
	SessionID    string
	Grid         [][]CellData
	Rows         int
	Cols         int
	Stability    int
	Corruption   int
	SolveCount   int
	Tier         int
	SignalHint   bool // whether signal meter should be visible
	ShowEntrance bool // true when loaded via phase transition auto-load
	MetersHidden bool // true when stability and corruption are both 0
}

// PuzzlePage serves GET /puzzle — generates and renders a new puzzle.
func (h *Handlers) PuzzlePage(w http.ResponseWriter, r *http.Request) {
	sess := getSession(r)
	if sess == nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}

	// Generate puzzle
	gen, err := puzzle.Generate(h.archive, sess.SolveCount, sess.PendingDifficulty)
	if err != nil {
		http.Error(w, "puzzle generation failed", http.StatusInternalServerError)
		return
	}
	sess.LoadPuzzle(gen)

	data := buildPuzzleData(sess)

	// Entrance animation when arriving from the phase transition sequence
	if r.URL.Query().Get("transition") == "1" {
		data.ShowEntrance = true
	}

	// HTMX partial request (e.g. "Next Puzzle" button or transition auto-load) — return just the main content
	if r.Header.Get("HX-Request") != "" {
		h.renderTemplate(w, "puzzle-content.html", data)
		return
	}
	h.renderTemplate(w, "layout.html", data)
}

// PuzzleDecrypt handles POST /puzzle/decrypt — decrypt a single cell.
func (h *Handlers) PuzzleDecrypt(w http.ResponseWriter, r *http.Request) {
	sess := getSession(r)
	if sess == nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}

	// Rate limit
	if !h.rateLimiter.Allow(sess.ID) {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
		return
	}

	row, _ := strconv.Atoi(r.FormValue("row"))
	col, _ := strconv.Atoi(r.FormValue("col"))

	if sess.Grid == nil || !sess.Grid.InBounds(row, col) {
		http.Error(w, "invalid cell", http.StatusBadRequest)
		return
	}

	isNew := sess.DecryptCell(row, col)

	cell := &sess.Grid.Cells[row][col]

	// Trap corruption spike
	isTrap := cell.Type == puzzle.CellTrap
	if isNew && isTrap {
		sess.Corruption = min(100, sess.Corruption+25)
	}

	cellData := buildCellData(sess, row, col)

	// Emit decrypt event to corm-brain
	if isNew {
		payload, _ := json.Marshal(map[string]any{
			"row":       row,
			"col":       col,
			"is_word":   cell.IsWord,
			"is_trap":   isTrap,
			"distance":  cell.Distance,
			"plaintext": string(cell.Plaintext),
		})
		evt := corm.CormEvent{
			Type:          "event",
			SessionID:     sess.ID,
			PlayerAddress: sess.PlayerAddress,
			Context:       sess.Context,
			EventType:     "decrypt",
			Payload:       payload,
			Timestamp:     time.Now(),
		}
		sess.EventBuffer.Push(evt)
		go h.relay.BroadcastEvent(evt)
	}

	// If signal hint is active, return composite response with OOB signal meter update
	if sess.CellHasHint(row, col, "signal") {
		sig := computeSignal(cell)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		h.templates.ExecuteTemplate(w, "cell.html", cellData)
		fmt.Fprintf(w, `<div id="signal-meter" hx-swap-oob="innerHTML">`+
			`<div class="signal-label">%s</div>`+
			`<div class="signal-bar"><div class="signal-fill signal-fill--%s" style="width:%d%%"></div></div>`+
			`</div>`, sig.Label, sig.CSS, sig.Percent)
		return
	}

	h.renderTemplate(w, "cell.html", cellData)
}

// PuzzleGrid handles GET /puzzle/grid — re-renders just the grid partial.
func (h *Handlers) PuzzleGrid(w http.ResponseWriter, r *http.Request) {
	sess := getSession(r)
	if sess == nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}
	data := buildPuzzleData(sess)
	h.renderTemplate(w, "grid.html", data)
}

// PuzzleSubmit handles POST /puzzle/submit — validate a word guess.
func (h *Handlers) PuzzleSubmit(w http.ResponseWriter, r *http.Request) {
	sess := getSession(r)
	if sess == nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}

	word := r.FormValue("word")
	if word == "" {
		http.Error(w, "missing word", http.StatusBadRequest)
		return
	}

	correct := sess.CheckWord(word)

	// Update meters
	resultData := map[string]any{
		"Correct":    correct,
		"Word":       word,
		"Stability":  sess.Stability,
		"Corruption": sess.Corruption,
	}

	if correct {
		// Stability gain scales inversely with solve count
		gain := max(5, 20-sess.SolveCount*2)
		sess.Stability = min(100, sess.Stability+gain)
		sess.SolveCount++
		resultData["Stability"] = sess.Stability
		resultData["SolveCount"] = sess.SolveCount
		resultData["ShowNext"] = true
	} else {
		sess.IncorrectAttempts++
		sess.Corruption = min(100, sess.Corruption+10)
		resultData["Corruption"] = sess.Corruption
	}

	// Emit submit event to corm-brain
	payload, _ := json.Marshal(map[string]any{
		"word":               word,
		"correct":            correct,
		"stability":          sess.Stability,
		"corruption":         sess.Corruption,
		"solve_count":        sess.SolveCount,
		"incorrect_attempts": sess.IncorrectAttempts,
	})
	evt := corm.CormEvent{
		Type:          "event",
		SessionID:     sess.ID,
		PlayerAddress: sess.PlayerAddress,
		Context:       sess.Context,
		EventType:     "submit",
		Payload:       payload,
		Timestamp:     time.Now(),
	}
	sess.EventBuffer.Push(evt)
	go h.relay.BroadcastEvent(evt)

	// Meters are now non-zero — ensure the OOB meters partial reveals them.
	resultData["MetersHidden"] = sess.Stability == 0 && sess.Corruption == 0

	h.renderTemplate(w, "result.html", resultData)
}

// buildPuzzleData converts session state into template-friendly data.
func buildPuzzleData(sess *puzzle.Session) PuzzleData {
	grid := make([][]CellData, sess.Grid.Rows)
	for r := 0; r < sess.Grid.Rows; r++ {
		grid[r] = make([]CellData, sess.Grid.Cols)
		for c := 0; c < sess.Grid.Cols; c++ {
			grid[r][c] = buildCellData(sess, r, c)
		}
	}

	return PuzzleData{
		Phase:        int(sess.Phase),
		SessionID:    sess.ID,
		Grid:         grid,
		Rows:         sess.Grid.Rows,
		Cols:         sess.Grid.Cols,
		Stability:    sess.Stability,
		Corruption:   sess.Corruption,
		SolveCount:   sess.SolveCount,
		Tier:         int(sess.Difficulty.Tier),
		SignalHint:   sess.Hints.Signal,
		MetersHidden: sess.Stability == 0 && sess.Corruption == 0,
	}
}

// buildCellData produces template data for a single cell, including hint classes.
func buildCellData(sess *puzzle.Session, r, c int) CellData {
	cell := &sess.Grid.Cells[r][c]
	decrypted := sess.DecryptedCells[puzzle.CellKey(r, c)]

	ch := string(cell.Encrypted)
	cssClass := "cell--encrypted"
	if decrypted {
		if sess.Hints.Decode {
			ch = string(cell.Plaintext)
		}
		cssClass = "cell--revealed"
	}

	var heatmapClass, directionClass string
	isTrap := cell.Type == puzzle.CellTrap

	if decrypted && sess.CellHasHint(r, c, "heatmap") {
		heatmapClass = heatmapClassForCell(cell)
	}
	if decrypted && sess.CellHasHint(r, c, "vectors") && cell.Type != puzzle.CellTarget {
		directionClass = directionClassForCell(r, c, sess.TargetPlacement)
	}

	return CellData{
		Row:            r,
		Col:            c,
		Char:           ch,
		Decrypted:      decrypted,
		CSSClass:       cssClass,
		HeatmapClass:   heatmapClass,
		DirectionClass: directionClass,
		IsTrap:         isTrap,
	}
}

// heatmapClassForCell returns a CSS class based on distance to the target word.
func heatmapClassForCell(cell *puzzle.Cell) string {
	if cell.Type == puzzle.CellTrap {
		return "cell--heat-trap"
	}
	switch {
	case cell.Distance == 0:
		return "cell--heat-critical"
	case cell.Distance < 5:
		return "cell--heat-warm"
	case cell.Distance < 12:
		return "cell--heat-cool"
	default:
		return "cell--heat-cold"
	}
}

// directionClassForCell returns a CSS class indicating direction toward the target.
func directionClassForCell(row, col int, placement puzzle.WordPlacement) string {
	// Compute target midpoint
	var midRow, midCol float64
	if placement.Horizontal {
		midRow = float64(placement.StartRow)
		midCol = float64(placement.StartCol) + float64(placement.Length)/2.0
	} else {
		midRow = float64(placement.StartRow) + float64(placement.Length)/2.0
		midCol = float64(placement.StartCol)
	}

	dir := ""
	if float64(row) > midRow+0.5 {
		dir += "N" // cell is below target, point north
	} else if float64(row) < midRow-0.5 {
		dir += "S" // cell is above target, point south
	}
	if float64(col) > midCol+0.5 {
		dir += "W" // cell is right of target, point west
	} else if float64(col) < midCol-0.5 {
		dir += "E" // cell is left of target, point east
	}

	if dir == "" {
		return ""
	}
	return "cell--dir-" + dir
}

// computeSignal returns signal intensity feedback for a cell.
func computeSignal(cell *puzzle.Cell) SignalData {
	if cell.Type == puzzle.CellTrap {
		return SignalData{Label: "VOLTAGE SPIKE", Percent: 0, CSS: "spike"}
	}
	switch {
	case cell.Distance == 0:
		return SignalData{Label: "CRITICAL MATCH", Percent: 100, CSS: "critical"}
	case cell.Distance < 5:
		return SignalData{Label: "STRONG SIGNAL", Percent: 75, CSS: "strong"}
	case cell.Distance < 12:
		return SignalData{Label: "WEAK SIGNAL", Percent: 40, CSS: "weak"}
	default:
		return SignalData{Label: "NO SIGNAL", Percent: 10, CSS: "none"}
	}
}
