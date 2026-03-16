import styled from "styled-components";
import type { TribeData } from "../../lib/types";
import { formatAmount } from "../../lib/format";
import { parseCoinModule } from "../../lib/coinUtils";
import { useCoinDecimals } from "../../hooks/useCoinDecimals";

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

const CoinTooltip = styled.span`
  cursor: help;
  border-bottom: 1px dotted ${({ theme }) => theme.colors.text.muted};
`;

export function TribeOverview({ tribe }: { tribe: TribeData }) {
  const { decimals, symbol } = useCoinDecimals(tribe.coinType);
  const module = parseCoinModule(tribe.coinType);

  return (
    <Grid>
      <Card>
        <CardLabel>In-Game Tribe</CardLabel>
        <CardValue>#{tribe.inGameTribeId}</CardValue>
      </Card>
      <Card>
        <CardLabel>Members</CardLabel>
        <CardValue>{tribe.memberCount}</CardValue>
      </Card>
      <Card>
        <CardLabel>Treasury</CardLabel>
        <CardValue>{formatAmount(tribe.treasuryBalance, decimals)} {symbol}</CardValue>
      </Card>
      <Card>
        <CardLabel>Coin Type</CardLabel>
        <CardValue>
          <CoinTooltip title={tribe.coinType}>{module}</CoinTooltip>
        </CardValue>
      </Card>
      <Card>
        <CardLabel>Vote Threshold</CardLabel>
        <CardValue>{tribe.voteThreshold}%</CardValue>
      </Card>
    </Grid>
  );
}
