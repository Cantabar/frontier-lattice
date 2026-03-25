package tests

import (
	"strings"
	"testing"

	"github.com/frontier-corm/puzzle-service/internal/puzzle"
	"github.com/frontier-corm/puzzle-service/internal/words"
)

func loadTestArchive(t *testing.T) *words.Archive {
	t.Helper()
	a, err := words.LoadArchive()
	if err != nil {
		t.Fatalf("failed to load archive: %v", err)
	}
	return a
}

func TestGeneratePuzzle(t *testing.T) {
	archive := loadTestArchive(t)

	pz, err := puzzle.Generate(archive, 0, nil)
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	if pz.PuzzleID == "" {
		t.Error("expected non-empty puzzle ID")
	}
	if pz.TargetWord == "" {
		t.Error("expected non-empty target word")
	}
	if pz.Grid == nil {
		t.Fatal("expected non-nil grid")
	}
	if pz.Grid.Rows != 8 || pz.Grid.Cols != 12 {
		t.Errorf("expected 8x12 grid, got %dx%d", pz.Grid.Rows, pz.Grid.Cols)
	}
}

func TestTargetWordInGrid(t *testing.T) {
	archive := loadTestArchive(t)

	for i := 0; i < 10; i++ {
		pz, err := puzzle.Generate(archive, 0, nil)
		if err != nil {
			t.Fatalf("Generate failed: %v", err)
		}

		// Verify the target word appears in the plaintext grid
		found := false
		word := strings.ToUpper(pz.TargetWord)

		// Check horizontal
		for r := 0; r < pz.Grid.Rows; r++ {
			var row []rune
			for c := 0; c < pz.Grid.Cols; c++ {
				row = append(row, pz.Grid.Cells[r][c].Plaintext)
			}
			if strings.Contains(string(row), word) {
				found = true
				break
			}
		}

		// Check vertical
		if !found {
			for c := 0; c < pz.Grid.Cols; c++ {
				var col []rune
				for r := 0; r < pz.Grid.Rows; r++ {
					col = append(col, pz.Grid.Cells[r][c].Plaintext)
				}
				if strings.Contains(string(col), word) {
					found = true
					break
				}
			}
		}

		if !found {
			t.Errorf("target word %q not found in grid (iteration %d)", word, i)
		}
	}
}

func TestNoCellEmpty(t *testing.T) {
	archive := loadTestArchive(t)

	pz, err := puzzle.Generate(archive, 0, nil)
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	for r := 0; r < pz.Grid.Rows; r++ {
		for c := 0; c < pz.Grid.Cols; c++ {
			cell := &pz.Grid.Cells[r][c]
			if cell.Plaintext == 0 {
				t.Errorf("cell (%d,%d) has zero plaintext", r, c)
			}
			if cell.Encrypted == 0 {
				t.Errorf("cell (%d,%d) has zero encrypted", r, c)
			}
		}
	}
}

func TestDifficultyModAffectsGrid(t *testing.T) {
	archive := loadTestArchive(t)

	mod := &puzzle.DifficultyMod{GridSizeDelta: 2}
	pz, err := puzzle.Generate(archive, 0, mod)
	if err != nil {
		t.Fatalf("Generate with mod failed: %v", err)
	}

	if pz.Grid.Rows != 10 || pz.Grid.Cols != 14 {
		t.Errorf("expected 10x14 grid with +2 delta, got %dx%d", pz.Grid.Rows, pz.Grid.Cols)
	}
}
