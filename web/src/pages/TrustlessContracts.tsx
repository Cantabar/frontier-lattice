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
import { CustomSelect } from "../components/shared/CustomSelect";

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

const TypeSelectWrapper = styled.div`
  margin-left: auto;
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
        <TypeSelectWrapper>
          <CustomSelect
            value={filters.typeFilter}
            onChange={(v) => filters.setTypeFilter(v as Parameters<typeof filters.setTypeFilter>[0])}
            compact
            fullWidth={false}
            options={[
              { value: "all", label: "All Types" },
              { value: "CoinForCoin", label: "Coin → Coin" },
              { value: "CoinForItem", label: "Coin → Item" },
              { value: "ItemForCoin", label: "Item → Coin" },
              { value: "ItemForItem", label: "Item → Item" },
              { value: "Transport", label: "Transport" },
              { value: "BuildRequest", label: "Build Request" },
            ]}
          />
        </TypeSelectWrapper>
        <CustomSelect
          value={filters.sortKey}
          onChange={(v) => filters.setSortKey(v as SortKey)}
          compact
          fullWidth={false}
          options={[
            { value: "newest", label: "Newest" },
            { value: "deadline-asc", label: "Deadline: Soonest" },
            { value: "deadline-desc", label: "Deadline: Latest" },
            { value: "reward-high", label: "Reward: High → Low" },
            { value: "reward-low", label: "Reward: Low → High" },
          ]}
        />
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
