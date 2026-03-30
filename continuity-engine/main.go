package main

import (
	"context"
	"embed"
	"log/slog"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"

	"github.com/frontier-corm/continuity-engine/internal/chain"
	"github.com/frontier-corm/continuity-engine/internal/config"
	"github.com/frontier-corm/continuity-engine/internal/db"
	"github.com/frontier-corm/continuity-engine/internal/dispatch"
	"github.com/frontier-corm/continuity-engine/internal/handlers"
	"github.com/frontier-corm/continuity-engine/internal/puzzle"
	"github.com/frontier-corm/continuity-engine/internal/reasoning"
	"github.com/frontier-corm/continuity-engine/internal/server"
	"github.com/frontier-corm/continuity-engine/internal/types"
)

//go:embed internal/templates/*.html
var templateFS embed.FS

//go:embed static/*
var staticFS embed.FS

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	slog.Info("continuity-engine starting")

	cfg := config.Load()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// --- Database ---
	database, err := db.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error(fmt.Sprintf("database: %v", err)); os.Exit(1)
	}
	defer database.Close()
	slog.Info("database connected, migrations applied")

	// --- Per-environment chain clients ---
	chainClients := make(map[string]*chain.Client, len(cfg.Environments))
	for _, env := range cfg.Environments {
		c := chain.NewClient(env.SUIRpcURL, env.CormStatePackageID, env.SUIPrivateKey)
		if cfg.SeedChainData {
			c.SetSeedMode(true)
		}
		chainClients[env.Name] = c
		slog.Info(fmt.Sprintf("chain client initialized for environment %q", env.Name))
	}

	// --- Item Registry ---
	registry := chain.NewRegistry(cfg.ItemRegistryPath, cfg.ItemValuesPath)

	// --- Session store + Dispatcher ---
	sessionStore := puzzle.NewSessionStore()
	adapter := &puzzle.SessionStoreAdapter{Store: sessionStore}
	eventChan := make(chan types.CormEvent, 256)
	dispatcher := dispatch.New(adapter, eventChan)

	// --- Reasoning handler ---
	var defaultChainClient *chain.Client
	for _, c := range chainClients {
		defaultChainClient = c
		break
	}

	handler := reasoning.NewHandler(database, dispatcher, reasoning.HandlerConfig{
		Registry:         registry,
		ChainClient:      defaultChainClient,
		Pricing:          reasoning.PricingConfig{CORMPerLUX: cfg.CORMPerLUX, CORMFloorPerUnit: cfg.CORMFloorPerUnit},
		ContractCooldown: cfg.ContractGenerationCooldown,
	})

	// --- HTTP handlers + router ---
	defaultEnv := cfg.Environments[0].Name
	h := handlers.New(templateFS, sessionStore, dispatcher, defaultEnv)

	gh := server.GameHandlers{
		Health:           h.Health,
		Phase0Page:       h.Phase0Page,
		Phase0Interact:   h.Phase0Interact,
		PuzzlePage:       h.PuzzlePage,
		PuzzleDecrypt:    h.PuzzleDecrypt,
		PuzzleSubmit:     h.PuzzleSubmit,
		PuzzleGrid:       h.PuzzleGrid,
		Phase2Transition: h.Phase2Transition,
		Phase2Page:       h.Phase2Page,
		Phase2BindNode:   h.Phase2BindNode,
		Stream:           h.Stream,
		Status:           h.Status,
		ContractsPage:    h.ContractsPage,
	}
	mux := server.NewRouter(gh, sessionStore, staticFS, cfg.SecureCookies)

	// --- Start goroutines ---
	var wg sync.WaitGroup

	// Goroutine: Event processor (reads from dispatcher, dispatches to reasoning)
	wg.Add(1)
	go func() {
		defer wg.Done()
		runEventProcessor(ctx, cfg, database, chainClients, handler, dispatcher.EventChan())
	}()

	// Goroutine: HTTP server
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: mux,
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		slog.Info(fmt.Sprintf("continuity-engine listening on :%s", cfg.Port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error(fmt.Sprintf("server error: %v", err)); os.Exit(1)
		}
	}()

	slog.Info("continuity-engine running")

	// Wait for shutdown signal
	<-ctx.Done()
	slog.Info("shutting down...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	srv.Shutdown(shutdownCtx)

	wg.Wait()
	slog.Info("continuity-engine stopped")
}

// runEventProcessor reads events from the channel, debounces them into
// per-session batches, and dispatches one reasoning call per session per window.
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

			groups := groupBySession(batch)
			for key, events := range groups {
				processBatch(ctx, database, chainClients, handler, key, events)
			}
		}
	}
}

func sessionKey(env, sessionID string) string {
	return env + ":" + sessionID
}

func groupBySession(events []types.CormEvent) map[string][]types.CormEvent {
	groups := make(map[string][]types.CormEvent)
	for _, e := range events {
		k := sessionKey(e.Environment, e.SessionID)
		groups[k] = append(groups[k], e)
	}
	return groups
}

func processBatch(
	ctx context.Context,
	database *db.DB,
	chainClients map[string]*chain.Client,
	handler *reasoning.Handler,
	key string,
	events []types.CormEvent,
) {
	if len(events) == 0 {
		return
	}

	env := events[0].Environment

	if _, ok := chainClients[env]; !ok {
		slog.Info(fmt.Sprintf("no chain client for environment %q, dropping %d events", env, len(events)))
		return
	}

	sessionID := events[0].SessionID
	cormID, err := database.ResolveSessionCorm(ctx, env, sessionID)
	if err != nil {
		slog.Info(fmt.Sprintf("[%s] resolve session corm: %v", env, err))
		return
	}

	if cormID == "" {
		cormID = uuid.New().String()
		if err := database.LinkSessionCorm(ctx, env, sessionID, cormID); err != nil {
			slog.Info(fmt.Sprintf("[%s] link session corm: %v", env, err))
		}
		slog.Info(fmt.Sprintf("[%s] new corm %s for session %s", env, cormID, sessionID))
	}

	for _, evt := range events {
		if evt.NetworkNodeID != "" {
			existing, err := database.ResolveCormID(ctx, env, evt.NetworkNodeID)
			if err != nil {
				slog.Info(fmt.Sprintf("[%s] resolve network node: %v", env, err))
			} else if existing == "" {
				chainClient := chainClients[env]
				if _, err := chainClient.CreateCormState(ctx, evt.NetworkNodeID); err != nil {
					slog.Info(fmt.Sprintf("[%s] create corm state: %v", env, err))
				}
				if err := database.LinkNetworkNode(ctx, env, evt.NetworkNodeID, cormID); err != nil {
					slog.Info(fmt.Sprintf("[%s] link network node: %v", env, err))
				}
				slog.Info(fmt.Sprintf("[%s] linked node %s to corm %s", env, evt.NetworkNodeID, cormID))
			}
			break
		}
	}

	if err := handler.ProcessEventBatch(ctx, env, cormID, events); err != nil {
		slog.Info(fmt.Sprintf("[%s] process batch (%d events): %v", env, len(events), err))
	}
}
