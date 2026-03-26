package puzzle

import (
	"crypto/rand"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/frontier-corm/puzzle-service/internal/corm"
)

// SessionContextKey is the context key for storing the session.
var SessionContextKey = contextKey("session")

type contextKey string

// Phase represents the current game phase.
type Phase int

const (
	PhaseAwakening Phase = 0
	PhasePuzzle    Phase = 1
	PhaseContracts Phase = 2
)

// HintState tracks which AI-controlled hint systems are globally enabled.
type HintState struct {
	Heatmap bool // proximity-based cell coloring
	Vectors bool // directional indicators toward target
	Decode  bool // true = revealed cells show plaintext (default true)
	Signal  bool // per-decrypt signal intensity feedback
}

// Session holds all state for one player's interaction.
type Session struct {
	mu sync.Mutex

	ID            string
	PlayerAddress string
	Context       string // "browser" or "ssu:<entity_id>"
	Phase         Phase
	CreatedAt     time.Time

	// Puzzle state
	PuzzleID          string
	Grid              *Grid
	CipherParams      CipherParams
	TargetWord        string
	TargetPlacement   WordPlacement
	DecryptedCells    map[string]bool
	Difficulty        DifficultyConfig
	SolveCount        int
	IncorrectAttempts int

	// Meters (cached from corm-brain state_sync)
	Stability  int
	Corruption int

	// AI-controlled hint state
	Hints       HintState
	HintedCells map[string][]string // cell key -> active hint types (per-cell hints)

	// Phase 0 click tracking
	ClickLog        []ClickEvent
	ElementClickMap map[string][]time.Time // element_id -> timestamps

	// Corm integration
	EventBuffer        *corm.RingBuffer
	ActionChan         chan corm.CormAction
	PendingDifficulty  *DifficultyMod
	RecentDecrypts     []CellCoord
	ActiveLogStream    *LogStreamState
}

// ClickEvent records a Phase 0 interaction.
type ClickEvent struct {
	ElementID string    `json:"element_id"`
	Timestamp time.Time `json:"timestamp"`
}

// LogStreamState tracks an in-progress streaming log entry.
type LogStreamState struct {
	EntryID string
	Text    strings.Builder
}

// NewSession creates a fresh session with the given identity.
func NewSession(playerAddress, context string) *Session {
	return &Session{
		ID:              generateSessionID(),
		PlayerAddress:   playerAddress,
		Context:         context,
		Phase:           PhaseAwakening,
		CreatedAt:       time.Now(),
		DecryptedCells:  make(map[string]bool),
		Hints:           HintState{Decode: true},
		HintedCells:     make(map[string][]string),
		ElementClickMap: make(map[string][]time.Time),
		EventBuffer:     corm.NewRingBuffer(256),
		ActionChan:      make(chan corm.CormAction, 64),
	}
}

// CellKey returns the map key for a cell coordinate.
func CellKey(row, col int) string {
	return fmt.Sprintf("%d-%d", row, col)
}

// DecryptCell reveals a cell and returns true if it was newly decrypted.
func (s *Session) DecryptCell(row, col int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := CellKey(row, col)
	if s.DecryptedCells[key] {
		return false // already decrypted
	}
	s.DecryptedCells[key] = true

	// Track recent decrypts for boost targeting
	s.RecentDecrypts = append(s.RecentDecrypts, CellCoord{Row: row, Col: col})
	if len(s.RecentDecrypts) > 20 {
		s.RecentDecrypts = s.RecentDecrypts[len(s.RecentDecrypts)-20:]
	}

	return true
}

// CheckWord tests a submitted word against the target. Returns true on match.
func (s *Session) CheckWord(word string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.EqualFold(word, s.TargetWord)
}

// RecordClick adds a Phase 0 click event and returns true if frustration triggered.
func (s *Session) RecordClick(elementID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	s.ClickLog = append(s.ClickLog, ClickEvent{ElementID: elementID, Timestamp: now})
	s.ElementClickMap[elementID] = append(s.ElementClickMap[elementID], now)

	// Frustration detection: 3+ clicks on same element within 2 seconds
	timestamps := s.ElementClickMap[elementID]
	if len(timestamps) >= 3 {
		recent := timestamps[len(timestamps)-3:]
		if recent[2].Sub(recent[0]) <= 2*time.Second {
			return true
		}
	}
	return false
}

