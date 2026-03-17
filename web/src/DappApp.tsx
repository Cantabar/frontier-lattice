/**
 * Minimal app shell for in-game dApp iframes.
 *
 * Renders without the full sidebar/header chrome so the game client
 * iframe gets a clean, narrow (550px) layout.
 */

import { Routes, Route } from "react-router-dom";
import styled from "styled-components";
import { WalletButton } from "./components/shared/WalletButton";

import { IdentityContext, useIdentityResolver } from "./hooks/useIdentity";
import { SsuDeliveryDapp } from "./pages/SsuDeliveryDapp";

// ---------------------------------------------------------------------------
// Styled
// ---------------------------------------------------------------------------

const Shell = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  max-width: 550px;
  margin: 0 auto;
`;

const TopBar = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surface.border};
`;

const Brand = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const Content = styled.main`
  flex: 1;
  overflow-y: auto;
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DappApp() {
  const identity = useIdentityResolver();

  return (
    <IdentityContext.Provider value={identity}>
      <Shell>
        <TopBar>
          <Brand>Frontier Corm</Brand>
          <WalletButton />
        </TopBar>
        <Content>
          <Routes>
            <Route path="deliver/:ssuId" element={<SsuDeliveryDapp />} />
          </Routes>
        </Content>
      </Shell>
    </IdentityContext.Provider>
  );
}
