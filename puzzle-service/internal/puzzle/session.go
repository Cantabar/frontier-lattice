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

// Contract represents a trustless contract the player has access to.
type Contract struct {
	ID           string `json:"id"`
	Address      string `json:"address"`        // full on-chain address
	ShortAddress string `json:"short_address"` // shortened form used as puzzle target (e.g. 0x + 10 hex chars)
	ContractType string `json:"contract_type"` // e.g. CoinForCoin, ItemForCoin, etc.
	Description  string `json:"description"`
	Solved       bool   `json:"solved"`
}

// ShortenAddress returns a 12-char shortened SUI address: "0x" + first 10 hex chars after "0x".
func ShortenAddress(addr string) string {
	if len(addr) > 2 && addr[:2] == "0x" {
		hex := addr[2:]
		if len(hex) > 10 {
			hex = hex[:10]
		}
		return "0x" + hex
	}
	if len(addr) > 12 {
		return addr[:12]
	}
	return addr
}

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

	// Viewport-derived grid dimensions (cached across puzzle loads)
	ViewportRows int
	ViewportCols int

	// Puzzle state
	PuzzleID          string
	Grid              *Grid
	CipherParams      CipherParams
	TargetWord        string
	TargetPlacement   WordPlacement
	DecryptedCells    map[string]bool
	GarbledCells      map[string]bool // permanently corrupted by trap explosion
	TargetDestroyed   bool            // true when a trap explosion garbles any target address cell
	TrapPositions     []CellCoord     // current positions of undecrypted trap nodes
	Difficulty        DifficultyConfig
	SolveCount        int
	IncorrectAttempts int

	// Solve state
	LastSolveCorrect bool

	// Contracts
	Contracts        []Contract
	ActiveContractID string // which contract is currently being puzzled

	// Meters (cached from corm-brain state_sync — retained for corm-brain compatibility)
	Stability  int
	Corruption int

	// AI-controlled hint state
	Hints            HintState
	HintedCells      map[string][]string // cell key -> active hint types (per-cell hints)
	VectorsThreshold int                 // random [4,8] failed clicks before vectors auto-enable
	FailedClicks     int                 // non-target cell decrypts this puzzle

	// AI-guided hint cell: the AI picks a cell for the player to find
	GuidedCell *CellCoord // target cell the AI is guiding toward (nil = none active)
	GuidedHint string     // hint type to reveal when guided cell is clicked
	LastDecrypt *CellCoord // last cell the player decrypted (direction context for AI)

	// Phase 0 click tracking
	ClickLog            []ClickEvent
	ElementClickMap     map[string][]time.Time // element_id -> timestamps
	TransitionThreshold int                    // total clicks to trigger Phase 0 -> 1 (random [3,5])

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

// seedTestContracts returns hardcoded test contracts for development.
func seedTestContracts() []Contract {
	return []Contract{
		{ID: "c1", Address: "0x7a3f8b2c1d9e4f5061", ShortAddress: "0x7a3f8b2c1d", ContractType: "CoinForCoin", Description: "Exchange fuel tokens for mineral credits"},
		{ID: "c2", Address: "0x2e9d4c8a7b1f360582", ShortAddress: "0x2e9d4c8a7b", ContractType: "ItemForCoin", Description: "Sell salvaged components for station currency"},
		{ID: "c3", Address: "0x5b1e9f3a2d7c840693", ShortAddress: "0x5b1e9f3a2d", ContractType: "CoinForItem", Description: "Purchase fabrication blueprints"},
		{ID: "c4", Address: "0x8c4d2f6e1a9b3507a4", ShortAddress: "0x8c4d2f6e1a", ContractType: "Transport", Description: "Staked courier delivery to sector 7G"},
		{ID: "c5", Address: "0x1f7b3e9c5d2a8604b5", ShortAddress: "0x1f7b3e9c5d", ContractType: "ItemForItem", Description: "Barter refined ore for shield modules"},
	}
}

