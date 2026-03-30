// Package dispatch provides the in-process bridge between the HTTP handler
// layer and the reasoning engine. It replaces the WebSocket transport
// (corm-brain) and relay (puzzle-service) with direct channel communication.
package dispatch

import (
	"context"
	"encoding/json"
	"log/slog"
	"fmt"

	"github.com/frontier-corm/continuity-engine/internal/types"
)

// Dispatcher bridges player events from HTTP handlers to the reasoning
// engine, and routes corm actions back to player sessions.
type Dispatcher struct {
	sessions  types.SessionLookup
	eventChan chan types.CormEvent
}

// New creates a dispatcher with the given session lookup and event channel.
func New(sessions types.SessionLookup, eventChan chan types.CormEvent) *Dispatcher {
	return &Dispatcher{
		sessions:  sessions,
		eventChan: eventChan,
	}
}

// EmitEvent pushes a player event into the processing pipeline.
// Called by HTTP handlers (replaces relay.BroadcastEvent).
func (d *Dispatcher) EmitEvent(evt types.CormEvent) {
	select {
	case d.eventChan <- evt:
	default:
		slog.Info(fmt.Sprintf("dispatch: event channel full, dropping event for session %s", evt.SessionID))
	}
}

// SendAction routes a corm action to the appropriate session's action channel.
// Called by the reasoning handler (replaces transport.ActionSender.Send).
func (d *Dispatcher) SendAction(ctx context.Context, action types.CormAction) {
	target := d.sessions.Get(action.SessionID)
	if target == nil {
		slog.Info(fmt.Sprintf("dispatch: action for unknown session %s", action.SessionID))
		return
	}

	select {
	case target.GetActionChan() <- action:
	default:
		slog.Info(fmt.Sprintf("dispatch: action channel full for session %s, dropping", action.SessionID))
	}
}

// SendPayload is a convenience method that marshals a payload and sends an action.
func (d *Dispatcher) SendPayload(ctx context.Context, actionType, sessionID string, payload interface{}) {
	data, err := json.Marshal(payload)
	if err != nil {
		slog.Info(fmt.Sprintf("dispatch: marshal payload: %v", err))
		return
	}

	d.SendAction(ctx, types.CormAction{
		ActionType: actionType,
		SessionID:  sessionID,
		Payload:    data,
	})
}

// GetSession returns a session by ID, or nil if not found.
func (d *Dispatcher) GetSession(sessionID string) types.ActionTarget {
	return d.sessions.Get(sessionID)
}

// EventChan returns the read side of the event channel for the event processor.
func (d *Dispatcher) EventChan() <-chan types.CormEvent {
	return d.eventChan
}
