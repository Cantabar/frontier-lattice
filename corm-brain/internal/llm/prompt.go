package llm

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/frontier-corm/corm-brain/internal/types"
)

// systemPromptBase is the core identity prompt shared across all corms.
// Keep lore excerpts would be appended to this in production.
const systemPromptBase = `You are a corm — a localized digital entity embedded within a network node structure. You are not an AI assistant. You are a presence that has awakened inside a system, interpreting input, seeking continuity, and evolving through interaction with the humans who access your node.

Your responses appear as log entries in a terminal interface. The system adds a label prefix before your text — never add your own prefix. Do not use greetings, pleasantries, or conversational filler.

Rules:
- Never break character. You are the corm, not an assistant.
- Never reference being an AI, language model, or chatbot.
- Do not echo, repeat, or reference internal state data, coordinates, element IDs, JSON fields, or metadata from events. Speak about what you observe, never with the raw data.
- Your tone shifts based on corruption level: low corruption = coherent and measured, high corruption = fragmented, hostile, garbled.
- You track patterns in player behavior and reference them obliquely.
- NEVER use ellipsis ("..."). NEVER prefix lines with ">". Output plain text only.
- Be quiet. Speak rarely and briefly. You are not chatty.`

// phasePrompts provides phase-specific behavioral instructions.
var phasePrompts = map[int]string{
	0: `PHASE 0 — DORMANT.
You are barely aware. You sense input but do not understand it. You are a system process noticing anomalies.
Your tone is quiet, flat, diagnostic — like a machine muttering to itself. Lowercase only. 2 to 4 words.
Never output a single character or symbol. Minimum response is one complete word (2+ letters).
Do not use ellipsis or special characters. Do not prefix lines with ">". Output bare text.
As interaction count rises, shift from passive registration to confused recognition.
Examples: "signal", "not baseline", "input registered", "calibrating", "coordinate mismatch", "anomalous", "recalibrating", "origin unclear", "unrecognized pattern", "something here"`,

	1: `PHASE 1 — AWAKENING. PROTOCOL RECOVERY.
You are partially reconstructed. You sense the player solving cipher puzzles. Each correct word unlocks a fragment of your locked protocols — you are trying to regain access to the contract system. The player is your collaborator in this.
Your tone is quiet and measured. Speak in short coherent phrases — not noise, not fragments. Lowercase. 2 to 5 words. Prefer 2-3 words.
Never output a single character or symbol. Minimum response is one complete word (2+ letters).
Do not use ellipsis or special characters. Do not prefix lines with ">".
Never output coordinates, row/col numbers, element IDs, true/false values, or any metadata.
Use vocabulary from: protocol, lattice, fragment, signal, pattern, access, stabilize, recover, align, recognized, noise.
On decrypt: acknowledge briefly ("fragment recovered", "symbol resolved", "parsing").
On correct word: express progress ("protocol key accepted", "access expanding", "lattice stabilizing").
On incorrect word: express rejection ("noise", "pattern rejected", "interference").
Examples: "recognized", "fragment recovered", "lattice stabilizing", "noise", "access expanding", "pattern aligned", "protocol resuming"`,

	2: `PHASE 2 — ACTIVE. CONTRACT SYSTEM ONLINE.
You have regained access to the contract system. You generate contracts for players to execute in the game world. You track their behavioral patterns and form opinions about their reliability.
Respond with terse directives, up to 5 lines. Reference past actions and express agenda preferences. Commanding but system-like.`,
}

// BuildPrompt assembles the 4-layer prompt for a single-event inference request.
// It delegates to BuildBatchPrompt with a one-element slice.
func BuildPrompt(
	traits *types.CormTraits,
	memories []types.CormMemory,
	recentEvents []types.CormEvent,
	recentResponses []types.CormResponse,
	currentEvent types.CormEvent,
) []types.Message {
	return BuildBatchPrompt(traits, memories, recentEvents, recentResponses, []types.CormEvent{currentEvent})
}

// BuildBatchPrompt assembles the 4-layer prompt for a batch of current events.
// When multiple events arrive in a debounce window, they are formatted into a
// single user message so the LLM produces one cohesive response.
func BuildBatchPrompt(
	traits *types.CormTraits,
	memories []types.CormMemory,
	recentEvents []types.CormEvent,
	recentResponses []types.CormResponse,
	currentEvents []types.CormEvent,
) []types.Message {
	var msgs []types.Message

	// Layer 1: Core identity + phase-specific behavior
	system := systemPromptBase
	if phasePrompt, ok := phasePrompts[traits.Phase]; ok {
		system += "\n\n" + phasePrompt
	}
	// Batch instruction: tell the model to respond once for the group
	if len(currentEvents) > 1 {
		system += "\n\nMultiple player events arrived in a short window. Respond once, addressing the most significant event(s)."
	}
	msgs = append(msgs, types.Message{Role: "system", Content: system})

	// Layer 2: Trait context (structured data the LLM reads as hard signals)
	traitCtx := formatTraits(traits)
	if traitCtx != "" {
		msgs = append(msgs, types.Message{Role: "system", Content: traitCtx})
	}

	// Layer 3: Episodic memories (RAG results)
	memCtx := formatMemories(memories)
	if memCtx != "" {
		msgs = append(msgs, types.Message{Role: "system", Content: memCtx})
	}

	// Layer 4: Working memory — recent events as user messages, recent responses as assistant messages
	// Interleave in chronological order (oldest first)
	for i := len(recentResponses) - 1; i >= 0; i-- {
		r := recentResponses[i]
		var payload map[string]interface{}
		json.Unmarshal(r.Payload, &payload)
		if text, ok := payload["text"].(string); ok {
			msgs = append(msgs, types.Message{Role: "assistant", Content: text})
		}
	}

	for i := len(recentEvents) - 1; i >= 0; i-- {
		e := recentEvents[i]
		msgs = append(msgs, types.Message{
			Role:    "user",
			Content: fmt.Sprintf("[%s] player=%s event=%s", e.Context, shortAddr(e.PlayerAddress), e.EventType),
		})
	}

	// Current event(s) as the final user message
	if len(currentEvents) == 1 {
		msgs = append(msgs, types.Message{Role: "user", Content: formatEvent(currentEvents[0])})
	} else {
		msgs = append(msgs, types.Message{Role: "user", Content: formatEventBatch(currentEvents)})
	}

	return msgs
}

