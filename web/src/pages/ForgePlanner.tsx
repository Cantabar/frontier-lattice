import { useState, useCallback } from "react";
import styled from "styled-components";
import { useIdentity } from "../hooks/useIdentity";
import { useBlueprints } from "../hooks/useBlueprints";
import { useActiveMultiInputContracts, useMultiInputContractObject } from "../hooks/useMultiInputContracts";
import { canViewContract } from "../lib/contractVisibility";
import { BlueprintBrowser } from "../components/forge/BlueprintBrowser";
import { OptimizerPanel } from "../components/forge/OptimizerPanel";
import { BuildQueuePanel } from "../components/forge/BuildQueuePanel";
import { CreateMultiInputContractModal } from "../components/forge/CreateMultiInputContractModal";
import { MultiInputContractCard } from "../components/forge/MultiInputContractCard";
import { MultiInputContractDetail } from "../components/forge/MultiInputContractDetail";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import { PrimaryButton } from "../components/shared/Button";
import type { MultiInputContractData } from "../lib/types";

// ── Page-level tab type ────────────────────────────────────────

type PageTab = "blueprints" | "planner" | "orders";

// ── Styled components ──────────────────────────────────────────

const Page = styled.div``;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const PageTabBar = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 2px solid ${({ theme }) => theme.colors.surface.border};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const PageTabButton = styled.button<{ $active: boolean }>`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  font-size: 14px;
  font-weight: 600;
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
  background: none;
  border: none;
  border-bottom: 2px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.primary.main : "transparent"};
  margin-bottom: -2px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const SectionLabel = styled.h2`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin: ${({ theme }) => theme.spacing.lg} 0 ${({ theme }) => theme.spacing.md};
`;

const PlannerGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.lg};
  align-items: start;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const OrdersHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

// ── Helpers

/** Thin wrapper so each card can independently fetch live fill totals. */
function ContractCardWithLiveState({
  contract,
  onClick,
}: {
  contract: MultiInputContractData;
  onClick: () => void;
}) {
  const { contract: live } = useMultiInputContractObject(contract.id);
  return (
    <MultiInputContractCard
      contract={contract}
      liveFilledTotal={live?.totalFilled}
      onClick={onClick}
    />
  );
}

// ── Page component ─────────────────────────────────────────────

export function ForgePlanner() {
  const { characterId, inGameTribeId } = useIdentity();

  const { blueprints, recipesForOptimizer } = useBlueprints();
  const { contracts: allContracts, isLoading: contractsLoading } = useActiveMultiInputContracts();
  const contracts = allContracts.filter((c) => canViewContract(c, { characterId, inGameTribeId }));

  const [activeTab, setActiveTab] = useState<PageTab>("blueprints");
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  const [selectedContract, setSelectedContract] = useState<MultiInputContractData | null>(null);

  // Optimizer auto-fill: set from build queue or blueprint detail
  const [optimizerTarget, setOptimizerTarget] = useState<number | null>(null);

  const handleResolveFromQueue = useCallback((typeId: number, _quantity: number) => {
    setOptimizerTarget(typeId);
  }, []);

  return (
    <Page>
      <Header>
        <Title>Forge Planner</Title>
      </Header>

      {/* ── Tab bar ── */}
      <PageTabBar>
        <PageTabButton $active={activeTab === "blueprints"} onClick={() => setActiveTab("blueprints")}>
          Blueprints
        </PageTabButton>
        <PageTabButton $active={activeTab === "planner"} onClick={() => setActiveTab("planner")}>
          Planner
        </PageTabButton>
        <PageTabButton $active={activeTab === "orders"} onClick={() => setActiveTab("orders")}>
          Orders
        </PageTabButton>
      </PageTabBar>

      {/* ── Tab: Blueprints ── */}
      {activeTab === "blueprints" && (
        <BlueprintBrowser blueprints={blueprints} />
      )}

      {/* ── Tab: Planner ── */}
      {activeTab === "planner" && (
        <PlannerGrid>
          <OptimizerPanel
            recipes={recipesForOptimizer}
            initialTarget={optimizerTarget}
          />
          <BuildQueuePanel onResolveItem={handleResolveFromQueue} />
        </PlannerGrid>
      )}

      {/* ── Tab: Orders ── */}
      {activeTab === "orders" && (
        <>
          <OrdersHeader>
            <SectionLabel style={{ margin: 0 }}>Active Orders</SectionLabel>
            {characterId && (
              <PrimaryButton onClick={() => setShowCreateOrder(true)}>+ New Order</PrimaryButton>
            )}
          </OrdersHeader>
          {contractsLoading ? (
            <LoadingSpinner />
          ) : contracts.length === 0 ? (
            <EmptyState
              title="No active orders"
              description={characterId ? "Create a new order to get started." : "Connect your wallet to post orders."}
            />
          ) : (
            contracts.map((c) => (
              <ContractCardWithLiveState
                key={c.id}
                contract={c}
                onClick={() => setSelectedContract(c)}
              />
            ))
          )}
        </>
      )}

      {/* ── Modals (available from Orders tab) ── */}
      {showCreateOrder && (
        <CreateMultiInputContractModal onClose={() => setShowCreateOrder(false)} />
      )}

      {selectedContract && (
        <MultiInputContractDetail
          contract={selectedContract}
          characterId={characterId}
          onClose={() => setSelectedContract(null)}
        />
      )}
    </Page>
  );
}
