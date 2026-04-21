import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "styled-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

import { theme } from "./styles/theme";
import { GlobalStyles } from "./styles/globalStyles";
import { config } from "./config";
import { NotificationProvider } from "./hooks/useNotifications";
import App from "./App";

import "@mysten/dapp-kit/dist/index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

const { networkConfig } = createNetworkConfig({
  localnet: { url: getJsonRpcFullnodeUrl("localnet"), network: "localnet" },
  devnet: { url: getJsonRpcFullnodeUrl("devnet"), network: "devnet" },
  testnet: { url: config.suiRpcUrl || getJsonRpcFullnodeUrl("testnet"), network: "testnet" },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={config.network}>
        <WalletProvider autoConnect>
          <ThemeProvider theme={theme}>
            <GlobalStyles />
            <BrowserRouter>
              <NotificationProvider>
                <App />
              </NotificationProvider>
            </BrowserRouter>
          </ThemeProvider>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
);
