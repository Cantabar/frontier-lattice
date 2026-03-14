import { useState } from "react";
import styled from "styled-components";
import { useIdentity } from "../hooks/useIdentity";
import { useActiveContracts } from "../hooks/useContracts";
import { ContractCard } from "../components/contracts/ContractCard";
import { ContractDetail } from "../components/contracts/ContractDetail";
import { CreateContractModal } from "../components/contracts/CreateContractModal";
import { ContractHistory } from "../components/contracts/ContractHistory";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import type { TrustlessContractData, TrustlessContractVariant } from "../lib/types";

const Page = styled.div``;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const FilterRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  flex-wrap: wrap;
`;

const Tab = styled.button<{ $active: boolean }>`
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary.subtle : theme.colors.surface.raised};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
  border: 1px solid ${({ $active, theme }) =>
    $active ? theme.colors.primary.subtle : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
`;

const TypeSelect = styled.select`
  background: ${({ theme }) => theme.colors.surface.raised};
  color: ${({ theme }) => theme.colors.text.secondary};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  font-weight: 600;
  margin-left: auto;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const Button = styled.button`
  background: ${({ theme }) => theme.colors.primary.main};
  color: #fff;
  border: none;
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.primary.hover};
  }
`;

const BackButton = styled.button`
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.text.secondary};
  border: none;
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  margin-bottom: ${({ theme }) => theme.spacing.md};

  &:hover {
    background: ${({ theme }) => theme.colors.surface.borderHover};
  }
`;

const Grid = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const SectionLabel = styled.h2`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin: ${({ theme }) => theme.spacing.lg} 0 ${({ theme }) => theme.spacing.md};
`;

// ---------------------------------------------------------------------------

type StatusTab = "all" | "Open" | "InProgress";

export function TrustlessContracts() {
  const { characterId } = useIdentity();
  const { contracts, isLoading, refetch } = useActiveContracts();

  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [typeFilter, setTypeFilter] = useState<TrustlessContractVariant | "all">("all");
  const [selected, setSelected] = useState<TrustlessContractData | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const filtered = contracts.filter((c) => {
    if (statusTab !== "all" && c.status !== statusTab) return false;
    if (typeFilter !== "all" && c.contractType.variant !== typeFilter) return false;
    return true;
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <Page>
      <Header>
        <Title>Trustless Contracts</Title>
        {characterId && <Button onClick={() => setShowCreate(true)}>+ Create Contract</Button>}
      </Header>

      {selected ? (
        <>
          <BackButton onClick={() => setSelected(null)}>← Back to list</BackButton>
          <ContractDetail contract={selected} />
        </>
      ) : (
        <>
          <FilterRow>
            {(["all", "Open", "InProgress"] as StatusTab[]).map((t) => (
              <Tab key={t} $active={statusTab === t} onClick={() => setStatusTab(t)}>
                {t === "all" ? "All" : t === "InProgress" ? "In Progress" : t}
              </Tab>
            ))}
            <TypeSelect
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TrustlessContractVariant | "all")}
            >
              <option value="all">All Types</option>
              <option value="CoinForCoin">Coin → Coin</option>
              <option value="CoinForItem">Coin → Item</option>
              <option value="ItemForCoin">Item → Coin</option>
              <option value="ItemForItem">Item → Item</option>
              <option value="Transport">Transport</option>
            </TypeSelect>
          </FilterRow>

          {filtered.length === 0 ? (
            <EmptyState
              title="No contracts found"
              description="Create a trustless contract or connect your wallet to browse."
            />
          ) : (
            <Grid>
              {filtered.map((c) => (
                <ContractCard key={c.id} contract={c} onClick={() => setSelected(c)} />
              ))}
            </Grid>
          )}
        </>
      )}

      <SectionLabel>Contract History</SectionLabel>
      <ContractHistory />

      {showCreate && (
        <CreateContractModal
          onClose={() => setShowCreate(false)}
          onCreated={() => refetch()}
        />
      )}
    </Page>
  );
}
