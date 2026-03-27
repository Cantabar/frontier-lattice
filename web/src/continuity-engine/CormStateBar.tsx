/**
 * CormStateBar — compact on-chain state display for the Continuity Engine.
 *
 * Reads the shared CormState object via `useCormState` and renders phase,
 * stability, and corruption. Hidden when the corm state ID is not configured.
 */

import styled from "styled-components";
import { useCormState } from "./useCormState";

// ---------------------------------------------------------------------------
// Phase labels
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<number, string> = {
  0: "Dormant",
  1: "Interpretation",
  2: "Contracts",
  3: "Stabilization",
  4: "Integration",
  5: "Outpost",
  6: "Continuity",
};

function phaseLabel(phase: number): string {
  return PHASE_LABELS[phase] ?? `Phase ${phase}`;
}

// ---------------------------------------------------------------------------
// Styled
// ---------------------------------------------------------------------------

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surface.border};
  font-family: ${({ theme }) => theme.fonts.body};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
  min-height: 32px;
  flex-shrink: 0;
`;

const Label = styled.span`
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const Value = styled.span`
  color: ${({ theme }) => theme.colors.text.primary};
`;

const MeterGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const MeterTrack = styled.div`
  width: 60px;
  height: 6px;
  background: ${({ theme }) => theme.colors.surface.border};
`;

const MeterFill = styled.div<{ $percent: number; $color: string }>`
  height: 100%;
  width: ${({ $percent }) => Math.min(100, Math.max(0, $percent))}%;
  background: ${({ $color }) => $color};
  transition: width 0.4s ease;
`;

const NodeId = styled.span`
  margin-left: auto;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 11px;
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CormStateBar({ objectId }: { objectId?: string }) {
  const { cormState, isLoading } = useCormState(objectId);

  // Hide entirely when no corm state is configured or available
  if (!cormState && !isLoading) return null;

  if (isLoading) {
    return (
      <Bar>
        <Label>corm</Label>
        <Value>syncing…</Value>
      </Bar>
    );
  }

  if (!cormState) return null;

  const truncatedNode =
    cormState.networkNodeId.length > 10
      ? `${cormState.networkNodeId.slice(0, 6)}…${cormState.networkNodeId.slice(-4)}`
      : cormState.networkNodeId;

  return (
    <Bar>
      <Label>Phase</Label>
      <Value>{phaseLabel(cormState.phase)}</Value>

      <MeterGroup>
        <Label>Stb</Label>
        <MeterTrack>
          <MeterFill $percent={cormState.stability} $color="#69F0AE" />
        </MeterTrack>
        <Value>{cormState.stability}</Value>
      </MeterGroup>

      <MeterGroup>
        <Label>Cor</Label>
        <MeterTrack>
          <MeterFill $percent={cormState.corruption} $color="#FF5252" />
        </MeterTrack>
        <Value>{cormState.corruption}</Value>
      </MeterGroup>

      {truncatedNode && <NodeId title={cormState.networkNodeId}>{truncatedNode}</NodeId>}
    </Bar>
  );
}