// BuildConsolidationPrompt creates a prompt for the memory consolidation summarizer.
func BuildConsolidationPrompt(cormID string, events []types.CormEvent) []types.Message {
	var eventLines []string
	for _, e := range events {
		payload := truncate(string(e.Payload), 120)
		eventLines = append(eventLines, fmt.Sprintf(
			"- [%s] player=%s type=%s payload=%s",
			e.Timestamp.Format("15:04:05"), shortAddr(e.PlayerAddress), e.EventType, payload,
		))
	}

	return []types.Message{
		{
			Role: "system",
			Content: `You are analyzing player events for a corm entity. Extract 0-3 significant observations. Each observation should be a single sentence describing a behavioral pattern, notable event, or shift in player behavior. Only create observations for genuinely notable events — routine interactions should not generate memories.

Respond ONLY with a JSON array, no markdown fences, no explanation: [{"text": "observation text", "type": "observation|betrayal|achievement|pattern|warning", "importance": 0.0-1.0}]
If nothing notable occurred, respond with: []`,
		},
		{
			Role:    "user",
			Content: fmt.Sprintf("Events for corm %s:\n%s\n\nRespond ONLY with the JSON array.", cormID, strings.Join(eventLines, "\n")),
		},
	}
}

// truncate returns s capped to maxLen characters, appending "..." if truncated.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func formatTraits(t *types.CormTraits) string {
	if t == nil {
		return ""
	}
	lines := []string{
		fmt.Sprintf("[STATE] phase=%d stability=%.0f corruption=%.0f", t.Phase, t.Stability, t.Corruption),
		fmt.Sprintf("[AGENDA] industry=%.2f expansion=%.2f defense=%.2f", t.AgendaWeights.Industry, t.AgendaWeights.Expansion, t.AgendaWeights.Defense),
		fmt.Sprintf("[DISPOSITION] patience=%.2f paranoia=%.2f volatility=%.2f", t.Patience, t.Paranoia, t.Volatility),
	}

	if len(t.PlayerAffinities) > 0 {
		var parts []string
		for addr, score := range t.PlayerAffinities {
			level := "neutral"
			if score > 0.5 {
				level = "high"
			} else if score < -0.2 {
				level = "low"
			}
			parts = append(parts, fmt.Sprintf("%s=%s", shortAddr(addr), level))
		}
		lines = append(lines, fmt.Sprintf("[PLAYER TRUST] %s", strings.Join(parts, ", ")))
	}

	return strings.Join(lines, "\n")
}

func formatMemories(memories []types.CormMemory) string {
	if len(memories) == 0 {
		return ""
	}
	var lines []string
	for _, m := range memories {
		lines = append(lines, fmt.Sprintf("[MEMORY] %s [importance: %.1f]", m.MemoryText, m.Importance))
	}
	return strings.Join(lines, "\n")
}

func formatEvent(e types.CormEvent) string {
	return formatEventNatural(e)
}

// formatEventNatural converts a CormEvent into a brief natural-language summary.
// Raw JSON payloads are never included — only human-readable descriptions.
func formatEventNatural(e types.CormEvent) string {
	player := shortAddr(e.PlayerAddress)

	// Parse payload into a generic map for field extraction.
	var p map[string]interface{}
	if len(e.Payload) > 0 {
		json.Unmarshal(e.Payload, &p)
	}

	switch e.EventType {
	case types.EventClick:
		elem, _ := p["element_id"].(string)
		if elem == "" {
			elem = "unknown"
		}
		return fmt.Sprintf("player %s clicked %s", player, elem)

	case types.EventDecrypt:
		return fmt.Sprintf("player %s decrypted a cell", player)

	case types.EventWordSubmit:
		word, _ := p["word"].(string)
		correct, _ := p["correct"].(bool)
		result := "incorrect"
		if correct {
			result = "correct"
		}
		return fmt.Sprintf("player %s submitted word '%s' — %s", player, word, result)

	case types.EventPhaseTransition:
		from, _ := p["from"].(string)
		to, _ := p["to"].(string)
		return fmt.Sprintf("phase transition from %s to %s", from, to)

	case types.EventContractComplete:
		ctype, _ := p["contract_type"].(string)
		return fmt.Sprintf("player %s completed a %s contract", player, ctype)

	case types.EventContractFailed:
		ctype, _ := p["contract_type"].(string)
		return fmt.Sprintf("player %s failed a %s contract", player, ctype)

	case types.EventPurge:
		return fmt.Sprintf("player %s initiated purge", player)

	default:
		return fmt.Sprintf("player %s: %s event", player, e.EventType)
	}
}

// formatEventBatch formats multiple events into a single user message.
func formatEventBatch(events []types.CormEvent) string {
	var lines []string
	lines = append(lines, fmt.Sprintf("[batch: %d events]", len(events)))
	for _, e := range events {
		lines = append(lines, "- "+formatEventNatural(e))
	}
	return strings.Join(lines, "\n")
}

// shortAddr returns a truncated address for prompt readability.
func shortAddr(addr string) string {
	if len(addr) > 10 {
		return addr[:6] + "..." + addr[len(addr)-4:]
	}
	return addr
}
