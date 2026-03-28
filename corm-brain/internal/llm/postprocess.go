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

// SanitizeResponse strips leaked metadata patterns and collapses noisy
// formatting from LLM output. It is applied per-token accumulation,
// so it operates on the full response built so far.
func SanitizeResponse(text string) string {
	// Strip metadata key=value / key:value patterns
	text = metadataPatterns.ReplaceAllString(text, "")

	// Collapse runs of >...>...> into a single >...
	text = repeatedAngleRun.ReplaceAllString(text, ">... ")

	// Collapse multiple spaces left by stripping
	for strings.Contains(text, "  ") {
		text = strings.ReplaceAll(text, "  ", " ")
	}

	return strings.TrimSpace(text)
}
