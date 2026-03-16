import type { ReactNode } from "react";
import styled from "styled-components";
import type { TrustlessContractData } from "../../lib/types";
import { formatAmount, formatDeadline, contractTypeLabel } from "../../lib/format";
import { useEscrowCoinDecimals, useFillCoinDecimals } from "../../hooks/useCoinDecimals";
import { StatusBadge } from "../shared/StatusBadge";
import { ItemBadge } from "../shared/ItemBadge";
import { PrimaryButton, SecondaryButton } from "../shared/Button";

// ---------------------------------------------------------------------------
// Styled
// ---------------------------------------------------------------------------

const Card = styled.div<{ $fulfillable: boolean }>`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid
    ${({ $fulfillable, theme }) =>
      $fulfillable ? theme.colors.primary.subtle : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  transition: border-color 0.15s;
  opacity: ${({ $fulfillable }) => ($fulfillable ? 1 : 0.7)};

  &:hover {
    border-color: ${({ theme }) => theme.colors.surface.borderHover};
    opacity: 1;
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
  color: ${({ theme }) => theme.colors.module.trustlessContracts};
`;

const Summary = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  line-height: 1.4;
`;

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const Reward = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary.muted};
`;

const ProgressTrack = styled.div`
  height: 3px;
  border-radius: 2px;
  background: ${({ theme }) => theme.colors.surface.border};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
  overflow: hidden;
`;

const ProgressFill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => $pct}%;
  background: ${({ theme }) => theme.colors.module.trustlessContracts};
  border-radius: 2px;
`;

const ActionRow = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const DeliverButton = styled(PrimaryButton)`
  font-size: 12px;
  padding: 4px 12px;
`;

const ViewButton = styled(SecondaryButton)`
  font-size: 12px;
  padding: 4px 12px;
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wantedSummary(
  c: TrustlessContractData,
  ce: { decimals: number; symbol: string },
  cf: { decimals: number; symbol: string },
): ReactNode {
  const ct = c.contractType;
  switch (ct.variant) {
    case "CoinForCoin":
      return <>Wants {formatAmount(ct.wantedAmount, cf.decimals)} {cf.symbol}</>;
    case "CoinForItem":
      return (
        <>
          Wants <ItemBadge typeId={ct.wantedTypeId} showQuantity={ct.wantedQuantity} />
        </>
      );
    case "ItemForCoin": {
      const released = c.itemsReleased ?? 0;
      const remaining = ct.offeredQuantity - released;
      return (
        <>
          Offers <ItemBadge typeId={ct.offeredTypeId} showQuantity={remaining > 0 && released > 0 ? remaining : ct.offeredQuantity} />
          {released > 0 ? " remaining" : ""} for {formatAmount(ct.wantedAmount, cf.decimals)} {cf.symbol}
        </>
      );
    }
    case "ItemForItem":
      return (
        <>
          Wants <ItemBadge typeId={ct.wantedTypeId} showQuantity={ct.wantedQuantity} />
        </>
      );
    case "Transport":
      return (
        <>
          Deliver <ItemBadge typeId={ct.itemTypeId} showQuantity={ct.itemQuantity} />
        </>
      );
  }
}

function rewardLabel(
  c: TrustlessContractData,
  ce: { decimals: number; symbol: string },
  cf: { decimals: number; symbol: string },
): string {
  const ct = c.contractType;
  switch (ct.variant) {
    case "CoinForItem":
      return `${formatAmount(ct.offeredAmount, ce.decimals)} ${ce.symbol} reward`;
    case "ItemForItem":
      return "Item swap";
    case "Transport":
      return `${formatAmount(ct.paymentAmount, ce.decimals)} ${ce.symbol} payment`;
    case "CoinForCoin":
      return `${formatAmount(ct.offeredAmount, ce.decimals)} ${ce.symbol} offered`;
    case "ItemForCoin":
      return `${formatAmount(ct.wantedAmount, cf.decimals)} ${cf.symbol} wanted`;
    default:
      return "";
  }
}

function statusVariant(s: TrustlessContractData["status"]): "open" | "in-progress" {
  return s === "InProgress" ? "in-progress" : "open";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  contract: TrustlessContractData;
  canFulfill: boolean;
  onDeliver: () => void;
  onView?: () => void;
}

export function DappContractCard({ contract, canFulfill, onDeliver, onView }: Props) {
  const ce = useEscrowCoinDecimals();
  const cf = useFillCoinDecimals();
  const filled = Number(contract.filledQuantity);
  const target = Number(contract.targetQuantity);
  const pct = target > 0 ? Math.min(100, (filled / target) * 100) : 0;

  return (
    <Card $fulfillable={canFulfill}>
      <TopRow>
        <TypeTag>{contractTypeLabel(contract.contractType.variant)}</TypeTag>
        <StatusBadge status={statusVariant(contract.status)} />
      </TopRow>

      <Summary>{wantedSummary(contract, ce, cf)}</Summary>

      <Meta>
        <Reward>{rewardLabel(contract, ce, cf)}</Reward>
        {contract.escrowAmount !== "0" && (
          <span>{formatAmount(contract.escrowAmount, ce.decimals)} {ce.symbol} reward</span>
        )}
        <span>{formatDeadline(contract.deadlineMs)}</span>
        {contract.allowPartial && <span>Partial OK</span>}
      </Meta>

      {contract.allowPartial && pct > 0 && (
        <ProgressTrack>
          <ProgressFill $pct={pct} />
        </ProgressTrack>
      )}

      <ActionRow>
        {onView && (
          <ViewButton onClick={onView}>Details</ViewButton>
        )}
        <DeliverButton onClick={onDeliver} disabled={!canFulfill}>
          Deliver
        </DeliverButton>
      </ActionRow>
    </Card>
  );
}
