package corm

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

// SessionLookup is the interface the relay needs to dispatch actions to sessions.
type SessionLookup interface {
	Get(id string) ActionTarget
	All() []ActionTarget
}

// ActionTarget is a session-like object that can receive actions and buffer events.
type ActionTarget interface {
	GetID() string
	GetPlayerAddress() string
	GetContext() string
	GetEventBuffer() *RingBuffer
	GetActionChan() chan CormAction
}

// Relay manages WebSocket connections from corm-brain and dispatches actions.
type Relay struct {
	mu       sync.RWMutex
	conns    map[*websocket.Conn]struct{}
	sessions SessionLookup
}

// NewRelay creates a new relay. The sessions parameter must be adapted to match SessionLookup.
func NewRelay(sessions SessionLookup) *Relay {
	return &Relay{
		conns:    make(map[*websocket.Conn]struct{}),
		sessions: sessions,
	}
}

// HandleWS is the HTTP handler for the /corm/ws WebSocket endpoint.
func (r *Relay) HandleWS(w http.ResponseWriter, req *http.Request) {
	conn, err := websocket.Accept(w, req, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		log.Printf("ws accept error: %v", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "closing")

	r.mu.Lock()
	r.conns[conn] = struct{}{}
	r.mu.Unlock()

	defer func() {
		r.mu.Lock()
		delete(r.conns, conn)
		r.mu.Unlock()
	}()

	log.Println("corm-brain connected via WebSocket")

	ctx := req.Context()
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) != -1 {
				log.Printf("corm-brain disconnected: %v", websocket.CloseStatus(err))
			} else {
				log.Printf("ws read error: %v", err)
			}
			return
		}

		var action CormAction
		if err := json.Unmarshal(data, &action); err != nil {
			log.Printf("invalid corm action: %v", err)
			continue
		}

		r.dispatchAction(action)
	}
}

// BroadcastEvent sends a player event to all connected corm-brain clients.
func (r *Relay) BroadcastEvent(evt CormEvent) {
	data, err := json.Marshal(evt)
	if err != nil {
		log.Printf("marshal event error: %v", err)
		return
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	for conn := range r.conns {
		if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
			log.Printf("ws write error: %v", err)
		}
	}
}

// DispatchAction routes an action to the appropriate session's action channel.
func (r *Relay) dispatchAction(action CormAction) {
	target := r.sessions.Get(action.SessionID)
	if target == nil {
		log.Printf("action for unknown session %s", action.SessionID)
		return
	}

	select {
	case target.GetActionChan() <- action:
	default:
		log.Printf("action channel full for session %s, dropping", action.SessionID)
	}
}

// DispatchActionPublic is the public entry point for HTTP fallback.
func (r *Relay) DispatchActionPublic(action CormAction) {
	r.dispatchAction(action)
}

// ConnectedCount returns the number of active WS connections.
func (r *Relay) ConnectedCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.conns)
}