// TransitionToPhase1 moves the session from Phase 0 to Phase 1.
func (s *Session) TransitionToPhase1() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Phase = PhasePuzzle
}

// LoadPuzzle sets the active puzzle on the session.
func (s *Session) LoadPuzzle(p *GeneratedPuzzle) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.PuzzleID = p.PuzzleID
	s.Grid = p.Grid
	s.CipherParams = p.Cipher
	s.TargetWord = p.TargetWord
	s.TargetPlacement = p.TargetPlacement
	s.Difficulty = p.Difficulty
	s.DecryptedCells = make(map[string]bool)
	s.HintedCells = make(map[string][]string)
	s.RecentDecrypts = nil
	s.PendingDifficulty = nil
}

// SetHint updates a global hint toggle.
func (s *Session) SetHint(hintType string, enabled bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch hintType {
	case "heatmap":
		s.Hints.Heatmap = enabled
	case "vectors":
		s.Hints.Vectors = enabled
	case "decode":
		s.Hints.Decode = enabled
	case "signal":
		s.Hints.Signal = enabled
	}
}

// AddCellHint adds a per-cell hint.
func (s *Session) AddCellHint(row, col int, hintType string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := CellKey(row, col)
	s.HintedCells[key] = append(s.HintedCells[key], hintType)
}

// CellHasHint returns true if a cell has the given hint type (per-cell or global).
func (s *Session) CellHasHint(row, col int, hintType string) bool {
	// Check global toggle first
	switch hintType {
	case "heatmap":
		if s.Hints.Heatmap {
			return true
		}
	case "vectors":
		if s.Hints.Vectors {
			return true
		}
	case "signal":
		if s.Hints.Signal {
			return true
		}
	}
	// Check per-cell hints
	key := CellKey(row, col)
	for _, h := range s.HintedCells[key] {
		if h == hintType {
			return true
		}
	}
	return false
}

func generateSessionID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}

// --- ActionTarget interface (for corm.Relay) ---

// GetID implements corm.ActionTarget.
func (s *Session) GetID() string { return s.ID }

// GetPlayerAddress implements corm.ActionTarget.
func (s *Session) GetPlayerAddress() string { return s.PlayerAddress }

// GetContext implements corm.ActionTarget.
func (s *Session) GetContext() string { return s.Context }

// GetEventBuffer implements corm.ActionTarget.
func (s *Session) GetEventBuffer() *corm.RingBuffer { return s.EventBuffer }

// GetActionChan implements corm.ActionTarget.
func (s *Session) GetActionChan() chan corm.CormAction { return s.ActionChan }

// --- Session Store ---

// SessionStore is a thread-safe in-memory store for sessions.
type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

// NewSessionStore creates a new empty store.
func NewSessionStore() *SessionStore {
	return &SessionStore{
		sessions: make(map[string]*Session),
	}
}

// Get retrieves a session by ID. Returns nil if not found.
func (ss *SessionStore) Get(id string) *Session {
	ss.mu.RLock()
	defer ss.mu.RUnlock()
	return ss.sessions[id]
}

// Put stores a session.
func (ss *SessionStore) Put(s *Session) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	ss.sessions[s.ID] = s
}

// All returns all active sessions (for event fan-out).
func (ss *SessionStore) All() []*Session {
	ss.mu.RLock()
	defer ss.mu.RUnlock()
	out := make([]*Session, 0, len(ss.sessions))
	for _, s := range ss.sessions {
		out = append(out, s)
	}
	return out
}

// --- SessionStoreAdapter satisfies corm.SessionLookup ---

// SessionStoreAdapter wraps SessionStore to satisfy corm.SessionLookup.
type SessionStoreAdapter struct {
	Store *SessionStore
}

// Get returns a session as a corm.ActionTarget.
func (a *SessionStoreAdapter) Get(id string) corm.ActionTarget {
	s := a.Store.Get(id)
	if s == nil {
		return nil
	}
	return s
}

// All returns all sessions as corm.ActionTarget.
func (a *SessionStoreAdapter) All() []corm.ActionTarget {
	sessions := a.Store.All()
	out := make([]corm.ActionTarget, len(sessions))
	for i, s := range sessions {
		out[i] = s
	}
	return out
}
