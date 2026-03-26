package puzzle

import (
	"crypto/rand"
	"fmt"
	"strings"

	"github.com/frontier-corm/puzzle-service/internal/words"
)

// DifficultyConfig controls puzzle generation parameters.
type DifficultyConfig struct {
	GridRows   int
	GridCols   int
	DecoyCount int
	TrapCount  int
	Tier       CipherTier
}

// DefaultDifficulty returns the base difficulty for a given solve count,
// optionally modified by a pending corm-brain adjustment.
func DefaultDifficulty(solveCount int, mod *DifficultyMod) DifficultyConfig {
	tier := TierForSolveCount(solveCount)
	cfg := DifficultyConfig{
		GridRows:   8,
		GridCols:   12,
		DecoyCount: 0,
		TrapCount:  4,
		Tier:       tier,
	}

	// Scale difficulty with solve count
	switch tier {
	case TierVariable:
		cfg.DecoyCount = 1 + (solveCount - 3)
		cfg.TrapCount = 7
	case TierPosition:
		cfg.DecoyCount = 3 + (solveCount - 6)
		cfg.GridRows = 10
		cfg.GridCols = 14
		cfg.TrapCount = 10
	}

	// Apply pending AI adjustment
	if mod != nil {
		cfg.Tier = CipherTier(clamp(int(cfg.Tier)+mod.TierDelta, 1, 3))
		cfg.DecoyCount = max(0, cfg.DecoyCount+mod.DecoyDelta)
		cfg.GridRows = clamp(cfg.GridRows+mod.GridSizeDelta, 6, 20)
		cfg.GridCols = clamp(cfg.GridCols+mod.GridSizeDelta, 8, 24)
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

// Generate creates a new puzzle. The target word is chosen from the archive.
func Generate(archive *words.Archive, solveCount int, mod *DifficultyMod) (*GeneratedPuzzle, error) {
	cfg := DefaultDifficulty(solveCount, mod)

	// Try up to 10 words — some may not fit the grid dimensions
	var word string
	var grid *Grid
	var placement WordPlacement
	var err error
	for attempt := 0; attempt < 10; attempt++ {
		word = strings.ToUpper(archive.Random())
		if word == "" {
			return nil, fmt.Errorf("empty word archive")
		}
		// Skip words that can't fit either direction
		if len([]rune(word)) > cfg.GridCols && len([]rune(word)) > cfg.GridRows {
			continue
		}
		grid = NewGrid(cfg.GridRows, cfg.GridCols)
		placement, err = placeWordTracked(grid, word, CellTarget)
		if err == nil {
			break
		}
	}
	if err != nil {
		return nil, fmt.Errorf("placing target word after retries: %w", err)
	}

	// Place decoy words
	for i := 0; i < cfg.DecoyCount; i++ {
		decoy := generateDecoy(randRange(3, 8))
		_, _ = placeWordTracked(grid, decoy, CellDecoy) // best-effort; skip if no room
	}

	// Fill remaining cells with noise characters
	fillNoise(grid)

	// Place trap nodes (after fill so they replace noise cells)
	placeTrapNodes(grid, cfg.TrapCount)

	// Compute Manhattan distances from every cell to the nearest target word cell
	computeDistances(grid, placement)

	// Apply cipher to all cells
	cipher := NewCipherParams(cfg.Tier, cfg.GridRows)
	applyCipher(grid, &cipher)

	id := generatePuzzleID()

	return &GeneratedPuzzle{
		PuzzleID:        id,
		Grid:            grid,
		Cipher:          cipher,
		TargetWord:      word,
		TargetPlacement: placement,
		Difficulty:      cfg,
	}, nil
}

// placeWordTracked places a word in the grid and returns its placement coordinates.
func placeWordTracked(grid *Grid, word string, cellType CellType) (WordPlacement, error) {
	runes := []rune(word)
	if len(runes) == 0 {
		return WordPlacement{}, fmt.Errorf("empty word")
	}

	// Try random placements (horizontal then vertical)
	for attempts := 0; attempts < 200; attempts++ {
		horizontal := randRange(0, 1) == 0
		var startRow, startCol int

		if horizontal {
			if len(runes) > grid.Cols {
				continue
			}
			startRow = randRange(0, grid.Rows-1)
			startCol = randRange(0, grid.Cols-len(runes))
		} else {
			if len(runes) > grid.Rows {
				continue
			}
			startRow = randRange(0, grid.Rows-len(runes))
			startCol = randRange(0, grid.Cols-1)
		}

		// Check if all target cells are empty (Plaintext == 0)
		fits := true
		for i, r := range runes {
			row, col := startRow, startCol
			if horizontal {
				col += i
			} else {
				row += i
			}
			cell := &grid.Cells[row][col]
			if cell.Plaintext != 0 && cell.Plaintext != r {
				fits = false
				break
			}
		}

		if !fits {
			continue
		}

		// Place the word
		for i, r := range runes {
			row, col := startRow, startCol
			if horizontal {
				col += i
			} else {
				row += i
			}
			cell := &grid.Cells[row][col]
			cell.Plaintext = r
			cell.Type = cellType
			if cellType == CellTarget {
				cell.IsWord = true
			}
		}

		return WordPlacement{
			StartRow:   startRow,
			StartCol:   startCol,
			Horizontal: horizontal,
			Length:     len(runes),
		}, nil
	}

	return WordPlacement{}, fmt.Errorf("could not place word %q after 200 attempts", word)
}

// generateDecoy creates a pronounceable but nonsensical word.
func generateDecoy(length int) string {
	vowels := []rune("AEIOU")
	consonants := []rune("BCDFGHJKLMNPQRSTVWXYZ")
	var b []rune
	for i := 0; i < length; i++ {
		if i%2 == 0 {
			b = append(b, consonants[randRange(0, len(consonants)-1)])
		} else {
			b = append(b, vowels[randRange(0, len(vowels)-1)])
		}
	}
	return string(b)
}

// fillNoise fills all empty cells with random noise characters.
func fillNoise(grid *Grid) {
	for r := range grid.Cells {
		for c := range grid.Cells[r] {
			cell := &grid.Cells[r][c]
			if cell.Plaintext == 0 {
				if randRange(0, 99) < 65 {
					cell.Plaintext = NoiseChars[randRange(0, len(NoiseChars)-1)]
					cell.Type = CellSymbol
				} else {
					cell.Plaintext = rune('A' + randRange(0, 25))
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
