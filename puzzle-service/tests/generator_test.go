package tests

import (
	"strings"
	"testing"

	"github.com/frontier-corm/puzzle-service/internal/puzzle"
)

func TestGeneratePuzzle(t *testing.T) {
	pz, err := puzzle.Generate(0, nil, 0, 0, "")
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
	if pz.Grid.Rows != 20 || pz.Grid.Cols != 20 {
		t.Errorf("expected 20x20 grid, got %dx%d", pz.Grid.Rows, pz.Grid.Cols)
	}
}

func TestTargetAddressFormat(t *testing.T) {
	for i := 0; i < 20; i++ {
		addr := puzzle.GenerateAddress()
		if len(addr) != puzzle.AddressLength {
			t.Errorf("expected address length %d, got %d: %q", puzzle.AddressLength, len(addr), addr)
		}
		if !strings.HasPrefix(addr, "0x") {
			t.Errorf("expected address to start with 0x, got %q", addr)
		}
		for _, c := range addr[2:] {
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
				t.Errorf("non-hex character %q in address %q", c, addr)
			}
		}
	}
}

func TestTargetAddressInGrid(t *testing.T) {
	for i := 0; i < 10; i++ {
		pz, err := puzzle.Generate(0, nil, 0, 0, "")
		if err != nil {
			t.Fatalf("Generate failed: %v", err)
		}

		found := false
		for r := 0; r < pz.Grid.Rows; r++ {
			var row []rune
			for c := 0; c < pz.Grid.Cols; c++ {
				row = append(row, pz.Grid.Cells[r][c].Plaintext)
			}
			if strings.Contains(string(row), pz.TargetWord) {
				found = true
				break
			}
		}

		if !found {
			t.Errorf("target address %q not found in grid (iteration %d)", pz.TargetWord, i)
		}
	}
}

func TestTargetCellsHaveStringID(t *testing.T) {
	pz, err := puzzle.Generate(0, nil, 0, 0, "")
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	targetCount := 0
	for r := 0; r < pz.Grid.Rows; r++ {
		for c := 0; c < pz.Grid.Cols; c++ {
			cell := &pz.Grid.Cells[r][c]
			if cell.Type == puzzle.CellTarget {
				targetCount++
				if cell.StringID != "target_main" {
					t.Errorf("target cell (%d,%d) has StringID %q, want \"target_main\"", r, c, cell.StringID)
				}
			}
		}
	}
	if targetCount != puzzle.AddressLength {
		t.Errorf("expected %d target cells, got %d", puzzle.AddressLength, targetCount)
	}
}

func TestDecoyAddressesPlaced(t *testing.T) {
	pz, err := puzzle.Generate(0, nil, 0, 0, "")
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	decoyIDs := make(map[string]bool)
	for r := 0; r < pz.Grid.Rows; r++ {
		for c := 0; c < pz.Grid.Cols; c++ {
			cell := &pz.Grid.Cells[r][c]
			if cell.Type == puzzle.CellDecoy && cell.StringID != "" {
				decoyIDs[cell.StringID] = true
			}
		}
	}

	if len(decoyIDs) == 0 {
		t.Error("expected at least one decoy address")
	}
}

func TestNoCellEmpty(t *testing.T) {
	pz, err := puzzle.Generate(0, nil, 0, 0, "")
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

func TestTrapNodesPlaced(t *testing.T) {
	pz, err := puzzle.Generate(0, nil, 0, 0, "")
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	trapCount := 0
	for r := 0; r < pz.Grid.Rows; r++ {
		for c := 0; c < pz.Grid.Cols; c++ {
			cell := &pz.Grid.Cells[r][c]
			if cell.Type == puzzle.CellTrap {
				trapCount++
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

func TestSensorNodesPlaced(t *testing.T) {
	totalSensors := 0
	validTypes := map[string]bool{"sonar": true, "thermal": true, "vector": true}

	for i := 0; i < 10; i++ {
		pz, err := puzzle.Generate(0, nil, 0, 0, "")
		if err != nil {
			t.Fatalf("Generate failed: %v", err)
		}
		for r := 0; r < pz.Grid.Rows; r++ {
			for c := 0; c < pz.Grid.Cols; c++ {
				cell := &pz.Grid.Cells[r][c]
				if cell.Type == puzzle.CellSensor {
					totalSensors++
					if !validTypes[cell.HintType] {
						t.Errorf("sensor at (%d,%d) has invalid HintType %q", r, c, cell.HintType)
					}
				}
			}
		}
	}

	if totalSensors == 0 {
		t.Error("expected at least one sensor node across 10 puzzles")
	}
}

func TestCellsInRadius(t *testing.T) {
	grid := puzzle.NewGrid(10, 10)

	cells := puzzle.CellsInRadius(grid, 5, 5, 0)
	if len(cells) != 1 {
		t.Errorf("radius 0: expected 1 cell, got %d", len(cells))
	}

	cells = puzzle.CellsInRadius(grid, 5, 5, 1.0)
	if len(cells) < 4 || len(cells) > 5 {
		t.Errorf("radius 1: expected 4-5 cells, got %d", len(cells))
	}

	cells = puzzle.CellsInRadius(grid, 0, 0, 3.0)
	for _, c := range cells {
		if c.Row < 0 || c.Col < 0 || c.Row >= 10 || c.Col >= 10 {
			t.Errorf("cell (%d,%d) is out of bounds", c.Row, c.Col)
		}
	}
}

func TestPulseColorForCell(t *testing.T) {
	tests := []struct {
		cellType puzzle.CellType
		hintType string
		expected string
	}{
		{puzzle.CellTarget, "", "green"},
		{puzzle.CellDecoy, "", "green"},
		{puzzle.CellTrap, "", "red"},
		{puzzle.CellSensor, "sonar", "cyan"},
		{puzzle.CellSensor, "thermal", "blue"},
		{puzzle.CellSensor, "vector", "gold"},
		{puzzle.CellNoise, "", "dim"},
		{puzzle.CellSymbol, "", "dim"},
	}

	for _, tc := range tests {
		cell := &puzzle.Cell{Type: tc.cellType, HintType: tc.hintType}
		got := puzzle.PulseColorForCell(cell)
		if got != tc.expected {
			t.Errorf("PulseColorForCell(type=%d, hint=%q) = %q, want %q", tc.cellType, tc.hintType, got, tc.expected)
		}
	}
}

func TestDifficultyModAffectsGrid(t *testing.T) {
	mod := &puzzle.DifficultyMod{GridSizeDelta: 2}
	pz, err := puzzle.Generate(0, mod, 0, 0, "")
	if err != nil {
		t.Fatalf("Generate with mod failed: %v", err)
	}

	if pz.Grid.Rows != 22 || pz.Grid.Cols != 22 {
		t.Errorf("expected 22x22 grid with +2 delta, got %dx%d", pz.Grid.Rows, pz.Grid.Cols)
	}
}

func TestCellDistancesComputed(t *testing.T) {
	pz, err := puzzle.Generate(0, nil, 0, 0, "")
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
