package words

import (
	"crypto/rand"
	_ "embed"
	"encoding/json"
	"fmt"
	"math/big"
)

//go:embed words.json
var wordsJSON []byte

// Archive holds the deduplicated word list.
type Archive struct {
	words []string
}

// LoadArchive parses the embedded words.json file.
func LoadArchive() (*Archive, error) {
	var words []string
	if err := json.Unmarshal(wordsJSON, &words); err != nil {
		return nil, fmt.Errorf("parsing words.json: %w", err)
	}
	if len(words) == 0 {
		return nil, fmt.Errorf("words.json is empty")
	}
	return &Archive{words: words}, nil
}

// Len returns the number of words in the archive.
func (a *Archive) Len() int {
	return len(a.words)
}

// Random returns a random word from the archive.
func (a *Archive) Random() string {
	if len(a.words) == 0 {
		return ""
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(a.words))))
	if err != nil {
		return a.words[0]
	}
	return a.words[n.Int64()]
}