// NewSession creates a fresh session with the given identity.
func NewSession(playerAddress, context string) *Session {
	return &Session{
		ID:              generateSessionID(),
		PlayerAddress:   playerAddress,
		Context:         context,
		Phase:           PhaseAwakening,
		CreatedAt:       time.Now(),
		Contracts:       seedTestContracts(),
		DecryptedCells:  make(map[string]bool),
		GarbledCells:    make(map[string]bool),
		Hints:           HintState{Decode: true, Heatmap: false},
		VectorsThreshold: randVectorsThreshold(),
		HintedCells:     make(map[string][]string),
		ElementClickMap:     make(map[string][]time.Time),
		TransitionThreshold: randRange(3, 5),
		EventBuffer:         corm.NewRingBuffer(256),
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

	// Track last decrypt for AI directional guidance
	s.LastDecrypt = &CellCoord{Row: row, Col: col}

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

// RecordClick adds a Phase 0 click event and returns true if the transition
// threshold has been reached (total clicks across any elements).
func (s *Session) RecordClick(elementID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	s.ClickLog = append(s.ClickLog, ClickEvent{ElementID: elementID, Timestamp: now})
	s.ElementClickMap[elementID] = append(s.ElementClickMap[elementID], now)

	return len(s.ClickLog) >= s.TransitionThreshold
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
	s.GarbledCells = make(map[string]bool)
	s.TargetDestroyed = false
	s.HintedCells = make(map[string][]string)
	s.RecentDecrypts = nil
	s.PendingDifficulty = nil
	s.LastSolveCorrect = false
	s.FailedClicks = 0
	s.TrapPositions = CollectTrapPositions(p.Grid)
	s.VectorsThreshold = randVectorsThreshold()
	s.Hints.Vectors = false
	s.GuidedCell = nil
	s.GuidedHint = ""
	s.LastDecrypt = nil
}

// GetContract returns the contract with the given ID, or nil.
func (s *Session) GetContract(id string) *Contract {
	for i := range s.Contracts {
		if s.Contracts[i].ID == id {
			return &s.Contracts[i]
		}
	}
	return nil
}

// MarkContractSolved marks a contract as solved by ID.
func (s *Session) MarkContractSolved(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.Contracts {
		if s.Contracts[i].ID == id {
			s.Contracts[i].Solved = true
			return
		}
	}
}

// NextUnsolvedContract returns the first unsolved contract, or nil if all solved.
func (s *Session) NextUnsolvedContract() *Contract {
	for i := range s.Contracts {
		if !s.Contracts[i].Solved {
			return &s.Contracts[i]
		}
	}
	return nil
}

// UnsolvedContracts returns all contracts that have not been solved.
func (s *Session) UnsolvedContracts() []Contract {
	var out []Contract
	for _, c := range s.Contracts {
		if !c.Solved {
			out = append(out, c)
		}
	}
	return out
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

// SetGuidedCell sets the AI-guided target cell.
// Rejects out-of-bounds coordinates or already-decrypted cells.
func (s *Session) SetGuidedCell(row, col int, hintType string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Reject if no grid loaded or coordinates are out of bounds.
	if s.Grid == nil || !s.Grid.InBounds(row, col) {
		return
	}

	// Reject if cell is already decrypted (player can't click it).
	if s.DecryptedCells[CellKey(row, col)] {
		return
	}

	s.GuidedCell = &CellCoord{Row: row, Col: col}
	s.GuidedHint = hintType
}

// CheckGuidedCell tests if (row, col) matches the guided cell.
// If it matches, clears the guided state and returns the hint type.
// Returns ("", false) if no match.
func (s *Session) CheckGuidedCell(row, col int) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.GuidedCell != nil && s.GuidedCell.Row == row && s.GuidedCell.Col == col {
		hint := s.GuidedHint
		s.GuidedCell = nil
		s.GuidedHint = ""
		return hint, true
	}
	return "", false
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

// MoveRevealedTraps moves trap nodes that were revealed by a sonar pulse
// toward the pulse source and updates TrapPositions accordingly.
func (s *Session) MoveRevealedTraps(pulseRow, pulseCol int, pulsedCells []CellCoord) []TrapMoveResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Grid == nil {
		return nil
	}

	moves := MoveRevealedTraps(s.Grid, pulseRow, pulseCol, pulsedCells, s.DecryptedCells, s.GarbledCells)
	if len(moves) > 0 {
		s.TrapPositions = CollectTrapPositions(s.Grid)
	}
	return moves
}

// RemoveTrapPosition removes a trap from TrapPositions (e.g. after garbling).
func (s *Session) RemoveTrapPosition(row, col int) {
	for i, pos := range s.TrapPositions {
		if pos.Row == row && pos.Col == col {
			s.TrapPositions = append(s.TrapPositions[:i], s.TrapPositions[i+1:]...)
			return
		}
	}
}

// randVectorsThreshold returns a random int in [4, 8].
func randVectorsThreshold() int {
	return randRange(4, 8)
}

// RecordFailedClick increments the failed click counter and returns true
// if vectors should be auto-enabled (threshold just reached).
func (s *Session) RecordFailedClick() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.FailedClicks++
	return !s.Hints.Vectors && s.FailedClicks >= s.VectorsThreshold
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
