package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

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
	IsSensor       bool
	SensorType     string // "sonar", "thermal", "vector"
	IsGarbled      bool
	IsAddress      bool   // part of target or decoy address
	PulseColor     string // color class for pulse JS system
	SwapOOB        bool   // true when this cell should be swapped out-of-band
}

// TargetFoundData is the template data for the target-found overlay.
type TargetFoundData struct {
	Address       string
	StabilityGain int
	Stability     int
	SolveCount    int
}

// PulseEntry is one cell in a pulse response.
type PulseEntry struct {
	Row   int    `json:"row"`
	Col   int    `json:"col"`
	Color string `json:"color"`
}

// PulseData is the JSON payload for client-side pulse animation.
type PulseData struct {
	Cells         []PulseEntry `json:"cells"`
	PulseCount    int          `json:"pulseCount"`
	PulseInterval int          `json:"pulseInterval"` // ms between pulses
}

// SignalData holds signal intensity feedback for a single decrypt.
type SignalData struct {
	Label   string // "CRITICAL", "STRONG", "WEAK", "NONE", "SPIKE"
	Percent int
	CSS     string // CSS class suffix
}

// SubEntry represents a single encrypted → plaintext mapping for the analysis sidebar.
type SubEntry struct {
	Encrypted string
	Plaintext string
	IsAlpha   bool
}

// FreqEntry represents a character frequency count for the analysis sidebar.
type FreqEntry struct {
	Char     string
	Count    int
	BarWidth int
	IsAlpha  bool
}

// CipherAnalysisData is the template data for the Phase 1 right sidebar.
type CipherAnalysisData struct {
	Substitutions  []SubEntry
	SolveCount     int
	DecryptedCount int
	TotalCells     int
	FreqEntries    []FreqEntry
	ShowFreq       bool // true when decrypted count >= 5
	SwapOOB        bool // true when the sidebar should be swapped out-of-band
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
	Analysis     CipherAnalysisData
}

