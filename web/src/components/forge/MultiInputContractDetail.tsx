import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { ItemBadge } from "../shared/ItemBadge";
import { PrimaryButton, SecondaryButton, DangerButton } from "../shared/Button";
import { FillSlotModal } from "./FillSlotModal";
import { useMultiInputContractObject, useMultiInputSlotFills } from "../../hooks/useMultiInputContracts";
import { buildCancelMultiInputContract, buildExpireMultiInputContract } from "../../lib/sui";
import { formatAmount, formatDeadline } from "../../lib/format";
import { useEscrowCoinDecimals } from "../../hooks/useCoinDecimals";
import { CopyableId } from "../shared/CopyableId";
import type { MultiInputContractData } from "../../lib/types";

const Section = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const DescriptionText = styled.p`
  font-size: 15px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin: 0 0 ${({ theme }) => theme.spacing.md};
`;

const MetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.md};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const BountyAmount = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary.muted};
`;

const SlotsLabel = styled.h3`
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.muted};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`;

const SlotRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const SlotInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const SlotNumbers = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: 3px;
`;

const TrackWrap = styled.div`
  height: 4px;
  border-radius: 2px;
  background: ${({ theme }) => theme.colors.surface.border};
  overflow: hidden;
`;

const TrackFill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => $pct}%;
  background: ${({ theme }) => theme.colors.module.forgePlanner};
  border-radius: 2px;
  transition: width 0.2s ease;
`;

const OverallTrack = styled.div`
  height: 6px;
  border-radius: 3px;
  background: ${({ theme }) => theme.colors.surface.border};
  overflow: hidden;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const OverallFill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => $pct}%;
  background: ${({ theme }) => theme.colors.module.forgePlanner};
  border-radius: 3px;
  transition: width 0.2s ease;
`;

const OverallLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-align: right;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.md};
`;

interface Props {
  contract: MultiInputContractData;
  characterId: string | null;
  onClose: () => void;
}

export function MultiInputContractDetail({ contract, characterId, onClose }: Props) {
  const { decimals, symbol: coinSymbol } = useEscrowCoinDecimals();
  const { contract: liveContract } = useMultiInputContractObject(contract.id);
  const { fills } = useMultiInputSlotFills(contract.id);
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const [showFillModal, setShowFillModal] = useState(false);

  // Overlay live fill amounts from SlotFilledEvent aggregation onto event-sourced slots
  const enrichedSlots = contract.slots.map((slot) => ({
    ...slot,
    filled: fills.get(slot.typeId) ?? slot.filled,
  }));

  const liveTotal = liveContract?.totalFilled ?? contract.totalFilled;
  const liveRequired = liveContract?.totalRequired ?? contract.totalRequired;
  const liveBountyBalance = liveContract?.bountyBalance;

  const overallPct = liveRequired > 0 ? Math.min(100, (liveTotal / liveRequired) * 100) : 0;
  const isComplete = liveTotal >= liveRequired && liveRequired > 0;
  const isExpired = Date.now() > Number(contract.deadlineMs);
  const isPoster = characterId === contract.posterId;

  async function handleCancel() {
    if (!characterId) return;
    const tx = buildCancelMultiInputContract({ contractId: contract.id, characterId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
    onClose();
  }

  async function handleExpire() {
    const tx = buildExpireMultiInputContract({ contractId: contract.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
    onClose();
  }

  return (
    <>
      <Modal
        title="Order Detail"
        onClose={onClose}
        disableClose={isPending || showFillModal}
      >
        <DescriptionText>
          {contract.description || <CopyableId id={contract.id} />}
        </DescriptionText>

        <MetaRow>
          <BountyAmount>
            {liveBountyBalance
              ? `${formatAmount(liveBountyBalance, decimals)} ${coinSymbol} remaining`
              : `${formatAmount(contract.bountyAmount, decimals)} ${coinSymbol} bounty`}
          </BountyAmount>
          <span>{formatDeadline(contract.deadlineMs)}</span>
          <span>ID: <CopyableId id={contract.id} /></span>
        </MetaRow>

        <Section>
          <OverallTrack>
            <OverallFill $pct={overallPct} />
          </OverallTrack>
          <OverallLabel>
            {liveTotal.toLocaleString()} / {liveRequired.toLocaleString()} units ({Math.round(overallPct)}%)
          </OverallLabel>
        </Section>

        <Section>
          <SlotsLabel>Material Slots ({enrichedSlots.length})</SlotsLabel>
          {enrichedSlots.map((slot) => {
            const slotPct =
              slot.required > 0
                ? Math.min(100, (slot.filled / slot.required) * 100)
                : 0;
            return (
              <SlotRow key={slot.typeId}>
                <ItemBadge typeId={slot.typeId} />
                <SlotInfo>
                  <SlotNumbers>
                    {slot.filled.toLocaleString()} / {slot.required.toLocaleString()}
                    {slotPct >= 100 && " ✓"}
                  </SlotNumbers>
                  <TrackWrap>
                    <TrackFill $pct={slotPct} />
                  </TrackWrap>
                </SlotInfo>
              </SlotRow>
            );
          })}
        </Section>

        <ButtonRow>
          {!isComplete && (
            <PrimaryButton onClick={() => setShowFillModal(true)} disabled={isPending}>
              Fill Slot
            </PrimaryButton>
          )}
          {isPoster && !isComplete && (
            <DangerButton onClick={handleCancel} disabled={isPending}>
              {isPending ? "Cancelling…" : "Cancel Order"}
            </DangerButton>
          )}
          {isExpired && !isComplete && (
            <SecondaryButton onClick={handleExpire} disabled={isPending}>
              {isPending ? "Expiring…" : "Expire"}
            </SecondaryButton>
          )}
        </ButtonRow>
      </Modal>

      {showFillModal && (
        <FillSlotModal
          contract={{ ...contract, slots: enrichedSlots }}
          posterCharId={contract.posterId}
          onClose={() => setShowFillModal(false)}
        />
      )}
    </>
  );
}
