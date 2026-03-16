import styled from "styled-components";
import type { MultiInputContractData } from "../../lib/types";
import { formatAmount, formatDeadline } from "../../lib/format";
import { useEscrowCoinDecimals } from "../../hooks/useCoinDecimals";
import { CopyableId } from "../shared/CopyableId";
import { CharacterDisplay } from "../shared/CharacterDisplay";

const Card = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
  cursor: pointer;
  transition: border-color 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.surface.borderHover};
  }
`;

const TopRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const TypeTag = styled.span`
  display: inline-block;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.module.forgePlanner};
`;

const RestrictedTag = styled.span`
  display: inline-block;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.primary.subtle};
  color: ${({ theme }) => theme.colors.primary.muted};
  margin-left: ${({ theme }) => theme.spacing.xs};
`;

const Description = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.md};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const BountyAmount = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary.muted};
`;

const SlotCount = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const ProgressTrack = styled.div`
  height: 4px;
  border-radius: 2px;
  background: ${({ theme }) => theme.colors.surface.border};
  margin-top: ${({ theme }) => theme.spacing.sm};
  overflow: hidden;
`;

const ProgressFill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => $pct}%;
  background: ${({ theme }) => theme.colors.module.forgePlanner};
  border-radius: 2px;
  transition: width 0.2s ease;
`;

interface Props {
  contract: MultiInputContractData;
  /** Live totalFilled from getObject (replaces event-sourced 0). */
  liveFilledTotal?: number;
  onClick?: () => void;
}

export function MultiInputContractCard({ contract, liveFilledTotal, onClick }: Props) {
  const { decimals, symbol: coinSymbol } = useEscrowCoinDecimals();
  const total = contract.totalRequired;
  const filled = liveFilledTotal ?? contract.totalFilled;
  const pct = total > 0 ? Math.min(100, (filled / total) * 100) : 0;
  const isRestricted =
    contract.allowedCharacters.length > 0 || contract.allowedTribes.length > 0;

  return (
    <Card onClick={onClick}>
      <TopRow>
        <div>
          <TypeTag>Multi-Input Order</TypeTag>
          {isRestricted && <RestrictedTag>Restricted</RestrictedTag>}
        </div>
        <SlotCount>{contract.slots.length} slot{contract.slots.length !== 1 ? "s" : ""}</SlotCount>
      </TopRow>

      <Description title={contract.description}>
        {contract.description || <CopyableId id={contract.id} />}
      </Description>

      <Meta>
        <BountyAmount>{formatAmount(contract.bountyAmount, decimals)} {coinSymbol} bounty</BountyAmount>
        <span>Poster: <CharacterDisplay characterId={contract.posterId} showPortrait={false} /></span>
        <span>{formatDeadline(contract.deadlineMs)}</span>
        {total > 0 && <span>{filled.toLocaleString()} / {total.toLocaleString()} units</span>}
      </Meta>

      <ProgressTrack>
        <ProgressFill $pct={pct} />
      </ProgressTrack>
    </Card>
  );
}