// PuzzlePage serves GET /puzzle — generates and renders a new puzzle.
func (h *Handlers) PuzzlePage(w http.ResponseWriter, r *http.Request) {
	sess := getSession(r)
	if sess == nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}

	// Generate puzzle
	gen, err := puzzle.Generate(sess.SolveCount, sess.PendingDifficulty)
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
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		h.templates.ExecuteTemplate(w, "puzzle-content.html", data)
		if data.Phase == int(puzzle.PhasePuzzle) {
			analysis := data.Analysis
			analysis.SwapOOB = true
			h.templates.ExecuteTemplate(w, "cipher-analysis.html", analysis)
		}
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

	// Reject clicks on garbled cells
	if sess.GarbledCells[puzzle.CellKey(row, col)] {
		http.Error(w, "cell garbled", http.StatusBadRequest)
		return
	}

	// Snapshot the previous decrypt position BEFORE DecryptCell updates it.
	var prevDecrypt *puzzle.CellCoord
	if sess.LastDecrypt != nil {
		copy := *sess.LastDecrypt
		prevDecrypt = &copy
	}

	// Snapshot whether a guided cell is active BEFORE CheckGuidedCell clears it.
	guidedCellWasActive := sess.GuidedCell != nil

	cell := &sess.Grid.Cells[row][col]
	isTrap := cell.Type == puzzle.CellTrap
	isSonarSensor := cell.Type == puzzle.CellSensor && cell.HintType == "sonar"
	isAddress := cell.StringID != ""
	isTargetAddress := cell.StringID == "target_main"

	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	// --- Trap explosion: garble all cells in radius 3 ---
	if isTrap {
		sess.DecryptCell(row, col)
		garbled := puzzle.CellsInRadius(sess.Grid, row, col, 3.0)
		targetDestroyed := false
		for _, gc := range garbled {
			key := puzzle.CellKey(gc.Row, gc.Col)
			gcell := &sess.Grid.Cells[gc.Row][gc.Col]
			if gcell.StringID == "target_main" {
				targetDestroyed = true
			}
			gcell.IsGarbled = true
			gcell.Type = puzzle.CellGarbled
			gcell.Decrypted = true
			sess.DecryptedCells[key] = true
			sess.GarbledCells[key] = true
		}
		sess.TargetDestroyed = targetDestroyed

		// Return swaps for all garbled cells (OOB for non-clicked cells)
		for _, gc := range garbled {
			cd := buildCellData(sess, gc.Row, gc.Col)
			if gc.Row != row || gc.Col != col {
				cd.SwapOOB = true
			}
			h.templates.ExecuteTemplate(w, "cell.html", cd)
		}
		analysis := buildCipherAnalysis(sess)
		analysis.SwapOOB = true
		h.templates.ExecuteTemplate(w, "cipher-analysis.html", analysis)

		if targetDestroyed {
			fmt.Fprintf(w, `<div id="pulse-data" hx-swap-oob="innerHTML" data-game-over="true"></div>`)
		} else {
			// Emit pulse data for the explosion radius (visual feedback)
			writePulseData(w, sess, row, col, 3.0, 1, 0)
		}

		emitDecryptEvent(h, sess, row, col, cell, isTrap, prevDecrypt, guidedCellWasActive, false)
		return
	}

	// --- Address reveal: clicking any cell reveals the entire address ---
	if isAddress {
		// Reveal all cells with the same StringID
		for rr := range sess.Grid.Cells {
			for cc := range sess.Grid.Cells[rr] {
				if sess.Grid.Cells[rr][cc].StringID == cell.StringID {
					sess.DecryptCell(rr, cc)
				}
			}
		}

		// Return swaps for all cells in the address (OOB for non-clicked cells)
		for rr := range sess.Grid.Cells {
			for cc := range sess.Grid.Cells[rr] {
				if sess.Grid.Cells[rr][cc].StringID == cell.StringID {
					cd := buildCellData(sess, rr, cc)
					if isTargetAddress {
						cd.CSSClass += " cell--target-locked"
					}
					if rr != row || cc != col {
						cd.SwapOOB = true
					}
					h.templates.ExecuteTemplate(w, "cell.html", cd)
				}
			}
		}
		analysis := buildCipherAnalysis(sess)
		analysis.SwapOOB = true
		h.templates.ExecuteTemplate(w, "cipher-analysis.html", analysis)

		// Localized pulse (radius 2) from the clicked cell
		writePulseData(w, sess, row, col, 2.0, 1, 0)

		emitDecryptEvent(h, sess, row, col, cell, false, prevDecrypt, guidedCellWasActive, false)

		// Auto-complete if target address
		if isTargetAddress {
			// Apply solve logic (same as PuzzleSubmit correct path)
			gain := max(5, 20-sess.SolveCount*2)
			sess.Stability = min(100, sess.Stability+gain)
			sess.SolveCount++
			sess.LastSolveCorrect = true

			// Log line in terminal
			fmt.Fprintf(w, `<div id="auto-win" hx-swap-oob="beforeend:#corm-log">`+
				`<div class="boot-line boot-line--correct">✓ PATTERN ANCHOR ISOLATED: %s</div>`+
				`</div>`, sess.TargetWord)

			// Render the target-found overlay (replaces grid via OOB)
			h.templates.ExecuteTemplate(w, "target-found.html", TargetFoundData{
				Address:       sess.TargetWord,
				StabilityGain: gain,
				Stability:     sess.Stability,
				SolveCount:    sess.SolveCount,
			})

			// Emit submit event to corm-brain
			submitPayload, _ := json.Marshal(map[string]any{
				"word":              sess.TargetWord,
				"correct":           true,
				"auto_discovered":   true,
				"stability":         sess.Stability,
				"corruption":        sess.Corruption,
				"solve_count":       sess.SolveCount,
				"incorrect_attempts": sess.IncorrectAttempts,
			})
			submitEvt := corm.CormEvent{
				Type:          "event",
				SessionID:     sess.ID,
				PlayerAddress: sess.PlayerAddress,
				Context:       sess.Context,
				EventType:     "submit",
				Payload:       submitPayload,
				Timestamp:     time.Now(),
			}
			sess.EventBuffer.Push(submitEvt)
			go h.relay.BroadcastEvent(submitEvt)
		}
		return
	}

	// --- Normal cell decrypt ---
	isNew := sess.DecryptCell(row, col)

	// Check if player hit the AI-guided cell
	guidedHit := false
	if isNew {
		if hintType, ok := sess.CheckGuidedCell(row, col); ok {
			sess.AddCellHint(row, col, hintType)
			guidedHit = true
		}
	}

	cellData := buildCellData(sess, row, col)
	analysis := buildCipherAnalysis(sess)
	analysis.SwapOOB = true

	h.templates.ExecuteTemplate(w, "cell.html", cellData)
	h.templates.ExecuteTemplate(w, "cipher-analysis.html", analysis)

	// Sonar sensor: triple pulse (radius 5, 3 iterations at 1s intervals)
	if isSonarSensor {
		writePulseData(w, sess, row, col, 5.0, 3, 1000)
	} else {
		// Localized pulse (radius 2) on every decrypt
		writePulseData(w, sess, row, col, 2.0, 1, 0)
	}

	// If signal hint is active, return OOB signal meter update
	if sess.CellHasHint(row, col, "signal") {
		sig := computeSignal(cell)
		fmt.Fprintf(w, `<div id="signal-meter" hx-swap-oob="innerHTML">`+
			`<div class="signal-label">%s</div>`+
			`<div class="signal-bar"><div class="signal-fill signal-fill--%s" style="width:%d%%"></div></div>`+
			`</div>`, sig.Label, sig.CSS, sig.Percent)
	}

	emitDecryptEvent(h, sess, row, col, cell, false, prevDecrypt, guidedCellWasActive, guidedHit)
}

