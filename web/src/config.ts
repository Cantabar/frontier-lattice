/**
 * Frontier Corm configuration.
 *
 * Package IDs are populated after deployment to a Sui network.
 * For local development, update these after `sui client publish`.
 */

// ---------------------------------------------------------------------------
// Environment type
// ---------------------------------------------------------------------------

export type AppEnv = "utopia" | "stillness" | "local";

/** Active application environment, controlled by VITE_APP_ENV. */
const appEnv: AppEnv =
  (["utopia", "stillness", "local"] as const).includes(
    import.meta.env.VITE_APP_ENV as AppEnv,
  )
    ? (import.meta.env.VITE_APP_ENV as AppEnv)
    : "local";

// ---------------------------------------------------------------------------
// Per-environment defaults
// ---------------------------------------------------------------------------

interface EnvDefaults {
  network: "localnet" | "devnet" | "testnet";
  worldApiUrl: string;
  indexerUrl: string;
  webUiHost: string;
  /** When set, the SPA fetches Sui RPC via this same-origin path (CloudFront proxy). */
  suiRpcUrl: string;
}

const envDefaults: Record<AppEnv, EnvDefaults> = {
  utopia: {
    network: "testnet",
    worldApiUrl: "https://world-api-utopia.live.tech.evefrontier.com",
    indexerUrl: "/api/v1",
    webUiHost: "https://utopia.ef-corm.com",
    suiRpcUrl: "/sui-rpc",
  },
  stillness: {
    network: "testnet",
    worldApiUrl: "https://world-api-stillness.live.tech.evefrontier.com",
    indexerUrl: "/api/v1",
    webUiHost: "https://ef-corm.com",
    suiRpcUrl: "/sui-rpc",
  },
  local: {
    network: "localnet",
    worldApiUrl: "",
    indexerUrl: "/api/v1",
    webUiHost: "http://localhost:5173",
    suiRpcUrl: "",
  },
};

const defaults = envDefaults[appEnv];

// ---------------------------------------------------------------------------
// Exported config (explicit VITE_* overrides always win)
// ---------------------------------------------------------------------------

export const config = {
  /** Active application environment */
  appEnv,

  /** Sui network to connect to */
  network: (import.meta.env.VITE_SUI_NETWORK as "localnet" | "devnet" | "testnet") ?? defaults.network,

  /** On-chain package IDs (set after deployment) */
  packages: {
    tribe: import.meta.env.VITE_TRIBE_PACKAGE_ID ?? "0x0",
    trustlessContracts: import.meta.env.VITE_TRUSTLESS_CONTRACTS_PACKAGE_ID ?? "0x0",
    cormAuth: import.meta.env.VITE_CORM_AUTH_PACKAGE_ID ?? "0x0",
    cormState: import.meta.env.VITE_CORM_STATE_PACKAGE_ID ?? "0x0",
    world: import.meta.env.VITE_WORLD_PACKAGE_ID ?? "0x0",
    assemblyMetadata: import.meta.env.VITE_ASSEMBLY_METADATA_PACKAGE_ID ?? "0x0",
    witnessedContracts: import.meta.env.VITE_WITNESSED_CONTRACTS_PACKAGE_ID ?? "0x0",
  },

  /**
   * Original package IDs for upgraded packages. On Sui, struct types (events,
   * objects, coins) remain anchored to the original defining package, not the
   * upgraded `published-at` address. Use these for event queries and type
   * arguments; use `packages.*` for function call targets.
   *
   * Defaults to the corresponding `packages.*` value when not set, which is
   * correct for packages that have never been upgraded.
   */
  originalIds: {
    cormState: import.meta.env.VITE_CORM_STATE_ORIGINAL_ID || import.meta.env.VITE_CORM_STATE_PACKAGE_ID || "0x0",
    cormAuth: import.meta.env.VITE_CORM_AUTH_ORIGINAL_ID || import.meta.env.VITE_CORM_AUTH_PACKAGE_ID || "0x0",
  },

  /** Shared object IDs */
  tribeRegistryId: import.meta.env.VITE_TRIBE_REGISTRY_ID ?? "0x0",
  energyConfigId: import.meta.env.VITE_ENERGY_CONFIG_ID ?? "0x0",

  /** CORM coin type. When set, this becomes the preferred default for contracts. */
  cormCoinType: import.meta.env.VITE_CORM_COIN_TYPE ?? "",

  /** Fallback coin type for escrow/treasury when CORM is not configured. */
  coinType: import.meta.env.VITE_COIN_TYPE ?? "0x2::sui::SUI",

  /** Fallback fill coin type (CF phantom param) when CORM is not configured. */
  fillCoinType: import.meta.env.VITE_FILL_COIN_TYPE ?? import.meta.env.VITE_COIN_TYPE ?? "0x2::sui::SUI",

  /** Event indexer base URL */
  indexerUrl: import.meta.env.VITE_INDEXER_URL ?? defaults.indexerUrl,
  /** Web UI host used to compose in-game dApp URLs for SSUs */
  webUiHost: import.meta.env.VITE_WEB_UI_HOST ?? defaults.webUiHost,

  /** World API base URL (for tribe name backfill) */
  worldApiUrl: import.meta.env.VITE_WORLD_API_URL ?? defaults.worldApiUrl,

  /** Continuity Engine URL (Go + HTMX service iframe) */
  continuityEngineUrl: import.meta.env.VITE_CONTINUITY_ENGINE_URL ?? "http://localhost:3300",

  /** Sui RPC proxy URL (same-origin CloudFront proxy). Empty = use SDK default. */
  suiRpcUrl: (import.meta.env.VITE_SUI_RPC_URL as string) ?? defaults.suiRpcUrl,

  /** CormState shared object ID (set after first corm creation) */
  cormStateId: import.meta.env.VITE_CORM_STATE_ID ?? "",

  /** CormConfig shared object ID (created by admin via create_config) */
  cormConfigId: import.meta.env.VITE_CORM_CONFIG_ID ?? "",

  /** MetadataRegistry shared object ID (assembly_metadata package) */
  metadataRegistryId: import.meta.env.VITE_METADATA_REGISTRY_ID ?? "",
} as const;
