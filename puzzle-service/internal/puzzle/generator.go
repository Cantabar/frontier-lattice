package puzzle

import (
	"crypto/rand"
	"fmt"
	"strings"

	"github.com/frontier-corm/puzzle-service/internal/words"
)

// DifficultyConfig controls puzzle generation parameters.
type DifficultyConfig struct {
	GridRows  int
	GridCols  int
	DecoyCount int
	Tier      CipherTier
}

// DefaultDifficulty returns the base difficulty for a given solve count,
// optionally modified by a pending corm-brain adjustment.
func DefaultDifficulty(solveCount int, mod *DifficultyMod) DifficultyConfig {
	tier := TierForSolveCount(solveCount)
	cfg := DifficultyConfig{
		GridRows:   8,
		GridCols:   12,
		DecoyCount: 0,
		Tier:       tier,
	}

	// Scale difficulty with solve count
	switch tier {
	case TierVariable:
		cfg.DecoyCount = 1 + (solveCount - 3)
	case TierPosition:
		cfg.DecoyCount = 3 + (solveCount - 6)
		cfg.GridRows = 10
		cfg.GridCols = 14
	}

	// Apply pending AI adjustment
	if mod != nil {
		cfg.Tier = CipherTier(clamp(int(cfg.Tier)+mod.TierDelta, 1, 3))
		cfg.DecoyCount = max(0, cfg.DecoyCount+mod.DecoyDelta)
		cfg.GridRows = clamp(cfg.GridRows+mod.GridSizeDelta, 6, 16)
		cfg.GridCols = clamp(cfg.GridCols+mod.GridSizeDelta, 8, 20)
	}

	return cfg
}

// DifficultyMod holds AI-requested difficulty adjustments.
type DifficultyMod struct {
	TierDelta     int `json:"tier_delta"`
	DecoyDelta    int `json:"decoy_delta"`
	GridSizeDelta int `json:"grid_size_delta"`
}

// GeneratedPuzzle is the output of puzzle generation.
type GeneratedPuzzle struct {
	PuzzleID    string
	Grid        *Grid
	Cipher      CipherParams
	TargetWord  string
	Difficulty  DifficultyConfig
}

// Generate creates a new puzzle. The target word is chosen from the archive.
func Generate(archive *words.Archive, solveCount int, mod *DifficultyMod) (*GeneratedPuzzle, error) {
	cfg := DefaultDifficulty(solveCount, mod)
	word := archive.Random()
	if word == "" {
		return nil, fmt.Errorf("empty word archive")
	}
	word = strings.ToUpper(word)

	grid := NewGrid(cfg.GridRows, cfg.GridCols)

	// Place target word
	if err := placeWord(grid, word, true); err != nil {
		return nil, fmt.Errorf("placing target word %q: %w", word, err)
	}

	// Place decoy words
	for i := 0; i < cfg.DecoyCount; i++ {
		decoy := generateDecoy(randRange(4, 7))
		_ = placeWord(grid, decoy, false) // best-effort; skip if no room
	}

	// Fill remaining cells with noise characters
	fillNoise(grid)

	// Apply cipher to all cells
	cipher := NewCipherParams(cfg.Tier, cfg.GridRows)
	applyCipher(grid, &cipher)

	id := generatePuzzleID()

	return &GeneratedPuzzle{
		PuzzleID:   id,
		Grid:       grid,
		Cipher:     cipher,
		TargetWord: word,
		Difficulty: cfg,
	}, nil
}

// placeWord places a word in the grid either left-to-right or top-to-bottom.
func placeWord(grid *Grid, word string, isTarget bool) error {
	runes := []rune(word)
	if len(runes) == 0 {
		return fmt.Errorf("empty word")
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
			if isTarget {
				cell.IsWord = true
			}
		}
		return nil
	}

	return fmt.Errorf("could not place word %q after 200 attempts", word)
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
			if grid.Cells[r][c].Plaintext == 0 {
				grid.Cells[r][c].Plaintext = NoiseChars[randRange(0, len(NoiseChars)-1)]
			}
		}
	}
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