// writePulseData writes the OOB pulse-data div with JSON for client-side pulse animation.
func writePulseData(w http.ResponseWriter, sess *puzzle.Session, centerRow, centerCol int, radius float64, pulseCount, pulseInterval int) {
	cells := puzzle.CellsInRadius(sess.Grid, centerRow, centerCol, radius)
	var entries []PulseEntry
	for _, coord := range cells {
		key := puzzle.CellKey(coord.Row, coord.Col)
		// Only pulse unrevealed, non-garbled cells
		if sess.DecryptedCells[key] || sess.GarbledCells[key] {
			continue
		}
		cell := &sess.Grid.Cells[coord.Row][coord.Col]
		entries = append(entries, PulseEntry{
			Row:   coord.Row,
			Col:   coord.Col,
			Color: puzzle.PulseColorForCell(cell),
		})
	}
	if len(entries) == 0 {
		return
	}
	pd := PulseData{Cells: entries, PulseCount: pulseCount, PulseInterval: pulseInterval}
	pulseJSON, _ := json.Marshal(pd)
	fmt.Fprintf(w, `<div id="pulse-data" hx-swap-oob="innerHTML">%s</div>`, string(pulseJSON))
}

// emitDecryptEvent sends a decrypt event to corm-brain.
func emitDecryptEvent(h *Handlers, sess *puzzle.Session, row, col int, cell *puzzle.Cell, isTrap bool, prevDecrypt *puzzle.CellCoord, guidedCellWasActive, guidedHit bool) {
	evtPayload := map[string]any{
		"row":                 row,
		"col":                 col,
		"is_word":             cell.IsWord,
		"is_trap":             isTrap,
		"is_sensor":           cell.Type == puzzle.CellSensor,
		"sensor_type":         cell.HintType,
		"string_id":           cell.StringID,
		"distance":            cell.Distance,
		"plaintext":           string(cell.Plaintext),
		"guided_cell_active":  guidedCellWasActive,
		"guided_cell_reached": guidedHit,
	}
	if prevDecrypt != nil {
		evtPayload["last_decrypt"] = map[string]int{
			"row": prevDecrypt.Row,
			"col": prevDecrypt.Col,
		}
	}
	payload, _ := json.Marshal(evtPayload)
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

// PuzzleGrid handles GET /puzzle/grid
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
// The response is appended to #corm-log (the terminal) via HX-Retarget.
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

	// Handle "next" command after a correct solve
	if strings.EqualFold(word, "next") && sess.LastSolveCorrect {
		sess.LastSolveCorrect = false
		w.Header().Set("HX-Redirect", "/puzzle?transition=1")
		w.WriteHeader(http.StatusNoContent)
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
		sess.LastSolveCorrect = true
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

	// Retarget response into the terminal log
	resultData["MetersHidden"] = sess.Stability == 0 && sess.Corruption == 0
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("HX-Retarget", "#corm-log")
	w.Header().Set("HX-Reswap", "beforeend")
	h.templates.ExecuteTemplate(w, "result.html", resultData)
	if sess.Phase == puzzle.PhasePuzzle {
		analysis := buildCipherAnalysis(sess)
		analysis.SwapOOB = true
		h.templates.ExecuteTemplate(w, "cipher-analysis.html", analysis)
	}
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
		Analysis:     buildCipherAnalysis(sess),
	}
}

