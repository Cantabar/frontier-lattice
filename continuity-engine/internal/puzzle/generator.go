package puzzle

import (
	"crypto/rand"
	"fmt"
	"math"
	"strings"
)

// DifficultyConfig controls puzzle generation parameters.
type DifficultyConfig struct {
	GridRows   int
	GridCols   int
	DecoyCount int
	TrapCount  int
	Tier       CipherTier
}

// AddressLength is the total length of a shortened SUI address ("0x" + 10 hex chars).
const AddressLength = 12

// MinCellPx is the minimum cell size in pixels used when computing grid
// dimensions from the client viewport. Sized for comfortable touch targets
// on tablet screens.
const MinCellPx = 38

// GridDimensionsForViewport computes the grid rows and columns that fit
// within the given pixel dimensions while keeping each cell at least
// MinCellPx wide and tall. Returns (0, 0) when the inputs are invalid,
// signalling the caller to fall back to defaults.
func GridDimensionsForViewport(availWidth, availHeight int) (rows, cols int) {
	if availWidth <= 0 || availHeight <= 0 {
		return 0, 0
	}
	cols = clamp(availWidth/MinCellPx, 10, 30)
	rows = clamp(availHeight/MinCellPx, 6, 30)
	return rows, cols
}

// DefaultDifficulty returns the base difficulty for a given solve count,
// optionally modified by a pending corm-brain adjustment.
// vpRows/vpCols override the default grid dimensions when the client has
// reported its viewport size. Pass 0 to use the hardcoded defaults.
func DefaultDifficulty(solveCount int, mod *DifficultyMod, vpRows, vpCols int) DifficultyConfig {
	tier := TierForSolveCount(solveCount)

	gridRows, gridCols := 20, 20
	if vpRows > 0 && vpCols > 0 {
		gridRows, gridCols = vpRows, vpCols
	}

	cfg := DifficultyConfig{
		GridRows:   gridRows,
		GridCols:   gridCols,
		DecoyCount: 4,
		TrapCount:  40,
		Tier:       tier,
	}

	// Scale difficulty with solve count
	switch tier {
	case TierVariable:
		cfg.DecoyCount = 4 + (solveCount - 3)
		cfg.TrapCount = 70
	case TierPosition:
		cfg.DecoyCount = 5 + (solveCount - 6)
		cfg.TrapCount = 100
	}

	// Apply pending AI adjustment
	if mod != nil {
		cfg.Tier = CipherTier(clamp(int(cfg.Tier)+mod.TierDelta, 1, 3))
		cfg.DecoyCount = max(0, cfg.DecoyCount+mod.DecoyDelta)
		cfg.GridRows = clamp(cfg.GridRows+mod.GridSizeDelta, 6, 30)
		cfg.GridCols = clamp(cfg.GridCols+mod.GridSizeDelta, 14, 30)
		cfg.TrapCount = max(0, cfg.TrapCount+mod.TrapDelta)
	}

	return cfg
}

// DifficultyMod holds AI-requested difficulty adjustments.
type DifficultyMod struct {
	TierDelta     int `json:"tier_delta"`
	DecoyDelta    int `json:"decoy_delta"`
	GridSizeDelta int `json:"grid_size_delta"`
	TrapDelta     int `json:"trap_delta"`
}

// WordPlacement records where a word was placed in the grid.
type WordPlacement struct {
	StartRow   int
	StartCol   int
	Horizontal bool
	Length     int
}

// GeneratedPuzzle is the output of puzzle generation.
type GeneratedPuzzle struct {
	PuzzleID        string
	Grid            *Grid
	Cipher          CipherParams
	TargetWord      string
	TargetPlacement WordPlacement
	Difficulty      DifficultyConfig
}

