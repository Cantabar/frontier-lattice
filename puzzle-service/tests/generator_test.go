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

func TestTrapNodesPlaced(t *testing.T) {
	archive := loadTestArchive(t)

	pz, err := puzzle.Generate(archive, 0, nil)
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	trapCount := 0
	for r := 0; r < pz.Grid.Rows; r++ {
		for c := 0; c < pz.Grid.Cols; c++ {
			cell := &pz.Grid.Cells[r][c]
			if cell.Type == puzzle.CellTrap {
				trapCount++
				// Trap should not overlap with target word
				if cell.IsWord {
					t.Errorf("trap at (%d,%d) overlaps with target word", r, c)
				}
			}
		}
	}

	if trapCount == 0 {
		t.Error("expected at least one trap node")
	}
}

func TestCellDistancesComputed(t *testing.T) {
	archive := loadTestArchive(t)

	pz, err := puzzle.Generate(archive, 0, nil)
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	hasZero := false
	for r := 0; r < pz.Grid.Rows; r++ {
		for c := 0; c < pz.Grid.Cols; c++ {
			cell := &pz.Grid.Cells[r][c]
			if cell.Distance < 0 {
				t.Errorf("cell (%d,%d) has negative distance %d", r, c, cell.Distance)
			}
			if cell.Distance == 0 && cell.Type == puzzle.CellTarget {
				hasZero = true
			}
		}
	}

	if !hasZero {
		t.Error("expected at least one target cell with distance 0")
	}
}

func TestDecoysAtTier1WithMod(t *testing.T) {
	archive := loadTestArchive(t)

	mod := &puzzle.DifficultyMod{DecoyDelta: 3}
	pz, err := puzzle.Generate(archive, 0, mod)
	if err != nil {
		t.Fatalf("Generate with decoy mod failed: %v", err)
	}

	// Count decoy cells
	decoyCount := 0
	for r := 0; r < pz.Grid.Rows; r++ {
		for c := 0; c < pz.Grid.Cols; c++ {
			if pz.Grid.Cells[r][c].Type == puzzle.CellDecoy {
				decoyCount++
			}
		}
	}

	if decoyCount == 0 {
		t.Error("expected decoy cells at Tier 1 when DecoyDelta > 0")
	}
}

func TestLargeGridGeneration(t *testing.T) {
	archive := loadTestArchive(t)

	mod := &puzzle.DifficultyMod{GridSizeDelta: 12} // 8+12=20 rows, 12+12=24 cols
	pz, err := puzzle.Generate(archive, 0, mod)
	if err != nil {
		t.Fatalf("Generate large grid failed: %v", err)
	}

	if pz.Grid.Rows != 20 || pz.Grid.Cols != 24 {
		t.Errorf("expected 20x24 grid, got %dx%d", pz.Grid.Rows, pz.Grid.Cols)
	}

	// Verify target word is still in the grid
	word := strings.ToUpper(pz.TargetWord)
	found := false
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
		t.Errorf("target word %q not found in 20x24 grid", word)
	}
}