// buildCellData produces template data for a single cell, including hint classes.
func buildCellData(sess *puzzle.Session, r, c int) CellData {
	cell := &sess.Grid.Cells[r][c]
	key := puzzle.CellKey(r, c)
	decrypted := sess.DecryptedCells[key]
	garbled := sess.GarbledCells[key]

	ch := string(cell.Encrypted)
	cssClass := "cell--encrypted"
	if garbled {
		cssClass = "cell--garbled"
		ch = "" // garbled cells render via CSS animation
	} else if decrypted {
		if sess.Hints.Decode {
			ch = string(cell.Plaintext)
		}
		cssClass = "cell--revealed"
	}

	var heatmapClass, directionClass string
	isTrap := cell.Type == puzzle.CellTrap || cell.Type == puzzle.CellGarbled
	isSensor := cell.Type == puzzle.CellSensor
	isAddress := cell.StringID != ""

	if decrypted && !garbled && sess.CellHasHint(r, c, "heatmap") {
		heatmapClass = heatmapClassForCell(cell)
	}
	if decrypted && !garbled && sess.CellHasHint(r, c, "vectors") && cell.Type != puzzle.CellTarget {
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
		IsSensor:       isSensor,
		SensorType:     cell.HintType,
		IsGarbled:      garbled,
		IsAddress:      isAddress,
		PulseColor:     puzzle.PulseColorForCell(cell),
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

// buildCipherAnalysis produces the data for the Phase 1 analysis sidebar.
func buildCipherAnalysis(sess *puzzle.Session) CipherAnalysisData {
	if sess.Grid == nil {
		return CipherAnalysisData{}
	}

	totalCells := sess.Grid.Rows * sess.Grid.Cols
	decryptedCount := len(sess.DecryptedCells)

	type substitution struct {
		encrypted rune
		plaintext rune
	}

	seenSubs := make(map[substitution]bool)
	freqMap := make(map[rune]int)

	for key := range sess.DecryptedCells {
		var row, col int
		if _, err := fmt.Sscanf(key, "%d-%d", &row, &col); err != nil {
			continue
		}
		if !sess.Grid.InBounds(row, col) {
			continue
		}

		cell := &sess.Grid.Cells[row][col]
		seenSubs[substitution{encrypted: cell.Encrypted, plaintext: cell.Plaintext}] = true
		freqMap[cell.Plaintext]++
	}

	subKeys := make([]substitution, 0, len(seenSubs))
	for sub := range seenSubs {
		subKeys = append(subKeys, sub)
	}
	sort.Slice(subKeys, func(i, j int) bool {
		if subKeys[i].encrypted == subKeys[j].encrypted {
			return subKeys[i].plaintext < subKeys[j].plaintext
		}
		return subKeys[i].encrypted < subKeys[j].encrypted
	})

	substitutions := make([]SubEntry, 0, len(subKeys))
	for _, sub := range subKeys {
		substitutions = append(substitutions, SubEntry{
			Encrypted: string(sub.encrypted),
			Plaintext: string(sub.plaintext),
			IsAlpha:   unicode.IsLetter(sub.plaintext),
		})
	}

	type frequency struct {
		char  rune
		count int
	}

	freqKeys := make([]frequency, 0, len(freqMap))
	maxCount := 0
	for ch, count := range freqMap {
		if count > maxCount {
			maxCount = count
		}
		freqKeys = append(freqKeys, frequency{char: ch, count: count})
	}
	sort.Slice(freqKeys, func(i, j int) bool {
		if freqKeys[i].count == freqKeys[j].count {
			return freqKeys[i].char < freqKeys[j].char
		}
		return freqKeys[i].count > freqKeys[j].count
	})

	freqEntries := make([]FreqEntry, 0, len(freqKeys))
	for _, freq := range freqKeys {
		barWidth := 0
		if maxCount > 0 {
			barWidth = (freq.count * 100) / maxCount
		}
		freqEntries = append(freqEntries, FreqEntry{
			Char:     string(freq.char),
			Count:    freq.count,
			BarWidth: barWidth,
			IsAlpha:  unicode.IsLetter(freq.char),
		})
	}

	return CipherAnalysisData{
		Substitutions:  substitutions,
		SolveCount:     sess.SolveCount,
		DecryptedCount: decryptedCount,
		TotalCells:     totalCells,
		FreqEntries:    freqEntries,
		ShowFreq:       decryptedCount >= 5,
	}
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
