/**
 * Frontier Lattice configuration.
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
    contractBoard: import.meta.env.VITE_CONTRACT_BOARD_PACKAGE_ID ?? "0x0",
    forgePlanner: import.meta.env.VITE_FORGE_PLANNER_PACKAGE_ID ?? "0x0",
    trustlessContracts: import.meta.env.VITE_TRUSTLESS_CONTRACTS_PACKAGE_ID ?? "0x0",
    world: import.meta.env.VITE_WORLD_PACKAGE_ID ?? "0x0",
  },

  /** Coin type for escrow/treasury (EVE token on testnet, or test coin on localnet) */
  coinType: import.meta.env.VITE_COIN_TYPE ?? "0x2::sui::SUI",

  /** Fill coin type (CF phantom param). Defaults to coinType for CE=CF=SUI common case. */
  fillCoinType: import.meta.env.VITE_FILL_COIN_TYPE ?? import.meta.env.VITE_COIN_TYPE ?? "0x2::sui::SUI",

  /** Event indexer base URL */
  indexerUrl: import.meta.env.VITE_INDEXER_URL ?? "/api/v1",
} as const;
