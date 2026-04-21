import { useState } from "react";
import styled from "styled-components";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CollapsibleSummaryProps {
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
  nodeCount: number;
  energyReserved: number;
  energyMax: number;
  cormEnabledCount: number;
  totalSsuCount: number;
}

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const SummaryHeader = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const SummaryTitle = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const SummaryToggle = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
  line-height: 1;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const SummaryBody = styled.div<{ $open: boolean }>`
  display: ${({ $open }) => ($open ? "grid" : "none")};
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
`;

const SummaryCard = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
`;

const CardLabel = styled.div`
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const CardValue = styled.div`
  font-size: 20px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "frontier-corm:structures-summary-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CollapsibleSummary({
  totalCount,
  onlineCount,
  offlineCount,
  nodeCount,
  energyReserved,
  energyMax,
  cormEnabledCount,
  totalSsuCount,
}: CollapsibleSummaryProps) {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  function handleToggle() {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });
  }

  return (
    <div>
      <SummaryHeader>
        <SummaryTitle>Summary</SummaryTitle>
        <SummaryToggle
          aria-label="Toggle summary"
          onClick={handleToggle}
        >
          {collapsed ? "▸" : "▾"}
        </SummaryToggle>
      </SummaryHeader>
      <SummaryBody data-testid="summary-body" $open={!collapsed}>
        <SummaryCard>
          <CardLabel>Total</CardLabel>
          <CardValue>{totalCount}</CardValue>
        </SummaryCard>
        <SummaryCard>
          <CardLabel>Online</CardLabel>
          <CardValue>{onlineCount}</CardValue>
        </SummaryCard>
        <SummaryCard>
          <CardLabel>Offline</CardLabel>
          <CardValue>{offlineCount}</CardValue>
        </SummaryCard>
        <SummaryCard>
          <CardLabel>Nodes</CardLabel>
          <CardValue>{nodeCount}</CardValue>
        </SummaryCard>
        <SummaryCard>
          <CardLabel>Energy</CardLabel>
          <CardValue>
            {energyReserved} / {energyMax} GJ
          </CardValue>
        </SummaryCard>
        <SummaryCard>
          <CardLabel>CORM Enabled</CardLabel>
          <CardValue>
            {cormEnabledCount} / {totalSsuCount} SSUs
          </CardValue>
        </SummaryCard>
      </SummaryBody>
    </div>
  );
}
