package puzzle

import (
	"crypto/rand"
	"math/big"
)

// CipherTier identifies the cipher difficulty level.
type CipherTier int

const (
	TierCaesar   CipherTier = 1 // Fixed shift for entire grid
	TierVariable CipherTier = 2 // Per-row shift values
	TierPosition CipherTier = 3 // Shift = f(row, col)
)

// CipherParams holds the parameters for the active cipher.
type CipherParams struct {
	Tier      CipherTier `json:"-"`
	Shift     int        `json:"-"` // Tier 1: single shift
	RowShifts []int      `json:"-"` // Tier 2: per-row shifts
	// Tier 3 uses a deterministic function of (row, col)
}

// TierForSolveCount returns the cipher tier based on how many puzzles the player has solved.
func TierForSolveCount(solveCount int) CipherTier {
	switch {
	case solveCount < 3:
		return TierCaesar
	case solveCount < 6:
		return TierVariable
	default:
		return TierPosition
	}
}

// NewCipherParams generates cipher parameters for the given tier and grid dimensions.
func NewCipherParams(tier CipherTier, rows int) CipherParams {
	p := CipherParams{Tier: tier}
	switch tier {
	case TierCaesar:
		p.Shift = randRange(3, 23) // avoid trivial shifts
	case TierVariable:
		p.RowShifts = make([]int, rows)
		for i := range p.RowShifts {
			p.RowShifts[i] = randRange(1, 25)
		}
	case TierPosition:
		// Position-based uses a deterministic function; no stored params needed.
	}
	return p
}

// Encrypt applies the cipher to a single rune at position (row, col).
// Only printable runes in the range 0x21–0x7E are shifted (preserving space).
func (p *CipherParams) Encrypt(r rune, row, col int) rune {
	if r < 0x21 || r > 0x7E {
		return r
	}
	shift := p.shiftFor(row, col)
	return shiftRune(r, shift)
}

// Decrypt reverses the cipher for a single rune at position (row, col).
func (p *CipherParams) Decrypt(r rune, row, col int) rune {
	if r < 0x21 || r > 0x7E {
		return r
	}
	shift := p.shiftFor(row, col)
	return shiftRune(r, -shift)
}

func (p *CipherParams) shiftFor(row, col int) int {
	switch p.Tier {
	case TierCaesar:
		return p.Shift
	case TierVariable:
		if row < len(p.RowShifts) {
			return p.RowShifts[row]
		}
		return p.Shift
	case TierPosition:
		// Deterministic position-based shift: (row*7 + col*13 + 5) mod 94
		return (row*7 + col*13 + 5) % 94
	default:
		return 0
	}
}

// shiftRune shifts a rune within the printable ASCII range 0x21–0x7E (94 chars).
func shiftRune(r rune, shift int) rune {
	base := int(r) - 0x21
	rangeSize := 94 // 0x7E - 0x21 + 1
	shifted := ((base + shift) % rangeSize + rangeSize) % rangeSize
	return rune(shifted + 0x21)
}

// randRange returns a cryptographically random int in [min, max].
func randRange(min, max int) int {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(max-min+1)))
	if err != nil {
		return min
	}
	return int(n.Int64()) + min
}
