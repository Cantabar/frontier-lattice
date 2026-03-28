package tests

import (
	"testing"

	"github.com/frontier-corm/puzzle-service/internal/puzzle"
)

func TestCaesarRoundTrip(t *testing.T) {
	params := puzzle.NewCipherParams(puzzle.TierCaesar, 8)

	for row := 0; row < 8; row++ {
		for col := 0; col < 12; col++ {
			for _, r := range "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#@%&*" {
				encrypted := params.Encrypt(r, row, col)
				decrypted := params.Decrypt(encrypted, row, col)
				if decrypted != r {
					t.Errorf("Caesar round-trip failed for %q at (%d,%d): got %q", r, row, col, decrypted)
				}
			}
		}
	}
}

func TestVariableShiftRoundTrip(t *testing.T) {
	params := puzzle.NewCipherParams(puzzle.TierVariable, 10)

	for row := 0; row < 10; row++ {
		for col := 0; col < 14; col++ {
			for _, r := range "FRONTIER#@%&*012" {
				encrypted := params.Encrypt(r, row, col)
				decrypted := params.Decrypt(encrypted, row, col)
				if decrypted != r {
					t.Errorf("Variable round-trip failed for %q at (%d,%d): got %q", r, row, col, decrypted)
				}
			}
		}
	}
}

func TestPositionBasedRoundTrip(t *testing.T) {
	params := puzzle.NewCipherParams(puzzle.TierPosition, 12)

	for row := 0; row < 12; row++ {
		for col := 0; col < 16; col++ {
			for _, r := range "XYZ!~{}" {
				encrypted := params.Encrypt(r, row, col)
				decrypted := params.Decrypt(encrypted, row, col)
				if decrypted != r {
					t.Errorf("Position round-trip failed for %q at (%d,%d): got %q", r, row, col, decrypted)
				}
			}
		}
	}
}

func TestEncryptChangesRune(t *testing.T) {
	params := puzzle.CipherParams{Tier: puzzle.TierCaesar, Shift: 5}
	encrypted := params.Encrypt('A', 0, 0)
	if encrypted == 'A' {
		t.Error("expected Caesar shift to change the rune, but it didn't")
	}
}

func TestNoiseCharsRoundTrip(t *testing.T) {
	params := puzzle.NewCipherParams(puzzle.TierCaesar, 8)
	for _, r := range puzzle.NoiseChars {
		encrypted := params.Encrypt(r, 0, 0)
		decrypted := params.Decrypt(encrypted, 0, 0)
		if decrypted != r {
			t.Errorf("NoiseChar round-trip failed for %q: encrypted=%q decrypted=%q", r, encrypted, decrypted)
		}
		if encrypted == r {
			t.Errorf("NoiseChar %q was not changed by encryption (shift=%d)", r, params.Shift)
		}
	}
}

func TestTrapSymbolsRoundTrip(t *testing.T) {
	params := puzzle.NewCipherParams(puzzle.TierCaesar, 8)
	for _, r := range puzzle.TrapSymbols {
		encrypted := params.Encrypt(r, 0, 0)
		decrypted := params.Decrypt(encrypted, 0, 0)
		if decrypted != r {
			t.Errorf("TrapSymbol round-trip failed for %q: encrypted=%q decrypted=%q", r, encrypted, decrypted)
		}
		if encrypted == r {
			t.Errorf("TrapSymbol %q was not changed by encryption (shift=%d)", r, params.Shift)
		}
	}
}

func TestAllCharPoolsInCipherRange(t *testing.T) {
	for _, r := range puzzle.NoiseChars {
		if r < 0x21 || r > 0x7E {
			t.Errorf("NoiseChar %q (U+%04X) is outside cipher range 0x21-0x7E", r, r)
		}
	}
	for _, r := range puzzle.TrapSymbols {
		if r < 0x21 || r > 0x7E {
			t.Errorf("TrapSymbol %q (U+%04X) is outside cipher range 0x21-0x7E", r, r)
		}
	}
}

func TestTierForSolveCount(t *testing.T) {
	tests := []struct {
		solveCount int
		expected   puzzle.CipherTier
	}{
		{0, puzzle.TierCaesar},
		{2, puzzle.TierCaesar},
		{3, puzzle.TierVariable},
		{5, puzzle.TierVariable},
		{6, puzzle.TierPosition},
		{20, puzzle.TierPosition},
	}

	for _, tc := range tests {
		got := puzzle.TierForSolveCount(tc.solveCount)
		if got != tc.expected {
			t.Errorf("TierForSolveCount(%d) = %d, want %d", tc.solveCount, got, tc.expected)
		}
	}
}
