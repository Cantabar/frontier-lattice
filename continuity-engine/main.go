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
			c := chain.NewClient(chain.ClientConfig{
			RpcURL:                       env.SUIRpcURL,
			PackageID:                    env.CormStatePackageID,
			OriginalID:                   env.CormStateOriginalID,
			TrustlessContractsPackageID:  env.TrustlessContractsPackageID,
			CormAuthPackageID:            env.CormAuthPackageID,
			WorldPackageID:               env.WorldPackageID,
			WitnessedContractsPackageID:  env.WitnessedContractsPackageID,
			CormConfigObjectID:           env.CormConfigObjectID,
			CoinAuthorityObjectID:        env.CoinAuthorityObjectID,
			WitnessRegistryObjectID:      env.WitnessRegistryObjectID,
			CormCharacterID:              env.CormCharacterID,
		}, env.SUIPrivateKey)
		if cfg.SeedChainData {
			c.SetSeedMode(true)
		}
		chainClients[env.Name] = c
		slog.Info(fmt.Sprintf("chain client initialized for environment %q", env.Name))
	}

	// --- Startup health checks ---
	for envName, c := range chainClients {
		if err := c.VerifyBrainAddress(ctx); err != nil {
			slog.Warn(fmt.Sprintf("chain health check [%s]: %v", envName, err))
		}
	}

	// --- Item Registry ---
	registry := chain.NewRegistry(cfg.ItemRegistryPath, cfg.ItemValuesPath)

	// Wire item registry into each chain client for TypeName resolution in
	// SSU inventory reads.
	for _, c := range chainClients {
		c.SetRegistry(registry)
	}

	// --- Recipe Registry (goal-directed contract generation) ---
	recipeRegistry := chain.NewRecipeRegistry()

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
		Registry:            registry,
		RecipeRegistry:      recipeRegistry,
		ChainClient:         defaultChainClient,
		Pricing:             reasoning.PricingConfig{CORMPerLUX: cfg.CORMPerLUX, CORMFloorPerUnit: cfg.CORMFloorPerUnit},
		ContractCooldown:    cfg.ContractGenerationCooldown,
		BuildRequestBounty:  cfg.BuildRequestBounty,
		SSUTypeID:           cfg.SSUTypeID,
	})

	// --- HTTP handlers + router ---
	defaultEnv := cfg.Environments[0].Name
	h := handlers.New(templateFS, sessionStore, dispatcher, defaultEnv)

	rh := handlers.NewReconcileHandler(database, chainClients, defaultEnv)

	ah := handlers.NewAPIHandler(database, chainClients, defaultEnv)

	gh := server.GameHandlers{
		Health:           h.Health,
		Phase0Page:       h.Phase0Page,
		Phase0Interact:   h.Phase0Interact,
		Phase0Command:    h.Phase0Command,
		PuzzlePage:       h.PuzzlePage,
		PuzzleDecrypt:    h.PuzzleDecrypt,
		PuzzleSubmit:     h.PuzzleSubmit,
		PuzzleGrid:       h.PuzzleGrid,
		Phase2Transition: h.Phase2Transition,
		Phase2Page:       h.Phase2Page,
		Phase2BindNode:   h.Phase2BindNode,
		Stream:           h.Stream,
		Status:           h.Status,
		ContractsPage:          h.ContractsPage,
		DebugFillContracts:     h.DebugFillContracts,
		DebugPhase2:            h.DebugPhase2,
		DebugReconcileChain:    rh.ReconcileChain,
		APIResetPhase:          ah.ResetPhase,
	}

	// Build the session sync callback — closes over DB + chain clients +
	// default environment so the middleware can eagerly restore corm state
	// on new sessions and reconcile on-chain drift.
	syncFn := buildSessionSyncFn(database, chainClients, defaultEnv)

	mux := server.NewRouter(gh, sessionStore, staticFS, cfg.SecureCookies, syncFn)

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
	playerAddr := events[0].PlayerAddress

	// --- Three-tier corm resolution ---
	// 1. Session → corm
	cormID, err := database.ResolveSessionCorm(ctx, env, sessionID)
	if err != nil {
		slog.Info(fmt.Sprintf("[%s] resolve session corm: %v", env, err))
		return
	}

	// 2. Network node → corm (if session lookup missed)
	if cormID == "" {
		for _, evt := range events {
			if evt.NetworkNodeID != "" {
				existing, err := database.ResolveCormID(ctx, env, evt.NetworkNodeID)
				if err != nil {
					slog.Info(fmt.Sprintf("[%s] resolve network node for corm: %v", env, err))
				} else if existing != "" {
					cormID = existing
					slog.Info(fmt.Sprintf("[%s] resolved existing corm %s for session %s via node %s", env, cormID, sessionID, evt.NetworkNodeID))
				}
				break
			}
		}
	}

	// 3. Player address → corm (if both session and node lookups missed)
	if cormID == "" && playerAddr != "" {
		existing, err := database.ResolveCormByPlayer(ctx, env, playerAddr)
		if err != nil {
			slog.Info(fmt.Sprintf("[%s] resolve player corm: %v", env, err))
		} else if existing != "" {
			cormID = existing
			slog.Info(fmt.Sprintf("[%s] resolved existing corm %s for session %s via player %s", env, cormID, sessionID, playerAddr))
		}
	}

	// 4. Create new corm only if all resolution paths failed
	if cormID == "" {
		cormID = uuid.New().String()
		slog.Info(fmt.Sprintf("[%s] new corm %s for session %s", env, cormID, sessionID))
	}

	// Ensure session → corm link exists (covers tiers 2, 3, and 4)
	if err := database.LinkSessionCorm(ctx, env, sessionID, cormID); err != nil {
		slog.Info(fmt.Sprintf("[%s] link session corm: %v", env, err))
	}

	// Ensure player → corm link exists (covers all tiers)
	if err := database.LinkPlayerCorm(ctx, env, playerAddr, cormID); err != nil {
		slog.Info(fmt.Sprintf("[%s] link player corm: %v", env, err))
	}

	// --- Network node linking and chain state provisioning ---
	for _, evt := range events {
		if evt.NetworkNodeID != "" {
			existing, err := database.ResolveCormID(ctx, env, evt.NetworkNodeID)
			if err != nil {
				slog.Info(fmt.Sprintf("[%s] resolve network node: %v", env, err))
			} else if existing == "" {
				// New node — create chain state and link to this corm
				chainClient := chainClients[env]
				chainStateID, err := chainClient.CreateCormState(ctx, evt.NetworkNodeID)
				if err != nil {
					slog.Info(fmt.Sprintf("[%s] create corm state: %v", env, err))
				}
				if err := database.LinkNetworkNode(ctx, env, evt.NetworkNodeID, cormID); err != nil {
					slog.Info(fmt.Sprintf("[%s] link network node: %v", env, err))
				}
				if chainStateID != "" {
					if err := database.SetChainStateID(ctx, env, evt.NetworkNodeID, chainStateID); err != nil {
						slog.Info(fmt.Sprintf("[%s] set chain state ID: %v", env, err))
					}
				}
				slog.Info(fmt.Sprintf("[%s] linked node %s to corm %s (chain_state=%s)", env, evt.NetworkNodeID, cormID, chainStateID))
			} else if existing != cormID {
				// Node belongs to a different corm — the node's corm is
				// authoritative (player may have been resolved via address
				// to a stale corm). Re-link session and player to the
				// node's corm.
				slog.Info(fmt.Sprintf("[%s] corm mismatch: session resolved %s but node %s belongs to %s — switching", env, cormID, evt.NetworkNodeID, existing))
				cormID = existing
				database.LinkSessionCorm(ctx, env, sessionID, cormID)
				database.LinkPlayerCorm(ctx, env, playerAddr, cormID)
				// Fall through to backfill chain_state_id
				existingChainID, _ := database.ResolveChainStateIDForNode(ctx, env, evt.NetworkNodeID)
				cormPhase := database.ResolveCormPhase(ctx, env, existing)
				if existingChainID == "" && (cormPhase >= 2 || !backfillRecentlyFailed(evt.NetworkNodeID)) {
					chainClient := chainClients[env]
					chainStateID, err := chainClient.CreateCormState(ctx, evt.NetworkNodeID)
					if err != nil {
						recordBackfillFailure(evt.NetworkNodeID)
						slog.Info(fmt.Sprintf("[%s] backfill create corm state for node %s: %v (suppressing retries for %s)", env, evt.NetworkNodeID, err, backfillCooldown))
					} else if chainStateID != "" {
						clearBackfillFailure(evt.NetworkNodeID)
						if err := database.SetChainStateID(ctx, env, evt.NetworkNodeID, chainStateID); err != nil {
							slog.Info(fmt.Sprintf("[%s] backfill set chain state ID: %v", env, err))
						} else {
							slog.Info(fmt.Sprintf("[%s] backfilled chain_state_id for node %s → %s", env, evt.NetworkNodeID, chainStateID))
						}
					}
				}
			} else {
				// Same corm — backfill chain_state_id if needed
				existingChainID, _ := database.ResolveChainStateIDForNode(ctx, env, evt.NetworkNodeID)
				cormPhase := database.ResolveCormPhase(ctx, env, existing)
				if existingChainID == "" && (cormPhase >= 2 || !backfillRecentlyFailed(evt.NetworkNodeID)) {
					chainClient := chainClients[env]
					chainStateID, err := chainClient.CreateCormState(ctx, evt.NetworkNodeID)
					if err != nil {
						recordBackfillFailure(evt.NetworkNodeID)
						slog.Info(fmt.Sprintf("[%s] backfill create corm state for node %s: %v (suppressing retries for %s)", env, evt.NetworkNodeID, err, backfillCooldown))
					} else if chainStateID != "" {
						clearBackfillFailure(evt.NetworkNodeID)
						if err := database.SetChainStateID(ctx, env, evt.NetworkNodeID, chainStateID); err != nil {
							slog.Info(fmt.Sprintf("[%s] backfill set chain state ID: %v", env, err))
						} else {
							slog.Info(fmt.Sprintf("[%s] backfilled chain_state_id for node %s → %s", env, evt.NetworkNodeID, chainStateID))
						}
					}
				}
			}
			break
		}
	}

	if err := handler.ProcessEventBatch(ctx, env, cormID, events); err != nil {
		slog.Info(fmt.Sprintf("[%s] process batch (%d events): %v", env, len(events), err))
	}
}