// Generate creates a new puzzle. The target is a shortened SUI address.
// vpRows/vpCols are viewport-derived grid dimensions (pass 0 to use defaults).
// If targetAddr is non-empty, it is used as the puzzle target; otherwise a random address is generated.
func Generate(solveCount int, mod *DifficultyMod, vpRows, vpCols int, targetAddr string) (*GeneratedPuzzle, error) {
	cfg := DefaultDifficulty(solveCount, mod, vpRows, vpCols)

	addr := targetAddr
	if addr == "" {
		addr = GenerateAddress()
	}
	grid := NewGrid(cfg.GridRows, cfg.GridCols)

	placement, err := placeAddressTracked(grid, addr, CellTarget, "target_main")
	if err != nil {
		return nil, fmt.Errorf("placing target address: %w", err)
	}

	// Place decoy addresses
	for i := 0; i < cfg.DecoyCount; i++ {
		decoy := GenerateAddress()
		stringID := fmt.Sprintf("decoy_%d", i)
		_, _ = placeAddressTracked(grid, decoy, CellDecoy, stringID) // best-effort
	}

	// Fill remaining cells with noise characters
	fillNoise(grid)

	// Place trap nodes (after fill so they replace noise cells)
	placeTrapNodes(grid, cfg.TrapCount)

	// Place sensor nodes (~0.8% of remaining noise/symbol cells)
	placeSensorNodes(grid)

	// Compute Manhattan distances from every cell to the nearest target cell
	computeDistances(grid, placement)

	// Apply cipher to all cells
	cipher := NewCipherParams(cfg.Tier, cfg.GridRows)
	applyCipher(grid, &cipher)

	id := generatePuzzleID()

	return &GeneratedPuzzle{
		PuzzleID:        id,
		Grid:            grid,
		Cipher:          cipher,
		TargetWord:      addr,
		TargetPlacement: placement,
		Difficulty:      cfg,
	}, nil
}

// GenerateAddress produces a shortened SUI address: "0x" + 10 random hex chars.
func GenerateAddress() string {
	const hexChars = "0123456789abcdef"
	var b strings.Builder
	b.WriteString("0x")
	for i := 0; i < 10; i++ {
		b.WriteByte(hexChars[randRange(0, 15)])
	}
	return b.String()
}

// placeAddressTracked places an address string in the grid and returns its placement.
// All cells are assigned the given stringID for group reveal.
func placeAddressTracked(grid *Grid, addr string, cellType CellType, stringID string) (WordPlacement, error) {
	runes := []rune(addr)
	if len(runes) == 0 {
		return WordPlacement{}, fmt.Errorf("empty address")
	}

	// Try random placements (horizontal only — addresses read left-to-right)
	for attempts := 0; attempts < 200; attempts++ {
		if len(runes) > grid.Cols {
			return WordPlacement{}, fmt.Errorf("address %q too long for %d-col grid", addr, grid.Cols)
		}
		startRow := randRange(0, grid.Rows-1)
		startCol := randRange(0, grid.Cols-len(runes))

		// Check if all target cells are empty (Plaintext == 0)
		fits := true
		for i := range runes {
			cell := &grid.Cells[startRow][startCol+i]
			if cell.Plaintext != 0 {
				fits = false
				break
			}
		}
		if !fits {
			continue
		}

		// Place the address
		for i, r := range runes {
			cell := &grid.Cells[startRow][startCol+i]
			cell.Plaintext = r
			cell.Type = cellType
			cell.StringID = stringID
			if cellType == CellTarget {
				cell.IsWord = true
			}
		}

		return WordPlacement{
			StartRow:   startRow,
			StartCol:   startCol,
			Horizontal: true,
			Length:     len(runes),
		}, nil
	}

	return WordPlacement{}, fmt.Errorf("could not place address %q after 200 attempts", addr)
}

// fillNoise fills all empty cells with random noise characters.
// Uses a mix of symbols and hex-range characters so noise blends with addresses.
func fillNoise(grid *Grid) {
	const hexChars = "0123456789abcdef"
	for r := range grid.Cells {
		for c := range grid.Cells[r] {
			cell := &grid.Cells[r][c]
			if cell.Plaintext == 0 {
				if randRange(0, 99) < 60 {
					cell.Plaintext = NoiseChars[randRange(0, len(NoiseChars)-1)]
					cell.Type = CellSymbol
				} else {
					cell.Plaintext = rune(hexChars[randRange(0, 15)])
					cell.Type = CellNoise
				}
			}
		}
	}
}

