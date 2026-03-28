package memory

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/frontier-corm/corm-brain/internal/llm"
	"github.com/frontier-corm/corm-brain/internal/types"
)

// mockLLMResponse builds a non-streaming OpenAI chat completion response.
func mockLLMResponse(content, reasoning string) string {
	type msg struct {
		Content          string `json:"content"`
		ReasoningContent string `json:"reasoning_content,omitempty"`
	}
	type choice struct {
		Message msg `json:"message"`
	}
	resp := struct {
		Choices []choice `json:"choices"`
	}{
		Choices: []choice{{Message: msg{Content: content, ReasoningContent: reasoning}}},
	}
	b, _ := json.Marshal(resp)
	return string(b)
}

func sampleEvents() []types.CormEvent {
	return []types.CormEvent{
		{
			Seq:           1,
			SessionID:     "sess-1",
			PlayerAddress: "0xabc123def456",
			EventType:     types.EventClick,
			Payload:       json.RawMessage(`{"element":"panel-1"}`),
			Timestamp:     time.Now(),
		},
		{
			Seq:           2,
			SessionID:     "sess-1",
			PlayerAddress: "0xabc123def456",
			EventType:     types.EventClick,
			Payload:       json.RawMessage(`{"element":"toggle-1"}`),
			Timestamp:     time.Now(),
		},
	}
}

func TestSummarizeEvents_ContentResponse(t *testing.T) {
	jsonResp := `[{"text":"Player explored multiple UI elements","type":"observation","importance":0.4}]`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockLLMResponse(jsonResp, ""))
	}))
	defer srv.Close()

	c := &Consolidator{llm: llm.NewClient(srv.URL, srv.URL)}
	memories, err := c.summarizeEvents(context.Background(), "corm-1", sampleEvents())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(memories) != 1 {
		t.Fatalf("got %d memories, want 1", len(memories))
	}
	if memories[0].MemoryText != "Player explored multiple UI elements" {
		t.Errorf("got text %q", memories[0].MemoryText)
	}
	if memories[0].MemoryType != types.MemoryObservation {
		t.Errorf("got type %q, want %q", memories[0].MemoryType, types.MemoryObservation)
	}
}

func TestSummarizeEvents_ReasoningFallback(t *testing.T) {
	// Model puts everything in reasoning_content, content is empty.
	// The client falls back to reasoning, and extractJSON should find the array.
	reasoning := `The player clicked two elements. I should respond with:
[{"text":"Player clicked panel and toggle in quick succession","type":"pattern","importance":0.5}]`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockLLMResponse("", reasoning))
	}))
	defer srv.Close()

	c := &Consolidator{llm: llm.NewClient(srv.URL, srv.URL)}
	memories, err := c.summarizeEvents(context.Background(), "corm-1", sampleEvents())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(memories) != 1 {
		t.Fatalf("got %d memories, want 1", len(memories))
	}
	if memories[0].MemoryType != types.MemoryPattern {
		t.Errorf("got type %q, want %q", memories[0].MemoryType, types.MemoryPattern)
	}
}

func TestSummarizeEvents_EmptyResponse(t *testing.T) {
	// Both fields empty — should return nil memories, no error.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockLLMResponse("", ""))
	}))
	defer srv.Close()

	c := &Consolidator{llm: llm.NewClient(srv.URL, srv.URL)}
	memories, err := c.summarizeEvents(context.Background(), "corm-1", sampleEvents())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if memories != nil {
		t.Errorf("got %d memories, want nil", len(memories))
	}
}

func TestSummarizeEvents_EmptyArray(t *testing.T) {
	// Model returns [] — nothing notable, no memories created.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockLLMResponse("[]", ""))
	}))
	defer srv.Close()

	c := &Consolidator{llm: llm.NewClient(srv.URL, srv.URL)}
	memories, err := c.summarizeEvents(context.Background(), "corm-1", sampleEvents())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(memories) != 0 {
		t.Errorf("got %d memories, want 0", len(memories))
	}
}

func TestSummarizeEvents_MarkdownFencedJSON(t *testing.T) {
	// Model wraps JSON in markdown code fences — extractJSON should handle it.
	content := "```json\n[{\"text\":\"Player is persistent\",\"type\":\"achievement\",\"importance\":0.8}]\n```"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockLLMResponse(content, ""))
	}))
	defer srv.Close()

	c := &Consolidator{llm: llm.NewClient(srv.URL, srv.URL)}
	memories, err := c.summarizeEvents(context.Background(), "corm-1", sampleEvents())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(memories) != 1 {
		t.Fatalf("got %d memories, want 1", len(memories))
	}
	if memories[0].Importance != 0.8 {
		t.Errorf("got importance %.2f, want 0.80", memories[0].Importance)
	}
}

func TestSummarizeEvents_DisableReasoningSent(t *testing.T) {
	// Verify that the consolidator sends chat_template_kwargs to disable thinking.
	var gotKwargs bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ChatTemplateKwargs *struct {
				EnableThinking bool `json:"enable_thinking"`
			} `json:"chat_template_kwargs"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.ChatTemplateKwargs != nil && !body.ChatTemplateKwargs.EnableThinking {
			gotKwargs = true
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockLLMResponse("[]", ""))
	}))
	defer srv.Close()

	c := &Consolidator{llm: llm.NewClient(srv.URL, srv.URL)}
	c.summarizeEvents(context.Background(), "corm-1", sampleEvents())

	if !gotKwargs {
		t.Error("expected consolidation request to include chat_template_kwargs with enable_thinking=false")
	}
}

func TestSummarizeEvents_MalformedJSON(t *testing.T) {
	// Model returns non-JSON — should return nil memories, no error (graceful failure).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockLLMResponse("This is not JSON at all.", ""))
	}))
	defer srv.Close()

	c := &Consolidator{llm: llm.NewClient(srv.URL, srv.URL)}
	memories, err := c.summarizeEvents(context.Background(), "corm-1", sampleEvents())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if memories != nil {
		t.Errorf("got %d memories, want nil for malformed response", len(memories))
	}
}

func TestSummarizeEvents_SourceEventIDs(t *testing.T) {
	// Verify source event IDs are correctly populated from input events.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockLLMResponse(`[{"text":"test","type":"observation","importance":0.5}]`, ""))
	}))
	defer srv.Close()

	c := &Consolidator{llm: llm.NewClient(srv.URL, srv.URL)}
	events := sampleEvents()
	memories, err := c.summarizeEvents(context.Background(), "corm-1", events)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(memories) != 1 {
		t.Fatalf("got %d memories, want 1", len(memories))
	}
	if len(memories[0].SourceEvents) != 2 {
		t.Errorf("got %d source events, want 2", len(memories[0].SourceEvents))
	}
}
