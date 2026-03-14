import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import type { TrustlessContractData } from "../../lib/types";
import { truncateAddress, formatAmount, formatDeadline } from "../../lib/format";
import { StatusBadge } from "../shared/StatusBadge";
import { useIdentity } from "../../hooks/useIdentity";
import { useContractObject } from "../../hooks/useContracts";
import {
  buildFillWithCoins,
  buildFillItemForCoin,
  buildAcceptTransport,
  buildCancelTrustlessContract,
  buildExpireTrustlessContract,
} from "../../lib/sui";
import { FillContractModal } from "./FillContractModal";

const Wrapper = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.lg};
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Title = styled.h3`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const TypeTag = styled.span`
  display: inline-block;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.module.trustlessContracts};
  margin-right: ${({ theme }) => theme.spacing.sm};
`;

const DetailGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const Label = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const Value = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.primary};
  font-weight: 500;
`;

const ProgressSection = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const ProgressLabel = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const ProgressTrack = styled.div`
  height: 8px;
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.surface.border};
  overflow: hidden;
`;

const ProgressFill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => $pct}%;
  background: ${({ theme }) => theme.colors.module.trustlessContracts};
  border-radius: 4px;
  transition: width 0.3s ease;
`;

const AccessSection = styled.div`
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const ActionRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  border-top: 1px solid ${({ theme }) => theme.colors.surface.border};
  padding-top: ${({ theme }) => theme.spacing.md};
`;

const Button = styled.button`
  background: ${({ theme }) => theme.colors.primary.main};
  color: #fff;
  border: none;
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.primary.hover};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SecondaryButton = styled(Button)`
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.text.secondary};

  &:hover {
    background: ${({ theme }) => theme.colors.surface.borderHover};
  }
`;

