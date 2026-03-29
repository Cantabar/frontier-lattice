import styled from "styled-components";
import { useNavigate } from "react-router-dom";
import { useIdentity } from "../hooks/useIdentity";
import { useActiveContracts } from "../hooks/useContracts";
import { useActiveBuildRequests } from "../hooks/useBuildRequests";
import { useContractFilters } from "../hooks/useContractFilters";
import type { StatusTab, SortKey } from "../hooks/useContractFilters";
import { ContractCard } from "../components/contracts/ContractCard";
import { BuildRequestCard } from "../components/contracts/BuildRequestCard";
import { ContractHistory } from "../components/contracts/ContractHistory";
import { ContractFilterPanel } from "../components/contracts/ContractFilterPanel";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import { PrimaryButton, SecondaryButton } from "../components/shared/Button";

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

const SelectControl = styled.select`
  background: ${({ theme }) => theme.colors.surface.raised};
  color: ${({ theme }) => theme.colors.text.secondary};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  font-weight: 600;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const TypeSelect = styled(SelectControl)`
  margin-left: auto;
`;

const SortSelect = styled(SelectControl)``;

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

export function TrustlessContracts() {
  const navigate = useNavigate();
  const { characterId, inGameTribeId } = useIdentity();
  const { contracts, isLoading } = useActiveContracts();
  const { contracts: buildRequests, isLoading: buildReqLoading } = useActiveBuildRequests();

  const filters = useContractFilters(contracts, { characterId, inGameTribeId });

  // Filter build requests by the current status tab
  const filteredBuildRequests = buildRequests.filter((br) => {
    if (filters.statusTab !== "all" && br.status !== filters.statusTab) return false;
    if (filters.typeFilter !== "all" && filters.typeFilter !== ("BuildRequest" as never)) return false;
    return true;
  });

  // When type filter is set to a trustless-specific type, hide build requests
  const showBuildRequests = filters.typeFilter === "all" || filters.typeFilter === ("BuildRequest" as never);

  if (isLoading || buildReqLoading) return <LoadingSpinner />;

  return (
    <Page>
      <Header>
        <Title>Contracts</Title>
        <div style={{ display: "flex", gap: "8px" }}>
          {characterId && <SecondaryButton onClick={() => navigate("/contracts/build/create")}>+ Build Request</SecondaryButton>}
          {characterId && <PrimaryButton onClick={() => navigate("/contracts/create")}>+ Create Contract</PrimaryButton>}
        </div>
      </Header>

      <FilterRow>
        {(["all", "Open", "InProgress", "Completed"] as StatusTab[]).map((t) => (
          <Tab key={t} $active={filters.statusTab === t} onClick={() => filters.setStatusTab(t)}>
            {t === "all" ? "All" : t === "InProgress" ? "In Progress" : t}
          </Tab>
        ))}
        <TypeSelect
          value={filters.typeFilter}
          onChange={(e) => filters.setTypeFilter(e.target.value as Parameters<typeof filters.setTypeFilter>[0])}
        >
          <option value="all">All Types</option>
          <option value="CoinForCoin">Coin → Coin</option>
          <option value="CoinForItem">Coin → Item</option>
          <option value="ItemForCoin">Item → Coin</option>
          <option value="ItemForItem">Item → Item</option>
          <option value="Transport">Transport</option>
          <option value="BuildRequest">Build Request</option>
        </TypeSelect>
        <SortSelect
          value={filters.sortKey}
          onChange={(e) => filters.setSortKey(e.target.value as SortKey)}
        >
          <option value="newest">Newest</option>
          <option value="deadline-asc">Deadline: Soonest</option>
          <option value="deadline-desc">Deadline: Latest</option>
          <option value="reward-high">Reward: High → Low</option>
          <option value="reward-low">Reward: Low → High</option>
        </SortSelect>
      </FilterRow>

      <ContractFilterPanel
        wantedItemTypeId={filters.wantedItemTypeId}
        onWantedItemChange={filters.setWantedItemTypeId}
        offeredItemTypeId={filters.offeredItemTypeId}
        onOfferedItemChange={filters.setOfferedItemTypeId}
        posterCharacterId={filters.posterCharacterId}
        onPosterChange={filters.setPosterCharacterId}
        filterTribeId={filters.filterTribeId}
        onTribeChange={filters.setFilterTribeId}
        filterRegionId={filters.filterRegionId}
        onRegionChange={filters.setFilterRegionId}
        filterConstellationId={filters.filterConstellationId}
        onConstellationChange={filters.setFilterConstellationId}
        activeCount={filters.activeFilterCount}
        onClearAll={filters.clearFilters}
      />

      {filters.filteredAndSorted.length === 0 && filteredBuildRequests.length === 0 ? (
        <EmptyState
          title="No contracts found"
          description="Create a trustless contract or build request, or connect your wallet to browse."
        />
      ) : (
        <Grid>
          {showBuildRequests && filteredBuildRequests.map((br) => (
            <BuildRequestCard key={br.id} contract={br} onClick={() => navigate(`/contracts/build/${br.id}`)} />
          ))}
          {filters.filteredAndSorted.map((c) => (
            <ContractCard key={c.id} contract={c} onClick={() => navigate(`/contracts/${c.id}`)} />
          ))}
        </Grid>
      )}

      <SectionLabel>Contract History</SectionLabel>
      <ContractHistory />
    </Page>
  );
}