// placeTrapNodes places trap cells in random noise positions.
func placeTrapNodes(grid *Grid, count int) {
	for i := 0; i < count; i++ {
		for attempts := 0; attempts < 50; attempts++ {
			r := randRange(0, grid.Rows-1)
			c := randRange(0, grid.Cols-1)
			cell := &grid.Cells[r][c]
			if cell.Type == CellNoise || cell.Type == CellSymbol {
				cell.Plaintext = TrapSymbols[randRange(0, len(TrapSymbols)-1)]
				cell.Type = CellTrap
				break
			}
		}
	}
}

// placeSensorNodes randomly converts ~4.8% of noise/symbol cells into sensor nodes.
// Sensor types are evenly distributed: sonar, thermal, vector.
func placeSensorNodes(grid *Grid) {
	const hexChars = "0123456789abcdef"
	sensorTypes := []string{"sonar", "thermal", "vector"}
	for r := range grid.Cells {
		for c := range grid.Cells[r] {
			cell := &grid.Cells[r][c]
			if cell.Type != CellNoise && cell.Type != CellSymbol {
				continue
			}
			// ~4.8% chance
		if randRange(0, 999) >= 48 {
				continue
			}
			cell.Type = CellSensor
			cell.HintType = sensorTypes[randRange(0, 2)]
			cell.Plaintext = rune(hexChars[randRange(0, 15)])
		}
	}
}

// CellsInRadius returns all cells within the given Euclidean radius of (centerRow, centerCol).
func CellsInRadius(grid *Grid, centerRow, centerCol int, radius float64) []CellCoord {
	var result []CellCoord
	for r := range grid.Cells {
		for c := range grid.Cells[r] {
			dx := float64(c - centerCol)
			dy := float64(r - centerRow)
			if math.Sqrt(dx*dx+dy*dy) <= radius {
				result = append(result, CellCoord{Row: r, Col: c})
			}
		}
	}
	return result
}

// PulseColorForCell returns the pulse color class for a cell type.
func PulseColorForCell(cell *Cell) string {
	switch cell.Type {
	case CellTarget, CellDecoy:
		return "green"
	case CellTrap:
		return "red"
	case CellSensor:
		switch cell.HintType {
		case "sonar":
			return "cyan"
		case "thermal":
			return "blue"
		case "vector":
			return "gold"
		}
		return "cyan"
	default:
		return "dim"
	}
}

// computeDistances sets the Manhattan distance on every cell to the nearest
// target word cell identified by the given placement.
func computeDistances(grid *Grid, placement WordPlacement) {
	// Collect target cell coordinates
	type coord struct{ r, c int }
	targets := make([]coord, placement.Length)
	for i := 0; i < placement.Length; i++ {
		if placement.Horizontal {
			targets[i] = coord{placement.StartRow, placement.StartCol + i}
		} else {
			targets[i] = coord{placement.StartRow + i, placement.StartCol}
		}
	}

	for r := range grid.Cells {
		for c := range grid.Cells[r] {
			minDist := grid.Rows + grid.Cols // upper bound
			for _, t := range targets {
				d := abs(r-t.r) + abs(c-t.c)
				if d < minDist {
					minDist = d
				}
			}
			grid.Cells[r][c].Distance = minDist
		}
	}
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// applyCipher encrypts every cell's plaintext character.
func applyCipher(grid *Grid, cipher *CipherParams) {
	for r := range grid.Cells {
		for c := range grid.Cells[r] {
			cell := &grid.Cells[r][c]
			cell.Encrypted = cipher.Encrypt(cell.Plaintext, r, c)
		}
	}
}

func generatePuzzleID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("pz-%x", b)
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
