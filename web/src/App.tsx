import { useEffect, lazy, Suspense } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import styled from "styled-components";

import { IdentityContext, useIdentityResolver } from "./hooks/useIdentity";
import { useNotifications } from "./hooks/useNotifications";
import { onIndexerError } from "./lib/indexer";
import { Header } from "./components/layout/Header";
import { Sidebar } from "./components/layout/Sidebar";
import { AutoJoinBanner } from "./components/tribe/AutoJoinBanner";
import { Dashboard } from "./pages/Dashboard";
import { TribePage } from "./pages/TribePage";
import { ForgePlanner } from "./pages/ForgePlanner";
import { EventExplorer } from "./pages/EventExplorer";
import { TrustlessContracts } from "./pages/TrustlessContracts";
import { CreateContractPage } from "./pages/CreateContractPage";
import { TribeListPage } from "./pages/TribeListPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { MyStructuresPage } from "./pages/MyStructuresPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ToastContainer } from "./components/shared/Toast";
import { LoadingSpinner } from "./components/shared/LoadingSpinner";

const DappApp = lazy(() => import("./DappApp"));

const Shell = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const Main = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const Content = styled.main`
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.lg};
`;

export default function App() {
  const identity = useIdentityResolver();
  const { push } = useNotifications();
  const location = useLocation();

  // Subscribe to indexer fetch errors and surface them as notifications
  useEffect(() => {
    return onIndexerError((error, path) => {
      push({
        level: "error",
        title: "Indexer Error",
        message: `${error.message} (${path})`,
        source: "indexer",
      });
    });
  }, [push]);

  // Render the lightweight dApp shell for /dapp/* routes (no sidebar/header)
  if (location.pathname.startsWith("/dapp")) {
    return (
      <Suspense fallback={<LoadingSpinner />}>
        <DappApp />
      </Suspense>
    );
  }

  return (
    <IdentityContext.Provider value={identity}>
      <Shell>
        <Header />
        <AutoJoinBanner />
        <Main>
          <Sidebar />
          <Content>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/tribes" element={<TribeListPage />} />
              <Route path="/tribe/:tribeId" element={<TribePage />} />
              <Route path="/contracts" element={<TrustlessContracts />} />
              <Route path="/contracts/create" element={<CreateContractPage />} />
              <Route path="/forge" element={<ForgePlanner />} />
              <Route path="/events" element={<EventExplorer />} />
              <Route path="/structures" element={<MyStructuresPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Content>
        </Main>
        <ToastContainer />
      </Shell>
    </IdentityContext.Provider>
  );
}
