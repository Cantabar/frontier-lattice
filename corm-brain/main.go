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
	llmClient := llm.NewClient(cfg.LLMSuperURL, cfg.LLMFastURL)

	// --- Embedder (shared) ---
	embedder := embed.NewEmbedder(cfg.EmbedModelPath)
	defer embedder.Close()

	// --- Per-environment chain clients ---
	chainClients := make(map[string]*chain.Client, len(cfg.Environments))
	for _, env := range cfg.Environments {
		chainClients[env.Name] = chain.NewClient(env.SUIRpcURL, env.CormStatePackageID, env.SUIPrivateKey)
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

	// --- Memory (shared) ---
	retriever := memory.NewRetriever(database, embedder)
	consolidator := memory.NewConsolidator(database, llmClient, embedder, cfg.MemoryCapPerCorm)

	// --- Reasoning ---
	handler := reasoning.NewHandler(database, llmClient, retriever, tm)

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

// runEventProcessor reads events from the channel and processes them.
func runEventProcessor(
	ctx context.Context,
	cfg config.Config,
	database *db.DB,
	chainClients map[string]*chain.Client,
	handler *reasoning.Handler,
	eventChan <-chan types.CormEvent,
) {
	coalesce := cfg.EventCoalesceWindow

	for {
		select {
		case <-ctx.Done():
			return
		case evt := <-eventChan:
			// Coalesce: collect events for a brief window
			batch := []types.CormEvent{evt}
			timer := time.NewTimer(coalesce)
		drain:
			for {
				select {
				case e := <-eventChan:
					batch = append(batch, e)
				case <-timer.C:
					break drain
				case <-ctx.Done():
					timer.Stop()
					return
				}
			}

			for _, e := range batch {
				processEvent(ctx, database, chainClients, handler, e)
			}
		}
	}
}

// processEvent resolves the corm and delegates to the reasoning handler.
func processEvent(
	ctx context.Context,
	database *db.DB,
	chainClients map[string]*chain.Client,
	handler *reasoning.Handler,
	evt types.CormEvent,
) {
	env := evt.Environment

	if _, ok := chainClients[env]; !ok {
		log.Printf("no chain client for environment %q, dropping event", env)
		return
	}

	// Resolve session → corm_id (every session maps to exactly one corm)
	cormID, err := database.ResolveSessionCorm(ctx, env, evt.SessionID)
	if err != nil {
		log.Printf("[%s] resolve session corm: %v", env, err)
		return
	}

	if cormID == "" {
		// First event for this session — assign a new corm
		cormID = uuid.New().String()
		if err := database.LinkSessionCorm(ctx, env, evt.SessionID, cormID); err != nil {
			log.Printf("[%s] link session corm: %v", env, err)
		}
		log.Printf("[%s] new corm %s for session %s", env, cormID, evt.SessionID)
	}

	// If a network node is present and not yet linked, bind it to this corm
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
	}

	if err := handler.ProcessEvent(ctx, env, cormID, evt); err != nil {
		log.Printf("[%s] process event: %v", env, err)
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
