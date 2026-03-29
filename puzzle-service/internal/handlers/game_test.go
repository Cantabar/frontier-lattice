package handlers

import (
	"context"
	"fmt"
	"html/template"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/frontier-corm/puzzle-service/internal/corm"
	"github.com/frontier-corm/puzzle-service/internal/puzzle"
)

func newTestHandlers(t *testing.T) *Handlers {
	t.Helper()

	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("failed to resolve test file path")
	}

	tmpl := template.Must(template.ParseGlob(filepath.Join(filepath.Dir(filename), "../templates/*.html")))
	store := puzzle.NewSessionStore()
	adapter := &puzzle.SessionStoreAdapter{Store: store}
	relay := corm.NewRelay(adapter)

	return &Handlers{
		templates:   tmpl,
		sessions:    store,
		relay:       relay,
		rateLimiter: NewRateLimiter(1000, 1000),
	}
}

func newDecryptRequest(t *testing.T, sess *puzzle.Session, row, col int) *httptest.ResponseRecorder {
	t.Helper()

	form := url.Values{}
	form.Set("row", fmt.Sprintf("%d", row))
	form.Set("col", fmt.Sprintf("%d", col))

	req := httptest.NewRequest("POST", "/puzzle/decrypt", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req = req.WithContext(context.WithValue(req.Context(), puzzle.SessionContextKey, sess))

	w := httptest.NewRecorder()
	newTestHandlers(t).PuzzleDecrypt(w, req)
	return w
}

func findAddressCell(t *testing.T, grid *puzzle.Grid, cellType puzzle.CellType) (int, int, int) {
	t.Helper()

	for r := 0; r < grid.Rows; r++ {
		for c := 0; c < grid.Cols; c++ {
			cell := &grid.Cells[r][c]
			if cell.Type != cellType || cell.StringID == "" {
				continue
			}

			count := 0
			for rr := 0; rr < grid.Rows; rr++ {
				for cc := 0; cc < grid.Cols; cc++ {
					if grid.Cells[rr][cc].StringID == cell.StringID {
						count++
					}
				}
			}

			return r, c, count
		}
	}

	t.Fatalf("no cell found for type %d", cellType)
	return 0, 0, 0
}

func findTrapCell(t *testing.T, grid *puzzle.Grid) (int, int, int) {
	t.Helper()

	for r := 0; r < grid.Rows; r++ {
		for c := 0; c < grid.Cols; c++ {
			if grid.Cells[r][c].Type == puzzle.CellTrap {
				return r, c, len(puzzle.CellsInRadius(grid, r, c, 3.0))
			}
		}
	}

	t.Fatal("no trap cell found")
	return 0, 0, 0
}

func TestPuzzleDecryptAddressRevealUsesOOBSwapsForNonClickedCells(t *testing.T) {
	sess := puzzle.NewSession("0xtest", "browser")
	pz, err := puzzle.Generate(0, nil)
	if err != nil {
		t.Fatalf("puzzle generation failed: %v", err)
	}
	sess.LoadPuzzle(pz)

	row, col, groupSize := findAddressCell(t, pz.Grid, puzzle.CellDecoy)
	resp := newDecryptRequest(t, sess, row, col)
	body := resp.Body.String()

	if got := strings.Count(body, `id="cell-`); got != groupSize {
		t.Fatalf("expected %d cell fragments, got %d", groupSize, got)
	}
	if got := strings.Count(body, `hx-swap-oob="outerHTML"`); got != groupSize-1 {
		t.Fatalf("expected %d OOB cell swaps, got %d", groupSize-1, got)
	}
}

func TestPuzzleDecryptTrapExplosionUsesOOBSwapsForNonClickedCells(t *testing.T) {
	sess := puzzle.NewSession("0xtest", "browser")
	pz, err := puzzle.Generate(0, nil)
	if err != nil {
		t.Fatalf("puzzle generation failed: %v", err)
	}
	sess.LoadPuzzle(pz)

	row, col, garbledCount := findTrapCell(t, pz.Grid)
	resp := newDecryptRequest(t, sess, row, col)
	body := resp.Body.String()

	if got := strings.Count(body, `id="cell-`); got != garbledCount {
		t.Fatalf("expected %d cell fragments, got %d", garbledCount, got)
	}
	if got := strings.Count(body, `hx-swap-oob="outerHTML"`); got != garbledCount-1 {
		t.Fatalf("expected %d OOB cell swaps, got %d", garbledCount-1, got)
	}
}
