/**
 * Frontier Corm configuration.
 *
 * Package IDs are populated after deployment to a Sui network.
 * For local development, update these after `sui client publish`.
 */

export const config = {
  /** Sui network to connect to */
  network: (import.meta.env.VITE_SUI_NETWORK as "localnet" | "devnet" | "testnet") ?? "localnet",

  /** On-chain package IDs (set after deployment) */
  packages: {
    tribe: import.meta.env.VITE_TRIBE_PACKAGE_ID ?? "0x0",
    forgePlanner: import.meta.env.VITE_FORGE_PLANNER_PACKAGE_ID ?? "0x0",
    multiInputContract: import.meta.env.VITE_MULTI_INPUT_CONTRACT_PACKAGE_ID ?? "0x0",
    trustlessContracts: import.meta.env.VITE_TRUSTLESS_CONTRACTS_PACKAGE_ID ?? "0x0",
    world: import.meta.env.VITE_WORLD_PACKAGE_ID ?? "0x0",
  },

  /** Shared object IDs */
  tribeRegistryId: import.meta.env.VITE_TRIBE_REGISTRY_ID ?? "0x0",
  energyConfigId: import.meta.env.VITE_ENERGY_CONFIG_ID ?? "0x0",

  /** Coin type for escrow/treasury (EVE token on testnet, or test coin on localnet) */
  coinType: import.meta.env.VITE_COIN_TYPE ?? "0x2::sui::SUI",

  /** Fill coin type (CF phantom param). Defaults to coinType for CE=CF=SUI common case. */
  fillCoinType: import.meta.env.VITE_FILL_COIN_TYPE ?? import.meta.env.VITE_COIN_TYPE ?? "0x2::sui::SUI",

  /** Event indexer base URL */
  indexerUrl: import.meta.env.VITE_INDEXER_URL ?? "/api/v1",

  /** Stillness World API base URL (for tribe name backfill) */
  worldApiUrl: import.meta.env.VITE_WORLD_API_URL ?? "https://world-api-stillness.live.tech.evefrontier.com",
} as const;
