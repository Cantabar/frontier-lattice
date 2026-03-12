import styled from "styled-components";
import type { TribeData } from "../../lib/types";
import { formatAmount } from "../../lib/format";

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
`;

const CardLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const CardValue = styled.div`
  font-size: 20px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

export function TribeOverview({ tribe }: { tribe: TribeData }) {
  return (
    <Grid>
      <Card>
        <CardLabel>Members</CardLabel>
        <CardValue>{tribe.memberCount}</CardValue>
      </Card>
      <Card>
        <CardLabel>Treasury</CardLabel>
        <CardValue>{formatAmount(tribe.treasuryBalance)}</CardValue>
      </Card>
      <Card>
        <CardLabel>Vote Threshold</CardLabel>
        <CardValue>{tribe.voteThreshold}%</CardValue>
      </Card>
    </Grid>
  );
}
