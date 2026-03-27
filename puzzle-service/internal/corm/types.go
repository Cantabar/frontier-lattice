package corm

import (
	"encoding/json"
	"sync"
	"time"
)

// --- Player Events (puzzle-service → corm-brain) ---

// CormEvent is a player action relayed to corm-brain.
type CormEvent struct {
	Type          string          `json:"type"`                      // always "event"
	Seq           uint64          `json:"seq"`                       // monotonic sequence number
	SessionID     string          `json:"session_id"`
	PlayerAddress string          `json:"player_address"`
	NetworkNodeID string          `json:"network_node_id,omitempty"` // set when player links a network node
	Context       string          `json:"context"`                   // "browser" or "ssu:<entity_id>"
	EventType     string          `json:"event_type"`                // "decrypt", "submit", "click", "phase_transition"
	Payload       json.RawMessage `json:"payload"`
	Timestamp     time.Time       `json:"timestamp"`
}

// --- Corm Actions (corm-brain → puzzle-service) ---

// CormAction is a directive from corm-brain dispatched to a player session.
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
)

// --- Action Payloads ---

// LogPayload is for ActionLog.
type LogPayload struct {
	Text string `json:"text"`
}

// LogStreamStartPayload is for ActionLogStreamStart.
type LogStreamStartPayload struct {
	EntryID string `json:"entry_id"`
}

// LogStreamDeltaPayload is for ActionLogStreamDelta.
type LogStreamDeltaPayload struct {
	EntryID string `json:"entry_id"`
	Text    string `json:"text"`
}

// LogStreamEndPayload is for ActionLogStreamEnd.
type LogStreamEndPayload struct {
	EntryID string `json:"entry_id"`
}

// BoostPayload is for ActionBoost.
type BoostPayload struct {
	Cells  []CellRef `json:"cells"`
	Effect string    `json:"effect"` // "glow", "pulse", "echo"
}

// CellRef is a row/col pair used in boost payloads.
type CellRef struct {
	Row int `json:"row"`
	Col int `json:"col"`
}

// DifficultyPayload is for ActionDifficulty.
type DifficultyPayload struct {
	TierDelta     int `json:"tier_delta"`
	DecoyDelta    int `json:"decoy_delta"`
	GridSizeDelta int `json:"grid_size_delta"`
}

// StateSyncPayload is for ActionStateSync.
type StateSyncPayload struct {
	Phase      int `json:"phase"`
	Stability  int `json:"stability"`
	Corruption int `json:"corruption"`
}

// ContractCreatedPayload is for ActionContractCreated.
type ContractCreatedPayload struct {
	ContractID   string `json:"contract_id"`
	ContractType string `json:"contract_type"`
	Description  string `json:"description"`
	Reward       string `json:"reward"`
	Deadline     string `json:"deadline"`
	DetailURL    string `json:"detail_url"`
}

// ContractUpdatedPayload is for ActionContractUpdated.
type ContractUpdatedPayload struct {
	ContractID string `json:"contract_id"`
	Status     string `json:"status"` // "completed", "expired", "cancelled"
}

// HintTogglePayload is for ActionHintToggle (global hint toggle).
type HintTogglePayload struct {
	HintType string `json:"hint_type"` // "heatmap", "vectors", "decode", "signal"
	Enabled  bool   `json:"enabled"`
}

// HintCellPayload is for ActionHintCell (per-cell targeted hints).
type HintCellPayload struct {
	Cells    []CellRef `json:"cells"`
	HintType string    `json:"hint_type"` // "heatmap", "vectors", "signal"
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
		// Drop oldest
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
