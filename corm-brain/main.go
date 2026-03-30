package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"

	"github.com/frontier-corm/corm-brain/internal/chain"
	"github.com/frontier-corm/corm-brain/internal/config"
	"github.com/frontier-corm/corm-brain/internal/db"
	"github.com/frontier-corm/corm-brain/internal/embed"
	"github.com/frontier-corm/corm-brain/internal/llm"
	"github.com/frontier-corm/corm-brain/internal/memory"
	"github.com/frontier-corm/corm-brain/internal/reasoning"
	"github.com/frontier-corm/corm-brain/internal/transport"
	"github.com/frontier-corm/corm-brain/internal/types"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("corm-brain starting")

	cfg := config.Load()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// --- Database (shared) ---
	database, err := db.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer database.Close()
	log.Println("database connected, migrations applied")

	// --- LLM Client (shared) ---
	llmClient := llm.NewClient(cfg.LLMSuperURL, cfg.LLMFastURL, llm.TokenLimits{
		Fast:    cfg.LLMMaxTokensFast,
		Default: cfg.LLMMaxTokensDefault,
		Deep:    cfg.LLMMaxTokensDeep,
		Sync:    cfg.LLMMaxTokensSync,
	})

	// --- Embedder (shared) ---
	embedder := embed.NewEmbedder(cfg.EmbedModelPath)
	defer embedder.Close()

	// --- Per-environment chain clients ---
	chainClients := make(map[string]*chain.Client, len(cfg.Environments))
	for _, env := range cfg.Environments {
		c := chain.NewClient(env.SUIRpcURL, env.CormStatePackageID, env.SUIPrivateKey)
		if cfg.SeedChainData {
			c.SetSeedMode(true)
		}
		chainClients[env.Name] = c
		log.Printf("chain client initialized for environment %q", env.Name)
	}

	// --- Transport (per-environment WS + fallback) ---
	eventChan := make(chan types.CormEvent, 256)

	envSpecs := make([]struct {
		Name             string
		PuzzleServiceURL string
	}, len(cfg.Environments))
	for i, env := range cfg.Environments {
		envSpecs[i].Name = env.Name
		envSpecs[i].PuzzleServiceURL = env.PuzzleServiceURL
	}

	tm := transport.NewManager(envSpecs, cfg.WSReconnectMax, cfg.FallbackPollInterval, eventChan)

	// --- Item Registry (shared) ---
	registry := chain.NewRegistry(cfg.ItemRegistryPath, cfg.ItemValuesPath)

	// --- Memory (shared) ---
	retriever := memory.NewRetriever(database, embedder)
	consolidator := memory.NewConsolidator(database, llmClient, embedder, cfg.MemoryCapPerCorm)

	// --- Reasoning ---
	// Use the first environment's chain client for contract generation.
	// Multi-env contract generation would need per-env chain client routing.
	var defaultChainClient *chain.Client
	for _, c := range chainClients {
		defaultChainClient = c
		break
	}

	handler := reasoning.NewHandler(database, llmClient, retriever, tm, reasoning.HandlerConfig{
		Registry:         registry,
		ChainClient:      defaultChainClient,
		Pricing:          reasoning.PricingConfig{CORMPerLUX: cfg.CORMPerLUX, CORMFloorPerUnit: cfg.CORMFloorPerUnit},
		ContractCooldown: cfg.ContractGenerationCooldown,
	})

	// --- Start goroutines ---
	var wg sync.WaitGroup

	// Goroutine 1: Transport manager (runs per-environment WS listeners)
	wg.Add(1)
	go func() {
		defer wg.Done()
		tm.Run(ctx)
	}()

	// Goroutine 2: Event processor (reads from shared eventChan)
	wg.Add(1)
	go func() {
		defer wg.Done()
		runEventProcessor(ctx, cfg, database, chainClients, handler, eventChan)
	}()

	// Goroutine 3: Slow consolidation loop (iterates all environments)
	wg.Add(1)
	go func() {
		defer wg.Done()
		runConsolidationLoop(ctx, cfg, database, consolidator, tm.Environments())
	}()

	log.Println("corm-brain running")

	// Wait for shutdown
	<-ctx.Done()
	log.Println("shutting down...")
	wg.Wait()
	log.Println("corm-brain stopped")
}