const DangerButton = styled(Button)`
  background: ${({ theme }) => theme.colors.danger};

  &:hover {
    background: #e0222a;
  }
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

function statusVariant(s: TrustlessContractData["status"]): "open" | "in-progress" {
  return s === "InProgress" ? "in-progress" : "open";
}

interface Props {
  contract: TrustlessContractData;
}

export function ContractDetail({ contract: initial }: Props) {
  const { characterId } = useIdentity();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const [showFill, setShowFill] = useState(false);

  // Fetch live object state for up-to-date balances/fill qty
  const { contract: live } = useContractObject(initial.id);
  const c = live ?? initial;

  const isPoster = characterId === c.posterId;
  const isCourier = c.courierId != null && characterId === c.courierId;
  const isOpen = c.status === "Open";
  const isInProgress = c.status === "InProgress";
  const isExpired = Number(c.deadlineMs) < Date.now();

  const filled = Number(c.filledQuantity);
  const target = Number(c.targetQuantity);
  const pct = target > 0 ? Math.min(100, (filled / target) * 100) : 0;

  const isRestricted = c.allowedCharacters.length > 0 || c.allowedTribes.length > 0;

  // Determine which fill actions are available
  const canFillCoins =
    !isPoster && isOpen && !isExpired &&
    (c.contractType.variant === "CoinForCoin" || c.contractType.variant === "ItemForCoin");
  const canFillItems =
    !isPoster && isOpen && !isExpired &&
    (c.contractType.variant === "CoinForItem" || c.contractType.variant === "ItemForItem");
  const canAcceptTransport =
    !isPoster && isOpen && !isExpired && c.contractType.variant === "Transport";
  const canDeliver =
    isCourier && isInProgress && !isExpired && c.contractType.variant === "Transport";
  const canCancel = isPoster && isOpen;
  const canExpire = isExpired;

  async function handleCancel() {
    if (!characterId) return;
    const tx = buildCancelTrustlessContract({ contractId: c.id, characterId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
  }

  async function handleExpire() {
    const tx = buildExpireTrustlessContract({ contractId: c.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
  }

  async function handleAcceptTransport() {
    if (!characterId || c.contractType.variant !== "Transport") return;
    const tx = buildAcceptTransport({
      contractId: c.id,
      stakeAmount: Number(c.contractType.requiredStake),
      characterId,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
  }

  return (
    <>
      <Wrapper>
        <Header>
          <div>
            <TypeTag>{contractTypeLabel(c.contractType)}</TypeTag>
            <Title style={{ display: "inline" }}>Contract Details</Title>
          </div>
          <StatusBadge status={statusVariant(c.status)} />
        </Header>

        <DetailGrid>
          <div>
            <Label>Escrow</Label>
            <Value>{formatAmount(c.escrowAmount)} SUI</Value>
          </div>
          <div>
            <Label>Deadline</Label>
            <Value>{formatDeadline(c.deadlineMs)}</Value>
          </div>
          <div>
            <Label>Target Quantity</Label>
            <Value>{c.targetQuantity}</Value>
          </div>
          <div>
            <Label>Filled</Label>
            <Value>{c.filledQuantity} / {c.targetQuantity}</Value>
          </div>
          <div>
            <Label>Poster</Label>
            <Value>{truncateAddress(c.posterId)}</Value>
          </div>
          <div>
            <Label>Partial Fill</Label>
            <Value>{c.allowPartial ? "Yes" : "No"}</Value>
          </div>
          {c.contractType.variant === "Transport" && (
            <>
              <div>
                <Label>Courier</Label>
                <Value>{c.courierId ? truncateAddress(c.courierId) : "—"}</Value>
              </div>
              <div>
                <Label>Required Stake</Label>
                <Value>{formatAmount(c.stakeAmount)} SUI</Value>
              </div>
            </>
          )}
          {(c.contractType.variant === "CoinForItem" || c.contractType.variant === "ItemForItem") && (
            <div>
              <Label>Destination SSU</Label>
              <Value>{truncateAddress(c.contractType.destinationSsuId)}</Value>
            </div>
          )}
          {(c.contractType.variant === "ItemForCoin" || c.contractType.variant === "ItemForItem") && (
            <div>
              <Label>Source SSU</Label>
              <Value>{truncateAddress(c.contractType.sourceSsuId)}</Value>
            </div>
          )}
          {c.contractType.variant === "Transport" && (
            <div>
              <Label>Destination SSU</Label>
              <Value>{truncateAddress(c.contractType.destinationSsuId)}</Value>
            </div>
          )}
        </DetailGrid>

        {c.allowPartial && (
          <ProgressSection>
            <ProgressLabel>
              <span>Fill Progress</span>
              <span>{Math.round(pct)}%</span>
            </ProgressLabel>
            <ProgressTrack>
              <ProgressFill $pct={pct} />
            </ProgressTrack>
          </ProgressSection>
        )}

        {isRestricted && (
          <AccessSection>
            <strong>Access Restricted</strong>
            {c.allowedCharacters.length > 0 && (
              <div>Characters: {c.allowedCharacters.map(truncateAddress).join(", ")}</div>
            )}
            {c.allowedTribes.length > 0 && (
              <div>Tribes: {c.allowedTribes.join(", ")}</div>
            )}
          </AccessSection>
        )}

        <ActionRow>
          {canFillCoins && (
            <Button onClick={() => setShowFill(true)} disabled={isPending}>
              Fill with Coins
            </Button>
          )}
          {canFillItems && (
            <Button onClick={() => setShowFill(true)} disabled={isPending}>
              Fill with Items
            </Button>
          )}
          {canAcceptTransport && (
            <Button onClick={handleAcceptTransport} disabled={isPending}>
              {isPending ? "Accepting…" : "Accept Transport"}
            </Button>
          )}
          {canDeliver && (
            <Button onClick={() => setShowFill(true)} disabled={isPending}>
              Deliver Items
            </Button>
          )}
          {canCancel && (
            <DangerButton onClick={handleCancel} disabled={isPending}>
              {isPending ? "Cancelling…" : "Cancel"}
            </DangerButton>
          )}
          {canExpire && (
            <SecondaryButton onClick={handleExpire} disabled={isPending}>
              {isPending ? "Expiring…" : "Expire"}
            </SecondaryButton>
          )}
        </ActionRow>
      </Wrapper>

      {showFill && (
        <FillContractModal contract={c} onClose={() => setShowFill(false)} />
      )}
    </>
  );
}
