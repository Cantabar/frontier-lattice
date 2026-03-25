package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/frontier-corm/puzzle-service/internal/corm"
	"github.com/frontier-corm/puzzle-service/internal/puzzle"
)

// CellData is the template data for rendering a single cell.
type CellData struct {
	Row       int
	Col       int
	Char      string
	Decrypted bool
	IsWord    bool
	CSSClass  string
}

// PuzzleData is the template data for the full puzzle page.
type PuzzleData struct {
	SessionID  string
	Grid       [][]CellData
	Rows       int
	Cols       int
	Stability  int
	Corruption int
	SolveCount int
	Tier       int
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
	cellData := CellData{
		Row:       row,
		Col:       col,
		Char:      string(cell.Plaintext),
		Decrypted: true,
		CSSClass:  "cell--revealed",
	}

	// Emit decrypt event to corm-brain
	if isNew {
		payload, _ := json.Marshal(map[string]any{
			"row":       row,
			"col":       col,
			"is_word":   cell.IsWord,
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

	h.renderTemplate(w, "cell.html", cellData)
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

	h.renderTemplate(w, "result.html", resultData)
}

// buildPuzzleData converts session state into template-friendly data.
func buildPuzzleData(sess *puzzle.Session) PuzzleData {
	grid := make([][]CellData, sess.Grid.Rows)
	for r := 0; r < sess.Grid.Rows; r++ {
		grid[r] = make([]CellData, sess.Grid.Cols)
		for c := 0; c < sess.Grid.Cols; c++ {
			cell := &sess.Grid.Cells[r][c]
			decrypted := sess.DecryptedCells[puzzle.CellKey(r, c)]

			ch := string(cell.Encrypted)
			cssClass := "cell--encrypted"
			if decrypted {
				ch = string(cell.Plaintext)
				cssClass = "cell--revealed"
			}

			grid[r][c] = CellData{
				Row:       r,
				Col:       c,
				Char:      ch,
				Decrypted: decrypted,
				CSSClass:  cssClass,
			}
		}
	}

	return PuzzleData{
		SessionID:  sess.ID,
		Grid:       grid,
		Rows:       sess.Grid.Rows,
		Cols:       sess.Grid.Cols,
		Stability:  sess.Stability,
		Corruption: sess.Corruption,
		SolveCount: sess.SolveCount,
		Tier:       int(sess.Difficulty.Tier),
	}
}
