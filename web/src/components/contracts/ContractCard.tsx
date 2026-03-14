import styled from "styled-components";
import type { TrustlessContractData } from "../../lib/types";
import { truncateAddress, formatAmount, formatDeadline } from "../../lib/format";
import { StatusBadge } from "../shared/StatusBadge";

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
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const TypeTag = styled.span`
  display: inline-block;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
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
  background: ${({ theme }) => theme.colors.module.trustlessContracts};
  border-radius: 2px;
  transition: width 0.2s ease;
`;

// ---------------------------------------------------------------------------

function contractTypeLabel(ct: TrustlessContractData["contractType"]): string {
  switch (ct.variant) {
    case "CoinForCoin": return "Coin → Coin";
    case "CoinForItem": return "Coin → Item";
    case "ItemForCoin": return "Item → Coin";
    case "ItemForItem": return "Item → Item";
    case "Transport": return "Transport";
  }
}

function contractSummary(c: TrustlessContractData): string {
  const ct = c.contractType;
  switch (ct.variant) {
    case "CoinForCoin":
      return `Offering ${formatAmount(ct.offeredAmount)} for ${formatAmount(ct.wantedAmount)}`;
    case "CoinForItem":
      return `Offering ${formatAmount(ct.offeredAmount)} for ${ct.wantedQuantity} items (type ${ct.wantedTypeId})`;
    case "ItemForCoin":
      return `Offering ${ct.offeredQuantity} items (type ${ct.offeredTypeId}) for ${formatAmount(ct.wantedAmount)}`;
    case "ItemForItem":
      return `Trading ${ct.offeredQuantity} items for ${ct.wantedQuantity} items`;
    case "Transport":
      return `Deliver ${ct.itemQuantity} items for ${formatAmount(ct.paymentAmount)} (stake: ${formatAmount(ct.requiredStake)})`;
  }
}

function statusVariant(s: TrustlessContractData["status"]): "open" | "in-progress" {
  return s === "InProgress" ? "in-progress" : "open";
}

interface Props {
  contract: TrustlessContractData;
  onClick?: () => void;
}

export function ContractCard({ contract, onClick }: Props) {
  const filled = Number(contract.filledQuantity);
  const target = Number(contract.targetQuantity);
  const pct = target > 0 ? Math.min(100, (filled / target) * 100) : 0;
  const isRestricted = contract.allowedCharacters.length > 0 || contract.allowedTribes.length > 0;

  return (
    <Card onClick={onClick}>
      <TopRow>
        <div>
          <TypeTag>{contractTypeLabel(contract.contractType)}</TypeTag>
          {isRestricted && <RestrictedTag>Restricted</RestrictedTag>}
        </div>
        <StatusBadge status={statusVariant(contract.status)} />
      </TopRow>
      <Summary>{contractSummary(contract)}</Summary>
      <Meta>
        {contract.escrowAmount !== "0" && (
          <Amount>{formatAmount(contract.escrowAmount)} SUI escrow</Amount>
        )}
        <span>Poster: {truncateAddress(contract.posterId)}</span>
        <span>{formatDeadline(contract.deadlineMs)}</span>
        {contract.allowPartial && <span>Partial OK</span>}
      </Meta>
      {contract.allowPartial && pct > 0 && (
        <ProgressTrack>
          <ProgressFill $pct={pct} />
        </ProgressTrack>
      )}
    </Card>
  );
}