// --- Backfill cooldown tracking ---
// Prevents repeated CreateCormState retries for nodes where the call fails
// persistently (e.g. empty signer wallet, missing config).

const backfillCooldown = 60 * time.Second

var (
	backfillMu       sync.Mutex
	backfillFailures = make(map[string]time.Time) // networkNodeID → last failure time
)

func backfillRecentlyFailed(nodeID string) bool {
	backfillMu.Lock()
	defer backfillMu.Unlock()
	t, ok := backfillFailures[nodeID]
	return ok && time.Since(t) < backfillCooldown
}

func recordBackfillFailure(nodeID string) {
	backfillMu.Lock()
	backfillFailures[nodeID] = time.Now()
	backfillMu.Unlock()
}

func clearBackfillFailure(nodeID string) {
	backfillMu.Lock()
	delete(backfillFailures, nodeID)
	backfillMu.Unlock()
}

// buildSessionSyncFn returns a SessionSyncFn that resolves an existing corm
// from the DB by network node ID and initializes the session with stored
// traits (phase, stability, corruption). This is called eagerly on new session
// creation so the player lands on the correct phase immediately.
//
// It also reconciles on-chain state: if the DB phase differs from the on-chain
// CormState, it triggers an immediate update so the web UI stays in sync.
func buildSessionSyncFn(database *db.DB, chainClients map[string]*chain.Client, environment string) server.SessionSyncFn {
	return func(ctx context.Context, sess *puzzle.Session, nodeID string) {
		// Resolve network node → corm ID
		cormID, err := database.ResolveCormID(ctx, environment, nodeID)
		if err != nil {
			slog.Info(fmt.Sprintf("session sync: resolve corm for node %s: %v", nodeID, err))
			return
		}
		if cormID == "" {
			// No existing corm for this node — new corm will be created
			// on first event in processBatch.
			return
		}

		// Load stored traits
		traits, err := database.GetTraits(ctx, environment, cormID)
		if err != nil {
			slog.Info(fmt.Sprintf("session sync: get traits for corm %s: %v", cormID, err))
			return
		}
		if traits == nil {
			// Corm exists in network_nodes but has no traits row yet.
			return
		}

		// Initialize session with stored corm state
		sess.SetStateSync(puzzle.Phase(traits.Phase), int(traits.Stability), int(traits.Corruption))

		// Link this session to the corm so processBatch finds it
		if err := database.LinkSessionCorm(ctx, environment, sess.ID, cormID); err != nil {
			slog.Info(fmt.Sprintf("session sync: link session %s to corm %s: %v", sess.ID, cormID, err))
		}

		// Record player → corm association for future session recovery
		if sess.PlayerAddress != "" {
			if err := database.LinkPlayerCorm(ctx, environment, sess.PlayerAddress, cormID); err != nil {
				slog.Info(fmt.Sprintf("session sync: link player %s to corm %s: %v", sess.PlayerAddress, cormID, err))
			}
		}

		slog.Info(fmt.Sprintf("session sync: restored corm %s (phase=%d stab=%.0f corr=%.0f) for node %s",
			cormID, traits.Phase, traits.Stability, traits.Corruption, nodeID))

		// Reconcile on-chain state if it has drifted from the DB.
		chainClient := chainClients[environment]
		if chainClient == nil || !chainClient.CanUpdateCormState() {
			return
		}
		chainStateID, _ := database.ResolveChainStateID(ctx, environment, cormID)
		if chainStateID == "" || !chain.IsValidChainStateID(chainStateID) {
			return
		}
		onChain, err := chainClient.GetCormState(ctx, chainStateID)
		if err != nil {
			slog.Info(fmt.Sprintf("session sync: read on-chain state for corm %s: %v", cormID, err))
			return
		}
		if onChain == nil {
			return
		}
		if onChain.Phase != traits.Phase || onChain.Stability != int(traits.Stability) || onChain.Corruption != int(traits.Corruption) {
			if err := chainClient.UpdateCormState(ctx, chainStateID, traits.Phase, traits.Stability, traits.Corruption); err != nil {
				slog.Warn(fmt.Sprintf("session sync: reconcile on-chain state for corm %s failed: %v", cormID, err))
			} else {
				slog.Info(fmt.Sprintf("session sync: reconciled on-chain state for corm %s (phase %d→%d)",
					cormID, onChain.Phase, traits.Phase))
			}
		}
	}
}
