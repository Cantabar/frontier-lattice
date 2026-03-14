import { useState, useMemo } from "react";
import styled from "styled-components";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useMyStructures } from "../hooks/useStructures";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import { truncateAddress } from "../lib/format";
import { ASSEMBLY_TYPES } from "../lib/types";
import type { AssemblyData, AssemblyTypeFilter, AssemblyStatus } from "../lib/types";

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Page = styled.div`
  max-width: 960px;
`;

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

const ConnectPrompt = styled.div`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xxl};
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 16px;
`;

const SummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const SummaryCard = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
`;

const CardLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const CardValue = styled.div`
  font-size: 20px;
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
  border: 1px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.primary.subtle : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
`;

const StatusSelect = styled.select`
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

const Grid = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const StructureCard = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  transition: border-color 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.surface.borderHover};
  }
`;

const StructureInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const StructureName = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const StructureMeta = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: 2px;
`;

const TypeBadge = styled.span`
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.secondary.accentMuted};
  color: ${({ theme }) => theme.colors.secondary.accent};
  white-space: nowrap;
`;

const StatusDot = styled.span<{ $status: AssemblyStatus }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  background: ${({ $status, theme }) => {
    switch ($status) {
      case "Online":
        return theme.colors.success;
      case "Offline":
        return theme.colors.text.muted;
      case "Anchored":
        return theme.colors.warning;
      case "Unanchoring":
        return theme.colors.danger;
    }
  }};
`;

const StatusLabel = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
`;

const EnergyIndicator = styled.span<{ $connected: boolean }>`
  font-size: 11px;
  color: ${({ $connected, theme }) =>
    $connected ? theme.colors.success : theme.colors.text.muted};
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTypeCategory(typeId: number): "SSU" | "Gate" | "Turret" | "Unknown" {
  const entry = ASSEMBLY_TYPES[typeId];
  if (entry) return entry.short as "SSU" | "Gate" | "Turret";
  return "Unknown";
}

function getTypeLabel(typeId: number): string {
  return ASSEMBLY_TYPES[typeId]?.label ?? `Type ${typeId}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MyStructuresPage() {
  const account = useCurrentAccount();
  const { structures, isLoading } = useMyStructures();

  const [typeFilter, setTypeFilter] = useState<AssemblyTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<AssemblyStatus | "all">("all");

  const filtered = useMemo(
    () =>
      structures.filter((s) => {
        if (typeFilter !== "all" && getTypeCategory(s.typeId) !== typeFilter) return false;
        if (statusFilter !== "all" && s.status !== statusFilter) return false;
        return true;
      }),
    [structures, typeFilter, statusFilter],
  );

  const onlineCount = structures.filter((s) => s.status === "Online").length;
  const offlineCount = structures.filter((s) => s.status !== "Online").length;

  if (!account) {
    return (
      <Page>
        <Title>My Structures</Title>
        <ConnectPrompt>Connect your wallet to view your structures.</ConnectPrompt>
      </Page>
    );
  }

  return (
    <Page>
      <Header>
        <Title>My Structures</Title>
      </Header>

      {/* Summary cards */}
      <SummaryGrid>
        <SummaryCard>
          <CardLabel>Total</CardLabel>
          <CardValue>{structures.length}</CardValue>
        </SummaryCard>
        <SummaryCard>
          <CardLabel>Online</CardLabel>
          <CardValue>{onlineCount}</CardValue>
        </SummaryCard>
        <SummaryCard>
          <CardLabel>Offline</CardLabel>
          <CardValue>{offlineCount}</CardValue>
        </SummaryCard>
      </SummaryGrid>

      {/* Filters */}
      <FilterRow>
        {(["all", "SSU", "Gate", "Turret"] as AssemblyTypeFilter[]).map((t) => (
          <Tab key={t} $active={typeFilter === t} onClick={() => setTypeFilter(t)}>
            {t === "all" ? "All Types" : t}
          </Tab>
        ))}
        <StatusSelect
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AssemblyStatus | "all")}
        >
          <option value="all">All Statuses</option>
          <option value="Online">Online</option>
          <option value="Offline">Offline</option>
          <option value="Anchored">Anchored</option>
          <option value="Unanchoring">Unanchoring</option>
        </StatusSelect>
      </FilterRow>

      {/* List */}
      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No structures found"
          description={
            structures.length === 0
              ? "You don't own any on-chain structures yet."
              : "No structures match the current filters."
          }
        />
      ) : (
        <Grid>
          {filtered.map((s) => (
            <StructureRow key={s.id} structure={s} />
          ))}
        </Grid>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Structure row sub-component
// ---------------------------------------------------------------------------

function StructureRow({ structure }: { structure: AssemblyData }) {
  const displayName = structure.name || truncateAddress(structure.id, 10, 6);

  return (
    <StructureCard>
      <StructureInfo>
        <StructureName>{displayName}</StructureName>
        <StructureMeta>
          <code>{truncateAddress(structure.id)}</code>
          {structure.description && ` · ${structure.description}`}
        </StructureMeta>
      </StructureInfo>

      <TypeBadge>{getTypeLabel(structure.typeId)}</TypeBadge>

      <StatusLabel>
        <StatusDot $status={structure.status} />
        {structure.status}
      </StatusLabel>

      <EnergyIndicator $connected={!!structure.energySourceId}>
        {structure.energySourceId ? "⚡ Connected" : "— No energy"}
      </EnergyIndicator>
    </StructureCard>
  );
}
