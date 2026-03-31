// Package config handles environment variable parsing and configuration defaults.
package config

import (
	"encoding/json"
	"log/slog"
	"fmt"
	"os"
	"strconv"
	"time"
)

// EnvironmentConfig holds per-environment settings.
type EnvironmentConfig struct {
	Name               string `json:"name"`
	SUIRpcURL          string `json:"sui_rpc_url"`
	SUIPrivateKeyEnv   string `json:"sui_private_key_env"` // env var name holding the key
	CormStatePackageID string `json:"corm_state_package_id"`

	// Additional package IDs for on-chain contract calls.
	TrustlessContractsPackageID string `json:"trustless_contracts_package_id"`
	CormAuthPackageID           string `json:"corm_auth_package_id"`

	// Shared object IDs required for on-chain operations.
	CormConfigObjectID    string `json:"corm_config_object_id"`    // CormConfig shared object (for install)
	CoinAuthorityObjectID string `json:"coin_authority_object_id"` // CoinAuthority shared object (for minting)
	CormCharacterID       string `json:"corm_character_id"`        // Corm-brain's on-chain Character (for posting contracts)

	// Resolved at load time from the env var referenced by SUIPrivateKeyEnv.
	SUIPrivateKey string `json:"-"`
}

// Config holds all continuity-engine configuration.
type Config struct {
	// HTTP listen port
	Port string

	// Secure cookies: SameSite=None + Secure flag. Required for cross-origin
	// iframe embedding (production). Disabled for local HTTP dev.
	SecureCookies bool

	// Event coalescing window (debounce). Events arriving within this window
	// are grouped by session and processed as a single batch.
	EventCoalesceWindow time.Duration

	// Maximum events to collect per coalesce window before forcing a flush.
	EventBatchMax int

	// Item registry paths
	ItemRegistryPath string
	ItemValuesPath   string

	// Contract generation pricing
	CORMPerLUX       float64
	CORMFloorPerUnit uint64

	// Contract generation cooldown (min time between generation attempts per corm)
	ContractGenerationCooldown time.Duration

	// Seed chain data: when true, stub chain methods return hardcoded mock data
	// instead of zeros. Enables contract generation before real SUI integration.
	SeedChainData bool

	// Database (shared)
	DatabaseURL string

	// Per-environment configs
	Environments []EnvironmentConfig
}

// Load reads configuration from environment variables with sensible defaults.
func Load() Config {
	cfg := Config{
		Port:                       envOrDefault("PORT", "3300"),
		SecureCookies:              envBool("SECURE_COOKIES", false),
		EventCoalesceWindow:        envDurationMs("EVENT_COALESCE_MS", 300),
		EventBatchMax:              envInt("EVENT_BATCH_MAX", 20),
		ItemRegistryPath:           envOrDefault("ITEM_REGISTRY_PATH", "./static-data/data/phobos/fsd_built"),
		ItemValuesPath:             envOrDefault("ITEM_VALUES_PATH", "./continuity-engine/data/item-values.json"),
		CORMPerLUX:                 envFloat("CORM_PER_LUX", 1.0),
		CORMFloorPerUnit:           uint64(envInt("CORM_FLOOR_PER_UNIT", 10)),
		ContractGenerationCooldown: envDurationMs("CONTRACT_GENERATION_COOLDOWN_MS", 30000),
		SeedChainData:              envBool("SEED_CHAIN_DATA", true),
		DatabaseURL:                envOrDefault("DATABASE_URL", "postgresql://corm:corm@localhost:5432/frontier_corm"),
	}

	if path := os.Getenv("ENVIRONMENTS_CONFIG"); path != "" {
		cfg.Environments = loadEnvironments(path)
	} else {
		// Backward-compatible single-environment fallback
		cfg.Environments = []EnvironmentConfig{{
			Name:               "default",
			SUIRpcURL:          envOrDefault("SUI_RPC_URL", "http://127.0.0.1:9000"),
			SUIPrivateKey:      os.Getenv("SUI_PRIVATE_KEY"),
			CormStatePackageID: os.Getenv("CORM_STATE_PACKAGE_ID"),
		}}
	}

	slog.Info(fmt.Sprintf("loaded %d environment(s): %s", len(cfg.Environments), envNames(cfg.Environments)))
	return cfg
}

func loadEnvironments(path string) []EnvironmentConfig {
	data, err := os.ReadFile(path)
	if err != nil {
		slog.Error(fmt.Sprintf("read environments config %s: %v", path, err)); os.Exit(1)
	}

	var envs []EnvironmentConfig
	if err := json.Unmarshal(data, &envs); err != nil {
		slog.Error(fmt.Sprintf("parse environments config: %v", err)); os.Exit(1)
	}

	for i := range envs {
		if envs[i].Name == "" {
			slog.Error(fmt.Sprintf("environment at index %d has no name", i)); os.Exit(1)
		}
		if envs[i].SUIPrivateKeyEnv != "" {
			envs[i].SUIPrivateKey = os.Getenv(envs[i].SUIPrivateKeyEnv)
		}
	}

	if len(envs) == 0 {
		slog.Error("environments config is empty")
		os.Exit(1)
	}

	return envs
}

func envNames(envs []EnvironmentConfig) string {
	names := make([]string, len(envs))
	for i, e := range envs {
		names[i] = e.Name
	}
	return joinStrings(names, ", ")
}

func joinStrings(ss []string, sep string) string {
	if len(ss) == 0 {
		return ""
	}
	result := ss[0]
	for _, s := range ss[1:] {
		result += sep + s
	}
	return result
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envDurationMs(key string, defaultMs int) time.Duration {
	return time.Duration(envInt(key, defaultMs)) * time.Millisecond
}

func envInt(key string, defaultVal int) int {
	s := os.Getenv(key)
	if s == "" {
		return defaultVal
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return defaultVal
	}
	return v
}

func envBool(key string, defaultVal bool) bool {
	s := os.Getenv(key)
	if s == "" {
		return defaultVal
	}
	v, err := strconv.ParseBool(s)
	if err != nil {
		return defaultVal
	}
	return v
}

func envFloat(key string, defaultVal float64) float64 {
	s := os.Getenv(key)
	if s == "" {
		return defaultVal
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return defaultVal
	}
	return v
}
