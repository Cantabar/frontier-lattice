package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/frontier-corm/corm-brain/internal/types"
)

// mockResponse builds a non-streaming OpenAI chat completion response body.
func mockResponse(content, reasoningContent string) string {
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
		Choices: []choice{{Message: msg{Content: content, ReasoningContent: reasoningContent}}},
	}
	b, _ := json.Marshal(resp)
	return string(b)
}

// mockSSE builds an SSE stream body from a sequence of (content, reasoningContent) pairs.
func mockSSE(deltas []struct{ content, reasoning string }) string {
	var out string
	for i, d := range deltas {
		chunk := struct {
			Choices []struct {
				Delta struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content,omitempty"`
				} `json:"delta"`
			} `json:"choices"`
		}{
			Choices: []struct {
				Delta struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content,omitempty"`
				} `json:"delta"`
			}{
				{Delta: struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content,omitempty"`
				}{Content: d.content, ReasoningContent: d.reasoning}},
			},
		}
		b, _ := json.Marshal(chunk)
		out += fmt.Sprintf("data: %s\n\n", b)
		_ = i
	}
	out += "data: [DONE]\n\n"
	return out
}

func newTask() types.Task {
	return types.Task{CormID: "test-corm", Phase: 0}
}

func prompt() []types.Message {
	return []types.Message{{Role: "user", Content: "hello"}}
}

// --- CompleteSync tests ---

func TestCompleteSync_ContentOnly(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockResponse(`[{"text":"obs","type":"observation","importance":0.5}]`, ""))
	}))
	defer srv.Close()

	client := NewClient(srv.URL, srv.URL)
	got, err := client.CompleteSync(context.Background(), newTask(), prompt(), 100)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != `[{"text":"obs","type":"observation","importance":0.5}]` {
		t.Errorf("got %q, want JSON array", got)
	}
}

func TestCompleteSync_ContentWithReasoning(t *testing.T) {
	// When both fields are set, content should be preferred.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockResponse(`[{"text":"real answer","type":"observation","importance":0.7}]`, "thinking about it..."))
	}))
	defer srv.Close()

	client := NewClient(srv.URL, srv.URL)
	got, err := client.CompleteSync(context.Background(), newTask(), prompt(), 100)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != `[{"text":"real answer","type":"observation","importance":0.7}]` {
		t.Errorf("got %q, want content field", got)
	}
}

func TestCompleteSync_ReasoningOnly(t *testing.T) {
	// When content is empty but reasoning_content has data, fall back to reasoning.
	reasoning := `I need to produce JSON. The answer is [{"text":"from reasoning","type":"pattern","importance":0.6}]`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockResponse("", reasoning))
	}))
	defer srv.Close()

	client := NewClient(srv.URL, srv.URL)
	got, err := client.CompleteSync(context.Background(), newTask(), prompt(), 100)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != reasoning {
		t.Errorf("got %q, want reasoning_content fallback", got)
	}
}

func TestCompleteSync_EmptyResponse(t *testing.T) {
	// Both content and reasoning_content empty — should return empty string, no error.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockResponse("", ""))
	}))
	defer srv.Close()

	client := NewClient(srv.URL, srv.URL)
	got, err := client.CompleteSync(context.Background(), newTask(), prompt(), 100)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestCompleteSync_DisableReasoning(t *testing.T) {
	// Verify the request body includes chat_template_kwargs when reasoning is disabled.
	var receivedBody chatCompletionRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &receivedBody)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockResponse("[]", ""))
	}))
	defer srv.Close()

	client := NewClient(srv.URL, srv.URL)
	_, err := client.CompleteSync(context.Background(), newTask(), prompt(), 100, WithDisableReasoning())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedBody.ChatTemplateKwargs == nil {
		t.Fatal("expected chat_template_kwargs to be set")
	}
	if receivedBody.ChatTemplateKwargs.EnableThinking != false {
		t.Error("expected enable_thinking=false")
	}
}

func TestCompleteSync_NoDisableReasoning(t *testing.T) {
	// Without the option, chat_template_kwargs should be omitted.
	var rawBody map[string]interface{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &rawBody)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, mockResponse("[]", ""))
	}))
	defer srv.Close()

	client := NewClient(srv.URL, srv.URL)
	_, _ = client.CompleteSync(context.Background(), newTask(), prompt(), 100)

	if _, found := rawBody["chat_template_kwargs"]; found {
		t.Error("chat_template_kwargs should be omitted when not explicitly set")
	}
}

// --- Complete (streaming) tests ---

func TestComplete_ContentDeltas(t *testing.T) {
	body := mockSSE([]struct{ content, reasoning string }{
		{content: "hello "},
		{content: "world"},
	})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, body)
	}))
	defer srv.Close()

	client := NewClient(srv.URL, srv.URL)
	tokens, errc := client.Complete(context.Background(), newTask(), prompt())

	var got string
	for tok := range tokens {
		got += tok
	}
	if err := <-errc; err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "hello world" {
		t.Errorf("got %q, want %q", got, "hello world")
	}
}

func TestComplete_ReasoningThenContent(t *testing.T) {
	// Simulate TRT-LLM sending reasoning deltas first, then content deltas.
	// Only content should be received by the caller.
	body := mockSSE([]struct{ content, reasoning string }{
		{reasoning: "Let me think..."},
		{reasoning: "The answer is"},
		{content: "> pattern"},
		{content: " recognized"},
	})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, body)
	}))
	defer srv.Close()

	client := NewClient(srv.URL, srv.URL)
	tokens, errc := client.Complete(context.Background(), newTask(), prompt())

	var got string
	for tok := range tokens {
		got += tok
	}
	if err := <-errc; err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "> pattern recognized" {
		t.Errorf("got %q, want %q", got, "> pattern recognized")
	}
}

func TestComplete_ReasoningOnlyStream(t *testing.T) {
	// All tokens are reasoning, no content — caller should receive nothing.
	body := mockSSE([]struct{ content, reasoning string }{
		{reasoning: "thinking..."},
		{reasoning: "still thinking..."},
	})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, body)
	}))
	defer srv.Close()

	client := NewClient(srv.URL, srv.URL)
	tokens, errc := client.Complete(context.Background(), newTask(), prompt())

	var count int
	for range tokens {
		count++
	}
	if err := <-errc; err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if count != 0 {
		t.Errorf("got %d tokens, want 0 (reasoning-only stream)", count)
	}
}

func TestComplete_EmptyStream(t *testing.T) {
	// Server sends only [DONE] with no data chunks.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	client := NewClient(srv.URL, srv.URL)
	tokens, errc := client.Complete(context.Background(), newTask(), prompt())

	var count int
	for range tokens {
		count++
	}
	if err := <-errc; err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if count != 0 {
		t.Errorf("got %d tokens, want 0", count)
	}
}

func TestComplete_ModelRouting(t *testing.T) {
	// Phase 0 task should hit the fast URL (Nano).
	var receivedModel string
	fastSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req chatCompletionRequest
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &req)
		receivedModel = req.Model
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer fastSrv.Close()

	superSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Phase 0 task should not hit super URL")
	}))
	defer superSrv.Close()

	client := NewClient(superSrv.URL, fastSrv.URL)
	tokens, errc := client.Complete(context.Background(), types.Task{Phase: 0}, prompt())
	for range tokens {
	}
	<-errc

	if receivedModel != "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4" {
		t.Errorf("got model %q, want Nano", receivedModel)
	}
}
