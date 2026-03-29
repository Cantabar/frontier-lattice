import { useState, useCallback } from "react";
import { useLocation, Link } from "react-router-dom";
import styled from "styled-components";
import { useSuiClient, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import type { TrustlessContractData } from "../../lib/types";
import { formatAmount, formatDeadline, contractTypeLabel } from "../../lib/format";
import { CopyableId } from "../shared/CopyableId";
import { CharacterDisplay } from "../shared/CharacterDisplay";
import { StatusBadge } from "../shared/StatusBadge";
import { ItemBadge } from "../shared/ItemBadge";
import { useIdentity } from "../../hooks/useIdentity";
import { useContractObject } from "../../hooks/useContracts";
import { useNotifications } from "../../hooks/useNotifications";
import {
  buildFillWithCoins,
  buildFillItemForCoin,
  buildAcceptTransport,
  buildCancelTrustlessContract,
  buildCancelItemContract,
  buildExpireTrustlessContract,
  buildExpireItemContract,
  buildCleanupCompletedContract,
  buildCleanupCompletedItemContract,
} from "../../lib/sui";
import { FillContractModal } from "./FillContractModal";
import { useCoinDecimals, defaultCoinType } from "../../hooks/useCoinDecimals";
import { parseCoinSymbol } from "../../lib/coinUtils";
import { PrimaryButton, SecondaryButton as SharedSecondary, DangerButton as SharedDanger } from "../shared/Button";

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

const ProximitySection = styled.div`
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  font-size: 12px;
`;

const ProximityTitle = styled.strong`
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const ProximityRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const ProximityLink = styled(Link)`
  color: ${({ theme }) => theme.colors.primary.main};
  font-weight: 500;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const ActionRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  border-top: 1px solid ${({ theme }) => theme.colors.surface.border};
  padding-top: ${({ theme }) => theme.spacing.md};
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const ShareBtn = styled.button`
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text.muted};
  padding: 4px 8px;
  border-radius: ${({ theme }) => theme.radii.sm};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  transition: color 0.15s, border-color 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.primary.main};
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const ContractIdRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const CoinTag = styled.span`
  display: inline-block;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.primary.subtle};
  color: ${({ theme }) => theme.colors.primary.main};
  margin-right: ${({ theme }) => theme.spacing.sm};
