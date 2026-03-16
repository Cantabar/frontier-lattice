import { useState } from "react";
import styled from "styled-components";
import { useNavigate } from "react-router-dom";
import { useIdentity } from "../hooks/useIdentity";
import { useActiveContracts } from "../hooks/useContracts";
import { ContractCard } from "../components/contracts/ContractCard";
import { ContractDetail } from "../components/contracts/ContractDetail";
import { ContractHistory } from "../components/contracts/ContractHistory";
import { canViewContract } from "../lib/contractVisibility";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import { PrimaryButton, SecondaryButton } from "../components/shared/Button";
import type { TrustlessContractVariant } from "../lib/types";

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

const BackButton = styled(SecondaryButton)`
  margin-bottom: ${({ theme }) => theme.spacing.md};
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

type StatusTab = "all" | "Open" | "InProgress" | "Completed";

export function TrustlessContracts() {
  const navigate = useNavigate();
  const { characterId, inGameTribeId } = useIdentity();
  const { contracts, isLoading, refetch } = useActiveContracts();

  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [typeFilter, setTypeFilter] = useState<TrustlessContractVariant | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = contracts.filter((c) => {
    if (!canViewContract(c, { characterId, inGameTribeId })) return false;
    if (statusTab !== "all" && c.status !== statusTab) return false;
    if (typeFilter !== "all" && c.contractType.variant !== typeFilter) return false;
    return true;
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <Page>
      <Header>
        <Title>Trustless Contracts</Title>
        {characterId && <PrimaryButton onClick={() => navigate("/contracts/create")}>+ Create Contract</PrimaryButton>}
      </Header>

      {selectedId && contracts.find((c) => c.id === selectedId) ? (
        <>
          <BackButton onClick={() => setSelectedId(null)}>← Back to list</BackButton>
          <ContractDetail contract={contracts.find((c) => c.id === selectedId)!} onStatusChange={() => { setSelectedId(null); refetch(); }} />
        </>
      ) : (
        <>
          <FilterRow>
            {(["all", "Open", "InProgress", "Completed"] as StatusTab[]).map((t) => (
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
                <ContractCard key={c.id} contract={c} onClick={() => setSelectedId(c.id)} />
              ))}
            </Grid>
          )}
        </>
      )}

      <SectionLabel>Contract History</SectionLabel>
      <ContractHistory />
    </Page>
  );
}
