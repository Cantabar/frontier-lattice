package llm

import (
	"math/rand"
	"regexp"
	"strings"
	"unicode/utf8"
)

// garbleChars are substitution characters used when corruption is high.
var garbleChars = []rune{'░', '▓', '█', '╳', '?', '#', '@', '%', '&', '!', '~'}

// PostProcessToken applies corruption garbling to a single token delta.
// corruption is 0-100. At corruption=0, text passes through unchanged.
// At corruption=100, most characters are replaced with noise.
func PostProcessToken(token string, corruption float64) string {
	if corruption < 10 {
		return token
	}

	// Probability of garbling any character: corruption/200 (max 50% at corruption=100)
	prob := corruption / 200.0
	var b strings.Builder
	b.Grow(len(token))

	for _, r := range token {
		if r == ' ' || r == '\n' {
			b.WriteRune(r)
			continue
		}
		if rand.Float64() < prob {
			b.WriteRune(garbleChars[rand.Intn(len(garbleChars))])
		} else {
			b.WriteRune(r)
		}
	}

	return b.String()
}

// TruncateResponse enforces a maximum character length on the full response.
func TruncateResponse(text string, maxChars int) string {
	if utf8.RuneCountInString(text) <= maxChars {
		return text
	}
	runes := []rune(text)
	return string(runes[:maxChars]) + "..."
}

// metadataPatterns matches leaked event metadata the LLM may parrot back.
var metadataPatterns = regexp.MustCompile(
	`(?i)>?\s*` + // optional > prefix
		`(?:` +
		`element_id\s*[:=]\s*\S+` +
		`|click_count\s*[:=]\s*\S+` +
		`|baseline_?deviation\s*[:=]\s*\S+` +
		`|frustrated\s*[:=]\s*\S+` +
		`|is_trap\s*[:=]\s*\S+` +
		`|is_word\s*[:=]\s*\S+` +
		`|plaintext\s*[:=]\s*\S+` +
		`|distance\s*[:=]\s*\S+` +
		`|row\s*[:=]\s*\d+` +
		`|col\s*[:=]\s*\d+` +
		`|seq\s*[:=]\s*\d+` +
		`|session_id\s*[:=]\s*\S+` +
		`|player_address\s*[:=]\s*\S+` +
		`|network_node_id\s*[:=]\s*\S+` +
		`)`,
)

// repeatedAngleRun collapses >...>...> chains into a single line.
var repeatedAngleRun = regexp.MustCompile(`(>\s*\.{2,}\s*){2,}`)

// anglePrefix matches a leading "> " or ">" at the start of a line.
var anglePrefix = regexp.MustCompile(`(?m)^>\s*`)

// ellipsisRun matches runs of 2+ dots (e.g. ".." or "...").
var ellipsisRun = regexp.MustCompile(`\.{2,}`)

// standaloneAngle matches ">" characters that are not part of a word.
var standaloneAngle = regexp.MustCompile(`(^|\s)>+(\s|$)`)

// IsValidResponse returns true if the text contains at least one word with
// 2+ alphabetic characters. Single characters, bare symbols, and garble-only
// output are rejected.
func IsValidResponse(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}

	// Count total alphabetic characters.
	alphaCount := 0
	for _, r := range trimmed {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			alphaCount++
		}
	}
	if alphaCount < 2 {
		return false
	}

	// Require at least one word with 2+ alpha runes.
	for _, word := range strings.Fields(trimmed) {
		wordAlpha := 0
		for _, r := range word {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
				wordAlpha++
			}
		}
		if wordAlpha >= 2 {
			return true
		}
	}
	return false
}

// SanitizeResponse strips leaked metadata patterns, angle-bracket prefixes,
// ellipsis runs, and collapses noisy formatting from LLM output.
func SanitizeResponse(text string) string {
	// Strip metadata key=value / key:value patterns
	text = metadataPatterns.ReplaceAllString(text, "")

	// Collapse runs of >...>...> into nothing
	text = repeatedAngleRun.ReplaceAllString(text, "")

	// Strip leading "> " prefix from each line
	text = anglePrefix.ReplaceAllString(text, "")

	// Remove standalone ">" characters not part of words
	text = standaloneAngle.ReplaceAllString(text, " ")

	// Collapse ellipsis runs to empty string
	text = ellipsisRun.ReplaceAllString(text, "")

	// Collapse multiple spaces left by stripping
	for strings.Contains(text, "  ") {
		text = strings.ReplaceAll(text, "  ", " ")
	}

	return strings.TrimSpace(text)
}
