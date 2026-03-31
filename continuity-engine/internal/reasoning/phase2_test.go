package reasoning

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/frontier-corm/continuity-engine/internal/chain"
	"github.com/frontier-corm/continuity-engine/internal/dispatch"
	"github.com/frontier-corm/continuity-engine/internal/types"
)

// mockSession implements types.ActionTarget for test use.
type mockSession struct {
	id         string
	actionChan chan types.CormAction
}

func (m *mockSession) GetID() string                      { return m.id }
func (m *mockSession) GetPlayerAddress() string            { return "" }
func (m *mockSession) GetContext() string                  { return "" }
func (m *mockSession) GetEventBuffer() *types.RingBuffer   { return types.NewRingBuffer(8) }
func (m *mockSession) GetActionChan() chan types.CormAction { return m.actionChan }
func (m *mockSession) ActiveAIContractCount() int          { return 0 }

// mockSessionLookup implements types.SessionLookup.
type mockSessionLookup struct {
	sessions map[string]types.ActionTarget
}

func (m *mockSessionLookup) Get(id string) types.ActionTarget { return m.sessions[id] }
func (m *mockSessionLookup) All() []types.ActionTarget {
	var out []types.ActionTarget
	for _, s := range m.sessions {
		out = append(out, s)
	}
	return out
}

// drainActions reads all actions from the channel until it's empty or timeout.
func drainActions(ch chan types.CormAction, timeout time.Duration) []types.CormAction {
	var actions []types.CormAction
	deadline := time.After(timeout)
	for {
		select {
		case a := <-ch:
			actions = append(actions, a)
		case <-deadline:
			return actions
		}
	}
}

func TestSendEmptyStateFeedback_DispatchesContractStatus(t *testing.T) {
	actionChan := make(chan types.CormAction, 16)
	sess := &mockSession{id: "test-session", actionChan: actionChan}
	lookup := &mockSessionLookup{sessions: map[string]types.ActionTarget{"test-session": sess}}
	eventChan := make(chan types.CormEvent, 8)
	d := dispatch.New(lookup, eventChan)

	h := &Handler{
		dispatcher:     d,
		recipeRegistry: chain.NewRecipeRegistry(),
	}

	traits := &types.CormTraits{Corruption: 20}

	sendEmptyStateFeedback(context.Background(), h, "corm-abc", "test-session", traits)

	actions := drainActions(actionChan, 200*time.Millisecond)

	// Expect: log_stream_start, log_stream_delta, log_stream_end, contract_status
	if len(actions) != 4 {
		t.Fatalf("expected 4 actions, got %d", len(actions))
	}

	if actions[0].ActionType != types.ActionLogStreamStart {
		t.Errorf("action[0]: expected log_stream_start, got %s", actions[0].ActionType)
	}
	if actions[1].ActionType != types.ActionLogStreamDelta {
		t.Errorf("action[1]: expected log_stream_delta, got %s", actions[1].ActionType)
	}
	if actions[2].ActionType != types.ActionLogStreamEnd {
		t.Errorf("action[2]: expected log_stream_end, got %s", actions[2].ActionType)
	}
	if actions[3].ActionType != types.ActionContractStatus {
		t.Fatalf("action[3]: expected contract_status, got %s", actions[3].ActionType)
	}

	var payload types.ContractStatusPayload
	if err := json.Unmarshal(actions[3].Payload, &payload); err != nil {
		t.Fatalf("unmarshal contract_status payload: %v", err)
	}
	if payload.Status != "empty" {
		t.Errorf("expected status 'empty', got %q", payload.Status)
	}
	if payload.Message == "" {
		t.Error("expected non-empty message in contract_status payload")
	}
}

func TestSendEmptyStateFeedback_HighCorruption(t *testing.T) {
	actionChan := make(chan types.CormAction, 16)
	sess := &mockSession{id: "test-session", actionChan: actionChan}
	lookup := &mockSessionLookup{sessions: map[string]types.ActionTarget{"test-session": sess}}
	eventChan := make(chan types.CormEvent, 8)
	d := dispatch.New(lookup, eventChan)

	h := &Handler{
		dispatcher:     d,
		recipeRegistry: chain.NewRecipeRegistry(),
	}

	traits := &types.CormTraits{Corruption: 80}

	sendEmptyStateFeedback(context.Background(), h, "corm-abc", "test-session", traits)

	actions := drainActions(actionChan, 200*time.Millisecond)

	// Find the contract_status action.
	var found bool
	for _, a := range actions {
		if a.ActionType == types.ActionContractStatus {
			var payload types.ContractStatusPayload
			json.Unmarshal(a.Payload, &payload)
			if payload.Status != "empty" {
				t.Errorf("expected status 'empty', got %q", payload.Status)
			}
			// High corruption should use the corrupted message.
			if payload.Message == "" {
				t.Error("expected non-empty corrupted message")
			}
			found = true
		}
	}
	if !found {
		t.Fatal("contract_status action not dispatched for high corruption")
	}
}
