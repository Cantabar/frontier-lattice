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
