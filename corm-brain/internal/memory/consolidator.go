package memory

import (
	"context"
	"encoding/json"
	"log"
	"strings"

	"github.com/frontier-corm/corm-brain/internal/db"
	"github.com/frontier-corm/corm-brain/internal/embed"
	"github.com/frontier-corm/corm-brain/internal/llm"
	"github.com/frontier-corm/corm-brain/internal/types"
)

// Consolidator summarizes raw events into episodic memories and updates traits.
type Consolidator struct {
	db       *db.DB
	llm      *llm.Client
	embedder embed.Embedder
	memoryCap int
}

// NewConsolidator creates a new memory consolidator.
func NewConsolidator(database *db.DB, llmClient *llm.Client, embedder embed.Embedder, memoryCap int) *Consolidator {
	return &Consolidator{
		db:        database,
		llm:       llmClient,
		embedder:  embedder,
		memoryCap: memoryCap,
	}
}

// ConsolidateCorm processes unconsolidated events for a single corm.
func (c *Consolidator) ConsolidateCorm(ctx context.Context, environment, cormID string) error {
	// Get current traits
	traits, err := c.db.GetTraits(ctx, environment, cormID)
	if err != nil {
		return err
	}
	if traits == nil {
		log.Printf("consolidate: no traits for corm %s [%s], skipping", cormID, environment)
		return nil
	}

	// Get events since last checkpoint
	events, err := c.db.EventsSince(ctx, environment, cormID, traits.ConsolidationCheckpoint)
	if err != nil {
		return err
	}
	if len(events) == 0 {
		return nil
	}

	log.Printf("consolidating %d events for corm %s", len(events), cormID)

	// 1. Summarize events into observations via LLM (Nano, fast)
	memories, err := c.summarizeEvents(ctx, cormID, events)
	if err != nil {
		log.Printf("consolidate: summarize failed for %s: %v", cormID, err)
		// Continue with trait reduction even if summarization fails
	}

	// 2. Generate embeddings for new memories
	if len(memories) > 0 {
		texts := make([]string, len(memories))
		for i, m := range memories {
			texts[i] = m.MemoryText
		}
		embeddings, err := c.embedder.EmbedBatch(ctx, texts)
		if err != nil {
			log.Printf("consolidate: embed failed for %s: %v", cormID, err)
		} else {
			for i := range memories {
				memories[i].Embedding = embeddings[i]
			}
		}

		// 3. Upsert memories
		for _, m := range memories {
			if _, err := c.db.InsertMemory(ctx, environment, &m); err != nil {
				log.Printf("consolidate: insert memory failed: %v", err)
			}
		}
	}

	// 4. Run deterministic trait reducers
	ReduceEvents(traits, events)

	// 5. Update checkpoint to latest event
	var maxID int64
	for _, e := range events {
		if int64(e.Seq) > maxID {
			maxID = int64(e.Seq)
		}
	}
	traits.ConsolidationCheckpoint = maxID

	if err := c.db.UpsertTraits(ctx, environment, traits); err != nil {
		return err
	}

	// 6. Prune memories if over cap
	count, err := c.db.MemoryCount(ctx, environment, cormID)
	if err != nil {
		return err
	}
	if count > c.memoryCap {
		pruned, err := c.db.PruneMemories(ctx, environment, cormID, c.memoryCap)
		if err != nil {
			log.Printf("consolidate: prune failed for %s: %v", cormID, err)
		} else if pruned > 0 {
			log.Printf("pruned %d memories for corm %s", pruned, cormID)
		}
	}

	return nil
}

// summarizeEvents sends events to the LLM for observation extraction.
func (c *Consolidator) summarizeEvents(ctx context.Context, cormID string, events []types.CormEvent) ([]types.CormMemory, error) {
	prompt := llm.BuildConsolidationPrompt(cormID, events)

	// Use Nano (fast, no deep reasoning needed) with thinking disabled —
	// consolidation is structured JSON extraction, not creative generation.
	task := types.Task{CormID: cormID, Phase: 0}
	response, err := c.llm.CompleteSync(ctx, task, prompt, 500, llm.WithDisableReasoning())
	if err != nil {
		return nil, err
	}

	// Guard against empty response (model may have consumed all tokens on
	// reasoning despite our disable flag, or returned nothing useful).
	if strings.TrimSpace(response) == "" {
		log.Printf("consolidate: LLM returned empty response for corm %s", cormID)
		return nil, nil
	}

	// Parse JSON response
	var observations []struct {
		Text       string  `json:"text"`
		Type       string  `json:"type"`
		Importance float64 `json:"importance"`
	}

	clean := extractJSON(response)
	if err := json.Unmarshal([]byte(clean), &observations); err != nil {
		preview := response
		if len(preview) > 200 {
			preview = preview[:200] + "..."
		}
		log.Printf("consolidate: failed to parse LLM response as JSON: %v\nraw response: %s", err, preview)
		return nil, nil
	}

	// Collect source event IDs
	var sourceIDs []int64
	for _, e := range events {
		sourceIDs = append(sourceIDs, int64(e.Seq))
	}

	var memories []types.CormMemory
	for _, obs := range observations {
		if obs.Text == "" {
			continue
		}
		memType := obs.Type
		if memType == "" {
			memType = types.MemoryObservation
		}
		importance := obs.Importance
		if importance <= 0 || importance > 1 {
			importance = 0.5
		}

		memories = append(memories, types.CormMemory{
			CormID:       cormID,
			MemoryText:   obs.Text,
			MemoryType:   memType,
			Importance:   importance,
			SourceEvents: sourceIDs,
		})
	}

	return memories, nil
}

// extractJSON strips markdown code fences and preamble text to isolate a JSON array.
func extractJSON(s string) string {
	s = strings.TrimSpace(s)

	// Strip markdown code fences: ```json ... ``` or ``` ... ```
	if idx := strings.Index(s, "```"); idx != -1 {
		// Find content after the opening fence line
		start := strings.Index(s[idx:], "\n")
		if start != -1 {
			s = s[idx+start+1:]
		}
		// Strip closing fence
		if end := strings.LastIndex(s, "```"); end != -1 {
			s = s[:end]
		}
		s = strings.TrimSpace(s)
	}

	// Find the JSON array boundaries
	first := strings.Index(s, "[")
	last := strings.LastIndex(s, "]")
	if first != -1 && last > first {
		return s[first : last+1]
	}

	return s
}