// runEventProcessor reads events from the channel, debounces them into
// per-session batches, and dispatches one LLM call per session per window.
func runEventProcessor(
	ctx context.Context,
	cfg config.Config,
	database *db.DB,
	chainClients map[string]*chain.Client,
	handler *reasoning.Handler,
	eventChan <-chan types.CormEvent,
) {
	coalesce := cfg.EventCoalesceWindow
	batchMax := cfg.EventBatchMax
	if batchMax <= 0 {
		batchMax = 20
	}

	for {
		select {
		case <-ctx.Done():
			return
		case evt := <-eventChan:
			// Coalesce: collect events for a debounce window or until batch cap.
			batch := []types.CormEvent{evt}
			timer := time.NewTimer(coalesce)
		drain:
			for {
				select {
				case e := <-eventChan:
					batch = append(batch, e)
					if len(batch) >= batchMax {
						timer.Stop()
						break drain
					}
				case <-timer.C:
					break drain
				case <-ctx.Done():
					timer.Stop()
					return
				}
			}

			// Group by (environment, sessionID) for per-session batch dispatch.
			groups := groupBySession(batch)
			for key, events := range groups {
				processBatch(ctx, database, chainClients, handler, key, events)
			}
		}
	}
}

// sessionKey builds a map key from environment and session ID.
func sessionKey(env, sessionID string) string {
	return env + ":" + sessionID
}

// groupBySession partitions a flat event slice into groups keyed by
// environment:sessionID. Order within each group is preserved.
func groupBySession(events []types.CormEvent) map[string][]types.CormEvent {
	groups := make(map[string][]types.CormEvent)
	for _, e := range events {
		k := sessionKey(e.Environment, e.SessionID)
		groups[k] = append(groups[k], e)
	}
	return groups
}

// processBatch resolves the corm for a session group and delegates to the
// reasoning handler's batch method. One LLM call per invocation.
func processBatch(
	ctx context.Context,
	database *db.DB,
	chainClients map[string]*chain.Client,
	handler *reasoning.Handler,
	key string, // unused beyond logging
	events []types.CormEvent,
) {
	if len(events) == 0 {
		return
	}

	// All events in a group share the same environment and session.
	env := events[0].Environment

	if _, ok := chainClients[env]; !ok {
		log.Printf("no chain client for environment %q, dropping %d events", env, len(events))
		return
	}

	// Resolve session → corm_id once for the group.
	sessionID := events[0].SessionID
	cormID, err := database.ResolveSessionCorm(ctx, env, sessionID)
	if err != nil {
		log.Printf("[%s] resolve session corm: %v", env, err)
		return
	}

	if cormID == "" {
		cormID = uuid.New().String()
		if err := database.LinkSessionCorm(ctx, env, sessionID, cormID); err != nil {
			log.Printf("[%s] link session corm: %v", env, err)
		}
		log.Printf("[%s] new corm %s for session %s", env, cormID, sessionID)
	}

	// Link network node if present (check first event only — same session).
	for _, evt := range events {
		if evt.NetworkNodeID != "" {
			existing, err := database.ResolveCormID(ctx, env, evt.NetworkNodeID)
			if err != nil {
				log.Printf("[%s] resolve network node: %v", env, err)
			} else if existing == "" {
				chainClient := chainClients[env]
				if _, err := chainClient.CreateCormState(ctx, evt.NetworkNodeID); err != nil {
					log.Printf("[%s] create corm state: %v", env, err)
				}
				if err := database.LinkNetworkNode(ctx, env, evt.NetworkNodeID, cormID); err != nil {
					log.Printf("[%s] link network node: %v", env, err)
				}
				log.Printf("[%s] linked node %s to corm %s", env, evt.NetworkNodeID, cormID)
			}
			break // only need to link once per batch
		}
	}

	if err := handler.ProcessEventBatch(ctx, env, cormID, events); err != nil {
		log.Printf("[%s] process batch (%d events): %v", env, len(events), err)
	}
}

// runConsolidationLoop periodically consolidates events into memories and updates traits.
func runConsolidationLoop(
	ctx context.Context,
	cfg config.Config,
	database *db.DB,
	consolidator *memory.Consolidator,
	environments []string,
) {
	ticker := time.NewTicker(cfg.ConsolidationInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, env := range environments {
				cormIDs, err := database.ActiveCormIDs(ctx, env)
				if err != nil {
					log.Printf("consolidation [%s]: active corms: %v", env, err)
					continue
				}

				for _, cormID := range cormIDs {
					if err := consolidator.ConsolidateCorm(ctx, env, cormID); err != nil {
						log.Printf("consolidation [%s]: corm %s: %v", env, cormID, err)
					}
				}
			}
		}
	}
}
