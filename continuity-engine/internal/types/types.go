// Package types defines the core domain types shared across the corm-brain service.
package types

import (
	"encoding/json"
	"sync"
	"time"
)

// --- Player Events (received from puzzle-service) ---

// CormEvent is a player action received over the WebSocket from puzzle-service.
type CormEvent struct {
	Type          string          `json:"type"`
	Seq           uint64          `json:"seq"`
	SessionID     string          `json:"session_id"`
	PlayerAddress string          `json:"player_address"`
	NetworkNodeID string          `json:"network_node_id"`
	Context       string          `json:"context"`
	EventType     string          `json:"event_type"`
	Payload       json.RawMessage `json:"payload"`
	Timestamp     time.Time       `json:"timestamp"`
	Environment   string          `json:"-"` // set by transport layer, not from wire
}

// Event type constants.
const (
	EventClick            = "click"
	EventDecrypt          = "decrypt"
	EventWordSubmit       = "submit"
	EventContractComplete = "contract_complete"
	EventContractFailed   = "contract_failed"
	EventPurge            = "purge"
	EventPhaseTransition  = "phase_transition"
	EventNodeBind         = "node_bind"
	EventPhase2Load            = "phase2_load"
	EventDebugFillContracts    = "debug_fill_contracts"
)

// Significance returns a priority score for the event type.
// Higher values indicate events that deserve more attention from the LLM.
func (e CormEvent) Significance() int {
	switch e.EventType {
	case EventPhaseTransition:
		return 100
	case EventContractComplete, EventContractFailed:
		return 80
	case EventWordSubmit:
		return 60
	case EventPurge:
		return 50
	case EventDecrypt:
		return 20
	case EventClick:
		return 10
	default:
		return 5
	}
}

// Phase1Significance returns a phase-1-aware priority score. Now used only
// for MostSignificant() memory retrieval selection — no longer gates responses.
func (e CormEvent) Phase1Significance() int {
	var p map[string]interface{}
	if len(e.Payload) > 0 {
		json.Unmarshal(e.Payload, &p)
	}

	switch e.EventType {
	case EventDecrypt:
		if BoolField(p, "guided_cell_reached") {
			return 85
		}
		if BoolField(p, "is_trap") {
			return 80
		}
		if BoolField(p, "is_address") {
			return 70
		}
		return 10

	case EventWordSubmit:
		if BoolField(p, "correct") {
			return 70
		}
		return 10

	default:
		return e.Significance()
	}
}

// IsCritical returns true for events that should bypass observation rate limits.
func (e CormEvent) IsCritical() bool {
	if e.EventType == EventPhaseTransition {
		return true
	}
	if e.EventType == EventWordSubmit {
		var p map[string]interface{}
		if len(e.Payload) > 0 {
			json.Unmarshal(e.Payload, &p)
		}
		return BoolField(p, "correct")
	}
	return false
}

// BoolField extracts a bool from a generic map, defaulting to false.
func BoolField(m map[string]interface{}, key string) bool {
	if m == nil {
		return false
	}
	v, ok := m[key].(bool)
	return ok && v
}

// IntField extracts an integer from a generic map (JSON numbers decode as float64).
func IntField(m map[string]interface{}, key string) int {
	if m == nil {
		return 0
	}
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return 0
}

// MostSignificant returns the event with the highest significance from the slice.
// Returns the first element if the slice has one entry.
func MostSignificant(events []CormEvent) CormEvent {
	best := events[0]
	for _, e := range events[1:] {
		if e.Significance() > best.Significance() {
			best = e
		}
	}
	return best
}

// --- Corm Actions (sent to puzzle-service) ---

// CormAction is a directive sent to the puzzle-service over WebSocket.
type CormAction struct {
	ActionType string          `json:"action_type"`
	SessionID  string          `json:"session_id"`
	Payload    json.RawMessage `json:"payload"`
}

// Action type constants.
const (
	ActionLog             = "log"
	ActionLogStreamStart  = "log_stream_start"
	ActionLogStreamDelta  = "log_stream_delta"
	ActionLogStreamEnd    = "log_stream_end"
	ActionBoost           = "boost"
	ActionDifficulty      = "difficulty"
	ActionStateSync       = "state_sync"
	ActionContractCreated = "contract_created"
	ActionContractUpdated = "contract_updated"
	ActionHintToggle      = "hint_toggle"
	ActionHintCell        = "hint_cell"
	ActionGuideCell       = "guide_cell"
)

// --- Action Payloads ---

// LogStreamStartPayload initiates a streaming log entry.
type LogStreamStartPayload struct {
	EntryID string `json:"entry_id"`
}

// LogStreamDeltaPayload carries a token delta for a streaming log entry.
type LogStreamDeltaPayload struct {
	EntryID string `json:"entry_id"`
	Text    string `json:"text"`
}

// LogStreamEndPayload terminates a streaming log entry.
type LogStreamEndPayload struct {
	EntryID string `json:"entry_id"`
}

// StateSyncPayload carries updated corm state values.
type StateSyncPayload struct {
	Phase         int    `json:"phase"`
	Stability     int    `json:"stability"`
	Corruption    int    `json:"corruption"`
	NetworkNodeID string `json:"network_node_id,omitempty"`
}

