import { type ReactNode, useState, useEffect } from "react";
import styled from "styled-components";
import type { TrustlessContractData } from "../../lib/types";
import { formatAmount, formatDeadline, contractTypeLabel } from "../../lib/format";
import { useEscrowCoinDecimals, useFillCoinDecimals } from "../../hooks/useCoinDecimals";
import { getLocationTagsForStructure, type LocationTagResult } from "../../lib/api";
import { regionName, constellationName } from "../../lib/regions";
import { StatusBadge } from "../shared/StatusBadge";
import { CharacterDisplay } from "../shared/CharacterDisplay";
import { ItemBadge } from "../shared/ItemBadge";

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

const LocationTag = styled.span`
  display: inline-block;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.text.muted};
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

function contractSummary(
  c: TrustlessContractData,
  ce: { decimals: number; symbol: string },
  cf: { decimals: number; symbol: string },
): ReactNode {
  const ct = c.contractType;
  switch (ct.variant) {
    case "CoinForCoin":
      return <>Offering {formatAmount(ct.offeredAmount, ce.decimals)} {ce.symbol} for {formatAmount(ct.wantedAmount, cf.decimals)} {cf.symbol}</>;
    case "CoinForItem":
      return <>Offering {formatAmount(ct.offeredAmount, ce.decimals)} {ce.symbol} for <ItemBadge typeId={ct.wantedTypeId} showQuantity={ct.wantedQuantity} /></>;
    case "ItemForCoin": {
      const released = c.itemsReleased ?? 0;
      const remaining = ct.offeredQuantity - released;
      return <><ItemBadge typeId={ct.offeredTypeId} showQuantity={remaining > 0 && released > 0 ? remaining : ct.offeredQuantity} />{released > 0 ? " remaining" : ""} for {formatAmount(ct.wantedAmount, cf.decimals)} {cf.symbol}</>;
    }
    case "ItemForItem":
      return <><ItemBadge typeId={ct.offeredTypeId} showQuantity={ct.offeredQuantity} /> for <ItemBadge typeId={ct.wantedTypeId} showQuantity={ct.wantedQuantity} /></>;
    case "Transport":
      return <>Deliver <ItemBadge typeId={ct.itemTypeId} showQuantity={ct.itemQuantity} /> for {formatAmount(ct.paymentAmount, ce.decimals)} {ce.symbol}</>;
  }
}

function statusVariant(s: TrustlessContractData["status"]): "open" | "in-progress" | "completed" {
  if (s === "Completed") return "completed";
  return s === "InProgress" ? "in-progress" : "open";
}

interface Props {
  contract: TrustlessContractData;
  onClick?: () => void;
}

/** Extract the primary SSU ID from a contract for location tag lookup. */
function getPrimarySsuId(c: TrustlessContractData): string | null {
  const ct = c.contractType;
  if ("sourceSsuId" in ct && ct.sourceSsuId) return ct.sourceSsuId;
  if ("destinationSsuId" in ct && ct.destinationSsuId) return ct.destinationSsuId;
  return null;
}

/** Format a location tag for display. */
function formatLocationTag(tag: LocationTagResult): string {
  if (tag.tag_type === "constellation") return constellationName(tag.tag_id);
  return regionName(tag.tag_id);
}

export function ContractCard({ contract, onClick }: Props) {
  const ce = useEscrowCoinDecimals();
  const cf = useFillCoinDecimals();
  const filled = Number(contract.filledQuantity);
  const target = Number(contract.targetQuantity);
  const pct = target > 0 ? Math.min(100, (filled / target) * 100) : 0;
  const isRestricted = contract.allowedCharacters.length > 0 || contract.allowedTribes.length > 0;

  // Fetch location tags for the contract's SSU
  const [locationTag, setLocationTag] = useState<LocationTagResult | null>(null);
  const ssuId = getPrimarySsuId(contract);
  useEffect(() => {
    if (!ssuId) return;
    let cancelled = false;
    getLocationTagsForStructure(ssuId)
      .then((res) => {
        if (!cancelled && res.tags.length > 0) {
          // Prefer constellation over region for more specific display
          const constTag = res.tags.find((t) => t.tag_type === "constellation");
          setLocationTag(constTag ?? res.tags[0]);
        }
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [ssuId]);

  return (
    <Card onClick={onClick}>
      <TopRow>
        <div>
          <TypeTag>{contractTypeLabel(contract.contractType.variant)}</TypeTag>
          {isRestricted && <RestrictedTag>Restricted</RestrictedTag>}
          {locationTag && <LocationTag>{formatLocationTag(locationTag)}</LocationTag>}
        </div>
        <StatusBadge status={statusVariant(contract.status)} />
      </TopRow>
      <Summary>{contractSummary(contract, ce, cf)}</Summary>
      <Meta>
        {contract.escrowAmount !== "0" && (
          <Amount>{formatAmount(contract.escrowAmount, ce.decimals)} {ce.symbol} reward</Amount>
        )}
        <span>Poster: <CharacterDisplay characterId={contract.posterId} showPortrait={false} /></span>
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
