import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { useIdentity } from "../../hooks/useIdentity";
import { formatAmount } from "../../lib/format";
import type { TrustlessContractData } from "../../lib/types";
import {
  buildFillWithCoins,
  buildFillWithItems,
  buildFillItemForCoin,
  buildDeliverTransport,
} from "../../lib/sui";

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

const Button = styled.button`
  width: 100%;
  background: ${({ theme }) => theme.colors.primary.main};
  color: #fff;
  border: none;
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.primary.hover};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

// ---------------------------------------------------------------------------

interface Props {
  contract: TrustlessContractData;
  onClose: () => void;
}

export function FillContractModal({ contract, onClose }: Props) {
  const { characterId } = useIdentity();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  // Coin fill fields
  const [fillAmount, setFillAmount] = useState("");

  // Item fill fields
  const [ssuId, setSsuId] = useState("");
  const [itemId, setItemId] = useState("");

  const remaining = Number(contract.targetQuantity) - Number(contract.filledQuantity);
  const variant = contract.contractType.variant;

  const isCoinFill = variant === "CoinForCoin" || variant === "ItemForCoin";
  const isItemFill = variant === "CoinForItem" || variant === "ItemForItem";
  const isTransportDeliver = variant === "Transport" && contract.status === "InProgress";

  function modalTitle(): string {
    if (isTransportDeliver) return "Deliver Items";
    if (isCoinFill) return "Fill with Coins";
    return "Fill with Items";
  }

  async function handleSubmit() {
    if (!characterId) return;

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
          characterId,
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

    onClose();
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
        Remaining: {remaining.toLocaleString()} / {Number(contract.targetQuantity).toLocaleString()}
        {contract.escrowAmount !== "0" && (
          <> — Escrow: {formatAmount(contract.escrowAmount)} SUI</>
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
          <Label>Destination SSU ID</Label>
          <Input
            placeholder="0x..."
            value={ssuId}
            onChange={(e) => setSsuId(e.target.value)}
            autoFocus
          />
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

      <Button onClick={handleSubmit} disabled={!isValid || isPending}>
        {isPending ? "Submitting…" : "Submit"}
      </Button>
    </Modal>
  );
}