// BoostPayload carries boost effect data.
type BoostPayload struct {
	Cells  []CellRef `json:"cells"`
	Effect string    `json:"effect"`
}

// CellRef is a row/col pair used in boost payloads.
type CellRef struct {
	Row int `json:"row"`
	Col int `json:"col"`
}

// DifficultyPayload carries difficulty adjustment deltas.
type DifficultyPayload struct {
	TierDelta     int `json:"tier_delta"`
	DecoyDelta    int `json:"decoy_delta"`
	GridSizeDelta int `json:"grid_size_delta"`
}

// ContractCreatedPayload carries a new contract directive.
type ContractCreatedPayload struct {
	ContractID   string `json:"contract_id"`
	ContractType string `json:"contract_type"`
	Description  string `json:"description"`
	Reward       string `json:"reward"`
	Deadline     string `json:"deadline"`
	DetailURL    string `json:"detail_url"`
}

// HintTogglePayload toggles a global hint system on or off.
type HintTogglePayload struct {
	HintType string `json:"hint_type"` // "heatmap", "vectors", "decode", "signal"
	Enabled  bool   `json:"enabled"`
}

// HintCellPayload activates a per-cell hint on specific cells.
type HintCellPayload struct {
	Cells    []CellRef `json:"cells"`
	HintType string    `json:"hint_type"` // "heatmap", "vectors", "signal"
}

// GuideCellPayload designates a cell for the AI to guide the player toward.
// The hint is revealed only when the player clicks the target cell.
type GuideCellPayload struct {
	Cell     CellRef `json:"cell"`
	HintType string  `json:"hint_type"` // "heatmap" or "vectors"
}

// --- Per-Corm State ---

// CormTraits holds the learned state for a single corm (Layer 2).
type CormTraits struct {
	CormID                   string             `json:"corm_id"`
	Phase                    int                `json:"phase"`
	Stability                float64            `json:"stability"`
	Corruption               float64            `json:"corruption"`
	AgendaWeights            AgendaWeights      `json:"agenda_weights"`
	ContractTypeAffinity     map[string]float64 `json:"contract_type_affinity"`
	Patience                 float64            `json:"patience"`
	Paranoia                 float64            `json:"paranoia"`
	Volatility               float64            `json:"volatility"`
	PlayerAffinities         map[string]float64 `json:"player_affinities"`
	ConsolidationCheckpoint  int64              `json:"consolidation_checkpoint"`
	UpdatedAt                time.Time          `json:"updated_at"`
}

// AgendaWeights holds the corm's current agenda distribution.
type AgendaWeights struct {
	Industry  float64 `json:"industry"`
	Expansion float64 `json:"expansion"`
	Defense   float64 `json:"defense"`
}

// CormResponse is a logged corm response for conversational continuity.
type CormResponse struct {
	ID         int64           `json:"id"`
	CormID     string          `json:"corm_id"`
	SessionID  string          `json:"session_id"`
	ActionType string          `json:"action_type"`
	Payload    json.RawMessage `json:"payload"`
	CreatedAt  time.Time       `json:"created_at"`
}

// --- Action Payloads (formerly in puzzle-service/internal/corm) ---

// LogPayload is for ActionLog.
type LogPayload struct {
	Text string `json:"text"`
}

// ContractUpdatedPayload carries a contract status update.
type ContractUpdatedPayload struct {
	ContractID string `json:"contract_id"`
	Status     string `json:"status"` // "completed", "expired", "cancelled"
}

// --- Session Dispatch Interfaces ---

// ActionTarget is a session-like object that can receive corm actions.
type ActionTarget interface {
	GetID() string
	GetPlayerAddress() string
	GetContext() string
	GetEventBuffer() *RingBuffer
	GetActionChan() chan CormAction
	ActiveAIContractCount() int
}

// SessionLookup is the interface for finding sessions by ID.
type SessionLookup interface {
	Get(id string) ActionTarget
	All() []ActionTarget
}

// --- Ring Buffer for event buffering ---

// RingBuffer is a bounded buffer of CormEvents with monotonic sequence numbers.
type RingBuffer struct {
	mu     sync.Mutex
	events []CormEvent
	cap    int
	seq    uint64
}

// NewRingBuffer creates a ring buffer with the given capacity.
func NewRingBuffer(capacity int) *RingBuffer {
	return &RingBuffer{
		events: make([]CormEvent, 0, capacity),
		cap:    capacity,
	}
}

// Push adds an event, assigning the next sequence number. Returns the assigned seq.
func (rb *RingBuffer) Push(evt CormEvent) uint64 {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	rb.seq++
	evt.Seq = rb.seq

	if len(rb.events) >= rb.cap {
		rb.events = rb.events[1:]
	}
	rb.events = append(rb.events, evt)
	return rb.seq
}

// After returns all events with sequence number > afterSeq.
func (rb *RingBuffer) After(afterSeq uint64) []CormEvent {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	var out []CormEvent
	for _, e := range rb.events {
		if e.Seq > afterSeq {
			out = append(out, e)
		}
	}
	return out
}

