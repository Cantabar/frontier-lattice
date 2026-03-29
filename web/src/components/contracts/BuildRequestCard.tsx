import styled from "styled-components";
import type { BuildRequestContractData } from "../../lib/types";
import { formatAmount, formatDeadline, structureTypeName } from "../../lib/format";
import { useCoinDecimals, defaultCoinType } from "../../hooks/useCoinDecimals";
import { parseCoinSymbol } from "../../lib/coinUtils";
import { StatusBadge } from "../shared/StatusBadge";
import { CharacterDisplay } from "../shared/CharacterDisplay";

const Card = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  padding: ${({ theme }) => theme.spacing.md};
  cursor: pointer;
  transition: border-color 0.15s;
  box-shadow: inset 0 1px 0 ${({ theme }) => theme.colors.rust.muted}26;

  &:hover {
    border-color: ${({ theme }) => theme.colors.surface.borderHover};
  }
`;

const TopRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const TypeTag = styled.span`
  display: inline-block;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  font-family: ${({ theme }) => theme.fonts.heading};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.module.trustlessContracts};
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

const CormAuthTag = styled.span`
  display: inline-block;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.text.muted};
  margin-left: ${({ theme }) => theme.spacing.xs};
`;

const CoinTag = styled.span`
  display: inline-block;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.primary.subtle};
  color: ${({ theme }) => theme.colors.primary.main};
  margin-left: ${({ theme }) => theme.spacing.xs};
`;

const Summary = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`;

const Meta = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const Amount = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary.muted};
`;

// ---------------------------------------------------------------------------

function statusVariant(s: BuildRequestContractData["status"]): "open" | "completed" {
  return s === "Completed" ? "completed" : "open";
}

interface Props {
  contract: BuildRequestContractData;
  onClick?: () => void;
}

export function BuildRequestCard({ contract, onClick }: Props) {
  const coinType = contract.coinType ?? defaultCoinType();
  const isNonDefaultCoin = !!contract.coinType && contract.coinType !== defaultCoinType();
  const { decimals, symbol } = useCoinDecimals(coinType);
  const isRestricted = contract.allowedCharacters.length > 0 || contract.allowedTribes.length > 0;
  const typeName = structureTypeName(contract.requestedTypeId);

  return (
    <Card onClick={onClick}>
      <TopRow>
        <div>
          <TypeTag>Build Request</TypeTag>
          {isNonDefaultCoin && <CoinTag>{parseCoinSymbol(coinType)}</CoinTag>}
          {contract.requireCormAuth && <CormAuthTag>CormAuth</CormAuthTag>}
          {isRestricted && <RestrictedTag>Restricted</RestrictedTag>}
        </div>
        <StatusBadge status={statusVariant(contract.status)} />
      </TopRow>
      <Summary>
        Build <strong>{typeName}</strong> for {formatAmount(contract.bountyAmount, decimals)} {symbol} bounty
      </Summary>
      <Meta>
        <Amount>{formatAmount(contract.bountyAmount, decimals)} {symbol} bounty</Amount>
        <span>Poster: <CharacterDisplay characterId={contract.posterId} showPortrait={false} /></span>
        <span>{formatDeadline(contract.deadlineMs)}</span>
      </Meta>
    </Card>
  );
}
