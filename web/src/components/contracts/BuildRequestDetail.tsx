import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { useSuiClient, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import type { BuildRequestContractData } from "../../lib/types";
import { formatAmount, formatDeadline, structureTypeName } from "../../lib/format";
import { CopyableId } from "../shared/CopyableId";
import { CharacterDisplay } from "../shared/CharacterDisplay";
import { StatusBadge } from "../shared/StatusBadge";
import { useIdentity } from "../../hooks/useIdentity";
import { useBuildRequestObject } from "../../hooks/useBuildRequests";
import { useNotifications } from "../../hooks/useNotifications";
import {
  buildCancelBuildRequest,
  buildExpireBuildRequest,
  buildCleanupBuildRequest,
} from "../../lib/sui";
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

const CormAuthBadge = styled.span`
  display: inline-block;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.text.muted};
  margin-right: ${({ theme }) => theme.spacing.sm};
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

// ---------------------------------------------------------------------------

function statusVariant(s: BuildRequestContractData["status"]): "open" | "completed" {
  return s === "Completed" ? "completed" : "open";
}

interface Props {
  contract: BuildRequestContractData;
  onStatusChange?: () => void;
}

export function BuildRequestDetail({ contract: initial, onStatusChange }: Props) {
  const { characterId } = useIdentity();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const queryClient = useQueryClient();
  const { push } = useNotifications();
  const [shareCopied, setShareCopied] = useState(false);

  // Fetch live object state
  const { contract: live } = useBuildRequestObject(initial.id);
  const c = live ?? initial;

  const resolvedCoinType = c.coinType ?? defaultCoinType();
  const isNonDefaultCoin = !!c.coinType && c.coinType !== defaultCoinType();
  const { decimals, symbol } = useCoinDecimals(resolvedCoinType);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["buildRequestLiveState"] });
    queryClient.invalidateQueries({ queryKey: ["buildRequestCreationEvents"] });
    queryClient.invalidateQueries({
      predicate: (query) => {
        if (!Array.isArray(query.queryKey)) return false;
        return query.queryKey.some(
          (k) => k === "getObject" || k === "queryEvents",
        );
      },
    });
  }, [queryClient]);

  const isPoster = characterId === c.posterId;
  const isCompleted = c.status === "Completed";
  const isOpen = c.status === "Open";
  const isExpired = Number(c.deadlineMs) < Date.now();
  const isRestricted = c.allowedCharacters.length > 0 || c.allowedTribes.length > 0;
  const typeName = structureTypeName(c.requestedTypeId);

  const canCancel = isPoster && isOpen && !isCompleted;
  const canExpire = isExpired && !isCompleted;
  const canCleanup = isCompleted;

  async function handleCancel() {
    if (!c.posterAddress) return;
    try {
      const tx = buildCancelBuildRequest({
        contractId: c.id,
        posterAddress: c.posterAddress,
        coinType: c.coinType,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await signAndExecute({ transaction: tx as any });
      await suiClient.waitForTransaction({ digest: result.digest });
      push({ level: "info", title: "Build Request Cancelled", message: "Bounty returned from escrow.", source: "build-request-detail" });
      invalidate();
      onStatusChange?.();
    } catch (err) {
      push({ level: "error", title: "Cancel Failed", message: String(err), source: "build-request-detail" });
    }
  }

  async function handleExpire() {
    try {
      const tx = buildExpireBuildRequest({ contractId: c.id, coinType: c.coinType });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await signAndExecute({ transaction: tx as any });
      await suiClient.waitForTransaction({ digest: result.digest });
      push({ level: "info", title: "Build Request Expired", message: "Contract marked as expired.", source: "build-request-detail" });
      invalidate();
      onStatusChange?.();
    } catch (err) {
      push({ level: "error", title: "Expire Failed", message: String(err), source: "build-request-detail" });
    }
  }

  async function handleCleanup() {
    try {
      const tx = buildCleanupBuildRequest({ contractId: c.id, coinType: c.coinType });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await signAndExecute({ transaction: tx as any });
      await suiClient.waitForTransaction({ digest: result.digest });
      push({ level: "info", title: "Build Request Cleaned Up", message: "On-chain object deleted.", source: "build-request-detail" });
      invalidate();
    } catch (err) {
      push({ level: "error", title: "Cleanup Failed", message: String(err), source: "build-request-detail" });
    }
  }

  const handleShare = useCallback(() => {
    const url = `${window.location.origin}/contracts/build/${c.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    });
  }, [c.id]);

  return (
    <Wrapper>
      <Header>
        <div>
          <TypeTag>Build Request</TypeTag>
          {isNonDefaultCoin && <CoinTag>{parseCoinSymbol(resolvedCoinType)}</CoinTag>}
          {c.requireCormAuth && <CormAuthBadge>CormAuth Required</CormAuthBadge>}
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
          <Label>Requested Structure</Label>
          <Value>{typeName} (#{c.requestedTypeId})</Value>
        </div>
        <div>
          <Label>Bounty</Label>
          <Value>{formatAmount(c.bountyAmount, decimals)} {symbol}</Value>
          <span style={{ fontSize: 11, color: "inherit", opacity: 0.6 }}>Held in escrow</span>
        </div>
        <div>
          <Label>Deadline</Label>
          <Value>{formatDeadline(c.deadlineMs)}</Value>
        </div>
        <div>
          <Label>CormAuth Required</Label>
          <Value>{c.requireCormAuth ? "Yes" : "No"}</Value>
        </div>
        <div>
          <Label>Poster</Label>
          <Value><CharacterDisplay characterId={c.posterId} /></Value>
        </div>
        {c.builderAddress && (
          <div>
            <Label>Builder</Label>
            <Value><CopyableId id={c.builderAddress} /></Value>
          </div>
        )}
        {c.structureId && (
          <div>
            <Label>Built Structure</Label>
            <Value><CopyableId id={c.structureId} /></Value>
          </div>
        )}
      </DetailGrid>

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
  );
}