`;


// ---------------------------------------------------------------------------


function statusVariant(s: TrustlessContractData["status"]): "open" | "in-progress" | "completed" {
  if (s === "Completed") return "completed";
  return s === "InProgress" ? "in-progress" : "open";
}

interface Props {
  contract: TrustlessContractData;
  onStatusChange?: () => void;
}

export function ContractDetail({ contract: initial, onStatusChange }: Props) {
  const { characterId } = useIdentity();
  const location = useLocation();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const queryClient = useQueryClient();
  const { push } = useNotifications();
  const [showFill, setShowFill] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Fetch live object state for up-to-date balances/fill qty
  const { contract: live } = useContractObject(initial.id);
  const c = live ?? initial;

  const resolvedCoinType = c.coinType ?? defaultCoinType();
  const isNonDefaultCoin = !!c.coinType && c.coinType !== defaultCoinType();
  const { decimals: ceDecimals, symbol: ceSymbol } = useCoinDecimals(resolvedCoinType);
  const { decimals: cfDecimals, symbol: cfSymbol } = useCoinDecimals(resolvedCoinType);

  /** Invalidate cached contract state so the UI refreshes after a fill. */
  const handleFilled = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["contractLiveState"] });
    queryClient.invalidateQueries({
      predicate: (query) => {
        if (!Array.isArray(query.queryKey)) return false;
        // useSuiClientQuery keys: the method name sits at index 0 or 1
        return query.queryKey.some(
          (k) => k === "getObject" || k === "queryEvents",
        );
      },
    });
  }, [queryClient]);

  const isPoster = characterId === c.posterId;
  const isCourier = c.courierId != null && characterId === c.courierId;
  const isCompleted = c.status === "Completed";
  const isOpen = c.status === "Open";
  const isInProgress = c.status === "InProgress";
  const isExpired = Number(c.deadlineMs) < Date.now();

  const filled = Number(c.filledQuantity);
  const target = Number(c.targetQuantity);

  // For ItemForCoin, track item release progress instead of coins paid
  const isItemForCoin = c.contractType.variant === "ItemForCoin";
  const itemsOffered = c.contractType.variant === "ItemForCoin" ? c.contractType.offeredQuantity : 0;
  const itemsReleased = c.itemsReleased ?? 0;
  const itemsRemaining = itemsOffered - itemsReleased;

  const pct = (() => {
    if (isItemForCoin && itemsOffered > 0) {
      return Math.min(100, (itemsReleased / itemsOffered) * 100);
    }
    return target > 0 ? Math.min(100, (filled / target) * 100) : 0;
  })();

  const isRestricted = c.allowedCharacters.length > 0 || c.allowedTribes.length > 0;

  // Determine which fill actions are available
  const canFillCoins =
    !isPoster && isOpen && !isCompleted && !isExpired &&
    (c.contractType.variant === "CoinForCoin" || c.contractType.variant === "ItemForCoin");
  const canFillItems =
    !isPoster && isOpen && !isCompleted && !isExpired &&
    (c.contractType.variant === "CoinForItem" || c.contractType.variant === "ItemForItem");
  const canAcceptTransport =
    !isPoster && isOpen && !isCompleted && !isExpired && c.contractType.variant === "Transport";
  const canDeliver =
    isCourier && isInProgress && !isCompleted && !isExpired && c.contractType.variant === "Transport";
  const canCancel = isPoster && isOpen && !isCompleted;
  const canExpire = isExpired && !isCompleted;
  const canCleanup = isCompleted;

  async function handleCancel() {
    if (!characterId) return;
    try {
      const isItemContract =
        c.contractType.variant === "ItemForCoin" || c.contractType.variant === "ItemForItem" || c.contractType.variant === "Transport";
      let tx;
      if (isItemContract) {
        const sourceSsuId =
          c.contractType.variant === "ItemForCoin" ? c.contractType.sourceSsuId :
          c.contractType.variant === "ItemForItem" ? c.contractType.sourceSsuId :
          c.contractType.variant === "Transport" ? c.contractType.sourceSsuId : "";
        tx = buildCancelItemContract({ contractId: c.id, posterCharacterId: c.posterId, sourceSsuId, contractVariant: c.contractType.variant, coinType: c.coinType });
      } else {
        tx = buildCancelTrustlessContract({ contractId: c.id, characterId, contractVariant: c.contractType.variant, coinType: c.coinType });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await signAndExecute({ transaction: tx as any });
      await suiClient.waitForTransaction({ digest: result.digest });
      push({ level: "info", title: "Contract Cancelled", message: "The contract has been cancelled and reward returned from escrow.", source: "contract-detail" });
      handleFilled();
      onStatusChange?.();
    } catch (err) {
      push({ level: "error", title: "Cancel Failed", message: String(err), source: "contract-detail" });
    }
  }

  async function handleExpire() {
    try {
      const isItemContract =
        c.contractType.variant === "ItemForCoin" || c.contractType.variant === "ItemForItem" || c.contractType.variant === "Transport";
      let tx;
      if (isItemContract) {
        const sourceSsuId =
          c.contractType.variant === "ItemForCoin" ? c.contractType.sourceSsuId :
          c.contractType.variant === "ItemForItem" ? c.contractType.sourceSsuId :
          c.contractType.variant === "Transport" ? c.contractType.sourceSsuId : "";
        tx = buildExpireItemContract({ contractId: c.id, posterCharacterId: c.posterId, sourceSsuId, contractVariant: c.contractType.variant, coinType: c.coinType });
      } else {
        tx = buildExpireTrustlessContract({ contractId: c.id, contractVariant: c.contractType.variant, coinType: c.coinType });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await signAndExecute({ transaction: tx as any });
      await suiClient.waitForTransaction({ digest: result.digest });
      push({ level: "info", title: "Contract Expired", message: "The contract has been marked as expired.", source: "contract-detail" });
      handleFilled();
      onStatusChange?.();
    } catch (err) {
      push({ level: "error", title: "Expire Failed", message: String(err), source: "contract-detail" });
    }
  }

  async function handleCleanup() {
    try {
      let result;
      const isItemContract =
        c.contractType.variant === "ItemForCoin" || c.contractType.variant === "ItemForItem" || c.contractType.variant === "Transport";
      if (isItemContract) {
        const sourceSsuId =
          c.contractType.variant === "ItemForCoin" ? c.contractType.sourceSsuId :
          c.contractType.variant === "ItemForItem" ? c.contractType.sourceSsuId :
          c.contractType.variant === "Transport" ? c.contractType.sourceSsuId : "";
        const tx = buildCleanupCompletedItemContract({
          contractId: c.id,
          posterCharacterId: c.posterId,
          sourceSsuId,
          contractVariant: c.contractType.variant,
          coinType: c.coinType,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await signAndExecute({ transaction: tx as any });
      } else {
        const tx = buildCleanupCompletedContract({ contractId: c.id, contractVariant: c.contractType.variant, coinType: c.coinType });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await signAndExecute({ transaction: tx as any });
      }
      await suiClient.waitForTransaction({ digest: result.digest });
      push({ level: "info", title: "Contract Cleaned Up", message: "On-chain object deleted.", source: "contract-detail" });
      handleFilled();
    } catch (err) {
      push({ level: "error", title: "Cleanup Failed", message: String(err), source: "contract-detail" });
    }
  }

  async function handleAcceptTransport() {
    if (!characterId || c.contractType.variant !== "Transport") return;
    try {
      const tx = buildAcceptTransport({
        contractId: c.id,
        stakeAmount: Number(c.contractType.requiredStake),
        characterId,
        sourceSsuId: c.contractType.sourceSsuId,
        coinType: c.coinType,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await signAndExecute({ transaction: tx as any });
      await suiClient.waitForTransaction({ digest: result.digest });
      handleFilled();
      onStatusChange?.();
    } catch (err) {
      push({ level: "error", title: "Accept Transport Failed", message: String(err), source: "contract-detail" });
    }
  }

  const handleShare = useCallback(() => {
    const url = `${window.location.origin}/contracts/${c.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    });
  }, [c.id]);

  return (
    <>
      <Wrapper>
        <Header>
          <div>
            <TypeTag>{contractTypeLabel(c.contractType.variant)}</TypeTag>
            {isNonDefaultCoin && <CoinTag>{parseCoinSymbol(resolvedCoinType)}</CoinTag>}
            <Title style={{ display: "inline" }}>Contract Details</Title>
          </div>
          <HeaderRight>
            <ShareBtn onClick={handleShare} title="Copy shareable link">
              {shareCopied ? "✓ Copied" : "🔗 Share"}
            </ShareBtn>
            <StatusBadge status={statusVariant(c.status)} />
          </HeaderRight>
        </Header>

        <ContractIdRow>
          <span>Contract ID:</span>
          <CopyableId id={c.id} />
        </ContractIdRow>

        <DetailGrid>
          <div>
            <Label>Reward</Label>
            <Value>{formatAmount(c.escrowAmount, ceDecimals)} {ceSymbol}</Value>
            <span style={{ fontSize: 11, color: "inherit", opacity: 0.6 }}>Held in escrow</span>
          </div>
          <div>
            <Label>Deadline</Label>
            <Value>{formatDeadline(c.deadlineMs)}</Value>
          </div>
          <div>
            <Label>Poster</Label>
            <Value><CharacterDisplay characterId={c.posterId} /></Value>
          </div>
          <div>
            <Label>Partial Fill</Label>
            <Value>{c.allowPartial ? "Yes" : "No"}</Value>
          </div>
          {c.contractType.variant === "CoinForCoin" && (
            <>
              <div>
                <Label>Offered Amount</Label>
                <Value>{formatAmount(c.contractType.offeredAmount, ceDecimals)} {ceSymbol}</Value>
              </div>
              <div>
                <Label>Wanted Amount</Label>
                <Value>{formatAmount(c.contractType.wantedAmount, cfDecimals)} {cfSymbol}</Value>
              </div>
              {c.allowPartial && (
                <div>
                  <Label>Filled</Label>
                  <Value>{formatAmount(c.filledQuantity, cfDecimals)} / {formatAmount(c.contractType.wantedAmount, cfDecimals)} {cfSymbol}</Value>
                </div>
              )}
            </>
          )}
          {c.contractType.variant === "Transport" && (
            <>
              <div>
                <Label>Courier</Label>
                <Value>{c.courierId ? <CharacterDisplay characterId={c.courierId} /> : "—"}</Value>
              </div>
              <div>
                <Label>Required Stake</Label>
                <Value>{formatAmount(c.stakeAmount, ceDecimals)} {ceSymbol}</Value>
              </div>
            </>
          )}
          {c.contractType.variant === "CoinForItem" && (
            <>
              <div>
                <Label>Wanted Item</Label>
                <Value><ItemBadge typeId={c.contractType.wantedTypeId} /></Value>
              </div>
              <div>
                <Label>Wanted Quantity</Label>
                <Value>{c.contractType.wantedQuantity.toLocaleString()}</Value>
              </div>
              <div>
                <Label>Destination SSU</Label>
                <Value><CopyableId id={c.contractType.destinationSsuId} /></Value>
              </div>
              {c.allowPartial && (
                <div>
                  <Label>Filled</Label>
                  <Value>{c.filledQuantity} / {c.contractType.wantedQuantity.toLocaleString()}</Value>
                </div>
              )}
            </>
          )}
          {c.contractType.variant === "ItemForCoin" && (
            <>
              <div>
                <Label>Offered Item</Label>
                <Value><ItemBadge typeId={c.contractType.offeredTypeId} /></Value>
              </div>
              <div>
                <Label>Offered Quantity</Label>
                <Value>
                  {c.allowPartial
                    ? `${itemsRemaining.toLocaleString()} remaining / ${c.contractType.offeredQuantity.toLocaleString()} total`
                    : c.contractType.offeredQuantity.toLocaleString()}
                </Value>
              </div>
              <div>
                <Label>Total Price</Label>
                <Value>{formatAmount(c.contractType.wantedAmount, cfDecimals)} {cfSymbol}</Value>
              </div>
              <div>
                <Label>Price per Item</Label>
                <Value>
                  {c.contractType.offeredQuantity > 0
                    ? `${formatAmount(String(Math.round(Number(c.contractType.wantedAmount) / c.contractType.offeredQuantity)), cfDecimals)} ${cfSymbol}`
                    : "—"}
                </Value>
              </div>
              <div>
                <Label>Source SSU</Label>
                <Value><CopyableId id={c.contractType.sourceSsuId} /></Value>
              </div>
              {c.allowPartial && (
                <div>
                  <Label>Items Released</Label>
                  <Value>{itemsReleased.toLocaleString()} / {c.contractType.offeredQuantity.toLocaleString()}</Value>
                </div>
              )}
            </>
          )}
          {c.contractType.variant === "ItemForItem" && (
            <>
              <div>
                <Label>Offered Item</Label>
                <Value><ItemBadge typeId={c.contractType.offeredTypeId} /></Value>
              </div>
              <div>
                <Label>Offered Quantity</Label>
                <Value>{c.contractType.offeredQuantity.toLocaleString()}</Value>
              </div>
              <div>
                <Label>Wanted Item</Label>
                <Value><ItemBadge typeId={c.contractType.wantedTypeId} /></Value>
              </div>
              <div>
                <Label>Wanted Quantity</Label>
                <Value>{c.contractType.wantedQuantity.toLocaleString()}</Value>
              </div>
              <div>
                <Label>Source SSU</Label>
                <Value><CopyableId id={c.contractType.sourceSsuId} /></Value>
              </div>
              <div>
                <Label>Destination SSU</Label>
                <Value><CopyableId id={c.contractType.destinationSsuId} /></Value>
              </div>
              {c.allowPartial && (
                <div>
                  <Label>Filled</Label>
                  <Value>{c.filledQuantity} / {c.contractType.wantedQuantity.toLocaleString()}</Value>
                </div>
              )}
            </>
          )}
          {c.contractType.variant === "Transport" && (
            <>
              <div>
                <Label>Item</Label>
                <Value><ItemBadge typeId={c.contractType.itemTypeId} /></Value>
              </div>
              <div>
                <Label>Item Quantity</Label>
                <Value>{c.contractType.itemQuantity.toLocaleString()}</Value>
              </div>
              <div>
                <Label>Source SSU (pickup)</Label>
                <Value><CopyableId id={c.contractType.sourceSsuId} /></Value>
              </div>
              <div>
                <Label>Destination SSU (delivery)</Label>
                <Value><CopyableId id={c.contractType.destinationSsuId} /></Value>
              </div>
              {c.allowPartial && (
                <div>
                  <Label>Delivered</Label>
                  <Value>{c.filledQuantity} / {c.contractType.itemQuantity.toLocaleString()}</Value>
                </div>
              )}
            </>
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
              <div>Characters: {c.allowedCharacters.map((a, i) => (
                <span key={a}>{i > 0 && ", "}<CopyableId id={a} /></span>
              ))}</div>
            )}
            {c.allowedTribes.length > 0 && (
              <div>Tribes: {c.allowedTribes.join(", ")}</div>
            )}
          </AccessSection>
        )}

        {c.referenceStructureId && c.maxDistance != null && (
          <ProximitySection>
            <ProximityTitle>Proximity Requirement</ProximityTitle>
            <ProximityRow>
              <span>Reference Structure</span>
              <CopyableId id={c.referenceStructureId} />
            </ProximityRow>
            <ProximityRow>
              <span>Max Distance</span>
              <span>{c.maxDistance} ly</span>
            </ProximityRow>
            <ProximityRow>
              <span />
              <ProximityLink to="/locations">
                Generate proximity proof →
              </ProximityLink>
            </ProximityRow>
          </ProximitySection>
        )}

        <ActionRow>
          {canFillCoins && (
            <PrimaryButton onClick={() => setShowFill(true)} disabled={isPending}>
              Fill with Coins
            </PrimaryButton>
          )}
          {canFillItems && (
            <PrimaryButton onClick={() => setShowFill(true)} disabled={isPending}>
              Fill with Items
            </PrimaryButton>
          )}
          {canAcceptTransport && (
            <PrimaryButton onClick={handleAcceptTransport} disabled={isPending}>
              {isPending ? "Accepting…" : "Accept Transport"}
            </PrimaryButton>
          )}
          {canDeliver && (
            <PrimaryButton onClick={() => setShowFill(true)} disabled={isPending}>
              Deliver Items
            </PrimaryButton>
          )}
          {canCancel && (
            <SharedDanger onClick={handleCancel} disabled={isPending}>
              {isPending ? "Cancelling…" : "Cancel"}
            </SharedDanger>
          )}
          {canExpire && (
            <SharedSecondary onClick={handleExpire} disabled={isPending}>
              {isPending ? "Expiring…" : "Expire"}
            </SharedSecondary>
          )}
          {canCleanup && (
            <SharedSecondary onClick={handleCleanup} disabled={isPending}>
              {isPending ? "Cleaning up…" : "Cleanup"}
            </SharedSecondary>
          )}
        </ActionRow>
      </Wrapper>

      {showFill && (
        <FillContractModal contract={c} onClose={() => setShowFill(false)} onFilled={handleFilled} />
      )}
    </>
  );
}
