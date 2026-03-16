import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { useIdentity } from "../../hooks/useIdentity";
import { useNotifications } from "../../hooks/useNotifications";
import { formatAmount } from "../../lib/format";
import type { TrustlessContractData } from "../../lib/types";
import {
  buildFillWithCoins,
  buildFillWithItems,
  buildFillItemForCoin,
  buildDeliverTransport,
} from "../../lib/sui";
import { SsuPickerField } from "../shared/SsuPickerField";
import { ItemBadge } from "../shared/ItemBadge";
import { PrimaryButton } from "../shared/Button";

const Label = styled.label`
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const Input = styled.input`
  width: 100%;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;
  margin-bottom: ${({ theme }) => theme.spacing.md};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const Info = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  line-height: 1.5;
`;

const SubmitButton = styled(PrimaryButton)`
  font-size: 14px;
`;

// ---------------------------------------------------------------------------

interface Props {
  contract: TrustlessContractData;
  onClose: () => void;
}

export function FillContractModal({ contract, onClose }: Props) {
  const { characterId } = useIdentity();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const { push } = useNotifications();

  // Coin fill fields
  const [fillAmount, setFillAmount] = useState("");

  // Item fill fields
  const [ssuId, setSsuId] = useState("");
  const [itemId, setItemId] = useState("");

  const variant = contract.contractType.variant;

  const isCoinFill = variant === "CoinForCoin" || variant === "ItemForCoin";

  // For ItemForCoin the filler cares about items remaining, not coins.
  const remaining = (() => {
    if (variant === "ItemForCoin" && contract.contractType.variant === "ItemForCoin") {
      const offered = contract.contractType.offeredQuantity;
      return offered - (contract.itemsReleased ?? 0);
    }
    return Number(contract.targetQuantity) - Number(contract.filledQuantity);
  })();
  const isItemFill = variant === "CoinForItem" || variant === "ItemForItem";
  const isTransportDeliver = variant === "Transport" && contract.status === "InProgress";

  function modalTitle(): string {
    if (isTransportDeliver) return "Deliver Items";
    if (isCoinFill) return "Fill with Coins";
    return "Fill with Items";
  }

  async function handleSubmit() {
    if (!characterId) return;

    try {
      if (isCoinFill) {
        const amount = Math.round(Number(fillAmount) * 1e9);
        if (variant === "CoinForCoin") {
          const tx = buildFillWithCoins({
            contractId: contract.id,
            fillAmount: amount,
            characterId,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await signAndExecute({ transaction: tx as any });
        } else {
          // ItemForCoin — filler pays coins to get items
          const ct = contract.contractType;
          const sourceSsu = ct.variant === "ItemForCoin" ? ct.sourceSsuId : "";
          const tx = buildFillItemForCoin({
            contractId: contract.id,
            sourceSsuId: sourceSsu,
            posterCharacterId: contract.posterId,
            fillerCharacterId: characterId,
            fillAmount: amount,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await signAndExecute({ transaction: tx as any });
        }
      } else if (isItemFill) {
        const tx = buildFillWithItems({
          contractId: contract.id,
          destinationSsuId: ssuId,
          posterCharacterId: contract.posterId,
          fillerCharacterId: characterId,
          itemId,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await signAndExecute({ transaction: tx as any });
      } else if (isTransportDeliver) {
        const ct = contract.contractType;
        const destSsu = ct.variant === "Transport" ? ct.destinationSsuId : ssuId;
        const tx = buildDeliverTransport({
          contractId: contract.id,
          destinationSsuId: destSsu,
          courierCharacterId: characterId,
          posterCharacterId: contract.posterId,
          itemId,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await signAndExecute({ transaction: tx as any });
      }

      push({ level: "info", title: "Contract Filled", message: "Transaction submitted successfully.", source: "fill-contract" });
      onClose();
    } catch (err) {
      push({ level: "error", title: "Fill Failed", message: String(err), source: "fill-contract" });
    }
  }

  const isValid = (() => {
    if (!characterId) return false;
    if (isCoinFill) return Number(fillAmount) > 0;
    if (isItemFill) return !!ssuId && !!itemId;
    if (isTransportDeliver) return !!itemId;
    return false;
  })();

  return (
    <Modal title={modalTitle()} onClose={onClose}>
      <Info>
        {variant === "ItemForCoin" && contract.contractType.variant === "ItemForCoin" ? (
          <>
            Items remaining: {remaining.toLocaleString()} / {contract.contractType.offeredQuantity.toLocaleString()}
            <div>Item: <ItemBadge typeId={contract.contractType.offeredTypeId} /></div>
            <div>Price: {formatAmount(contract.contractType.wantedAmount)} SUI</div>
          </>
        ) : (
          <>
            Remaining: {remaining.toLocaleString()} / {Number(contract.targetQuantity).toLocaleString()}
          </>
        )}
        {contract.escrowAmount !== "0" && (
          <> — Escrow: {formatAmount(contract.escrowAmount)} SUI</>
        )}
        {variant === "CoinForItem" && contract.contractType.variant === "CoinForItem" && (
          <div>Wanted: <ItemBadge typeId={contract.contractType.wantedTypeId} /></div>
        )}
        {variant === "ItemForItem" && contract.contractType.variant === "ItemForItem" && (
          <div>Wanted: <ItemBadge typeId={contract.contractType.wantedTypeId} /></div>
        )}
        {variant === "Transport" && contract.contractType.variant === "Transport" && (
          <div>Item: <ItemBadge typeId={contract.contractType.itemTypeId} /></div>
        )}
      </Info>

      {isCoinFill && (
        <>
          <Label>Fill Amount (SUI)</Label>
          <Input
            type="number"
            placeholder="0.0"
            value={fillAmount}
            onChange={(e) => setFillAmount(e.target.value)}
            autoFocus
          />
        </>
      )}

      {isItemFill && (
        <>
          <Label>Destination SSU</Label>
          <SsuPickerField value={ssuId} onChange={setSsuId} />
          <Label>Item Object ID</Label>
          <Input placeholder="0x..." value={itemId} onChange={(e) => setItemId(e.target.value)} />
        </>
      )}

      {isTransportDeliver && (
        <>
          <Label>Item Object ID</Label>
          <Input
            placeholder="0x..."
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            autoFocus
          />
          <Info>
            Items will be deposited at the destination SSU specified in the contract.
          </Info>
        </>
      )}

      <SubmitButton $fullWidth onClick={handleSubmit} disabled={!isValid || isPending}>
        {isPending ? "Submitting…" : "Submit"}
      </SubmitButton>
    </Modal>
  );
}
