import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { useIdentity } from "../../hooks/useIdentity";
import { useFillCoinDecimals } from "../../hooks/useCoinDecimals";
import { toBaseUnits } from "../../lib/coinUtils";
import { formatAmount } from "../../lib/format";
import type { TrustlessContractData } from "../../lib/types";
import type { InventoryItemEntry } from "../../hooks/useSsuInventory";
import {
  buildFillWithCoins,
  buildFillWithItems,
  buildFillItemForCoin,
  buildDeliverTransport,
} from "../../lib/sui";
import { ItemBadge } from "../shared/ItemBadge";
import { PrimaryButton } from "../shared/Button";

// ---------------------------------------------------------------------------
// Styled
// ---------------------------------------------------------------------------

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

const MatchInfo = styled.div`
  background: ${({ theme }) => theme.colors.primary.subtle};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.primary.muted};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ErrorMsg = styled.div`
  color: ${({ theme }) => theme.colors.danger};
  font-size: 12px;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const SubmitButton = styled(PrimaryButton)`
  font-size: 14px;
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  contract: TrustlessContractData;
  ssuId: string;
  inventory: InventoryItemEntry[];
  onClose: () => void;
  onSuccess?: () => void;
}

export function DappDeliverModal({ contract, ssuId, inventory, onClose, onSuccess }: Props) {
  const { characterId } = useIdentity();
  const { decimals, symbol: coinSymbol } = useFillCoinDecimals();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const [error, setError] = useState<string | null>(null);

  // Coin fill fields
  const [fillAmount, setFillAmount] = useState("");

  // Item fill fields — pre-populate itemId if we can find a matching inventory entry
  const [itemId, setItemId] = useState("");

  const remaining = Number(contract.targetQuantity) - Number(contract.filledQuantity);
  const variant = contract.contractType.variant;

  const isCoinFill = variant === "CoinForCoin" || variant === "ItemForCoin";
  const isItemFill = variant === "CoinForItem" || variant === "ItemForItem";
  const isTransportDeliver = variant === "Transport" && contract.status === "InProgress";

  // Find matching inventory item for display
  const matchingItem = (() => {
    const ct = contract.contractType;
    if (ct.variant === "CoinForItem") {
      return inventory.find((i) => i.typeId === ct.wantedTypeId);
    }
    if (ct.variant === "ItemForItem") {
      return inventory.find((i) => i.typeId === ct.wantedTypeId);
    }
    if (ct.variant === "Transport") {
      return inventory.find((i) => i.typeId === ct.itemTypeId);
    }
    return undefined;
  })();

  function modalTitle(): string {
    if (isTransportDeliver) return "Deliver Items";
    if (isCoinFill) return "Fill with Coins";
    return "Deliver Items";
  }

  async function handleSubmit() {
    if (!characterId) return;
    setError(null);

    try {
      if (isCoinFill) {
        const amount = toBaseUnits(fillAmount, decimals);
        if (variant === "CoinForCoin") {
          const tx = buildFillWithCoins({
            contractId: contract.id,
            fillAmount: amount,
            characterId,
          });
          await signAndExecute({ transaction: tx as never });
        } else {
          const ct = contract.contractType;
          const sourceSsu = ct.variant === "ItemForCoin" ? ct.sourceSsuId : "";
          const tx = buildFillItemForCoin({
            contractId: contract.id,
            sourceSsuId: sourceSsu,
            posterCharacterId: contract.posterId,
            fillerCharacterId: characterId,
            fillAmount: amount,
          });
          await signAndExecute({ transaction: tx as never });
        }
      } else if (isItemFill) {
        const tx = buildFillWithItems({
          contractId: contract.id,
          destinationSsuId: ssuId,
          posterCharacterId: contract.posterId,
          fillerCharacterId: characterId,
          itemId,
        });
        await signAndExecute({ transaction: tx as never });
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
        await signAndExecute({ transaction: tx as never });
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed");
    }
  }

  const isValid = (() => {
    if (!characterId) return false;
    if (isCoinFill) return Number(fillAmount) > 0;
    if (isItemFill || isTransportDeliver) return !!itemId;
    return false;
  })();

  return (
    <Modal title={modalTitle()} onClose={onClose}>
      <Info>
        Remaining: {remaining.toLocaleString()} / {Number(contract.targetQuantity).toLocaleString()}
        {contract.escrowAmount !== "0" && (
          <> — Reward: {formatAmount(contract.escrowAmount, decimals)} {coinSymbol} (held in escrow)</>
        )}
      </Info>

      {matchingItem && (
        <MatchInfo>
          You have {matchingItem.quantity.toLocaleString()} available in this SSU
        </MatchInfo>
      )}

      {variant === "CoinForItem" && contract.contractType.variant === "CoinForItem" && (
        <Info>
          Wanted: <ItemBadge typeId={contract.contractType.wantedTypeId} showQuantity={contract.contractType.wantedQuantity} />
        </Info>
      )}
      {variant === "ItemForItem" && contract.contractType.variant === "ItemForItem" && (
        <Info>
          Wanted: <ItemBadge typeId={contract.contractType.wantedTypeId} showQuantity={contract.contractType.wantedQuantity} />
        </Info>
      )}
      {variant === "Transport" && contract.contractType.variant === "Transport" && (
        <Info>
          Item: <ItemBadge typeId={contract.contractType.itemTypeId} showQuantity={contract.contractType.itemQuantity} />
        </Info>
      )}

      {isCoinFill && (
        <>
          <Label>Fill Amount ({coinSymbol})</Label>
          <Input
            type="number"
            placeholder="0.0"
            value={fillAmount}
            onChange={(e) => setFillAmount(e.target.value)}
            autoFocus
          />
        </>
      )}

      {(isItemFill || isTransportDeliver) && (
        <>
          <Label>Item Object ID</Label>
          <Input
            placeholder="0x..."
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            autoFocus
          />
          {isTransportDeliver && (
            <Info>
              Items will be deposited at the destination SSU specified in the contract.
            </Info>
          )}
        </>
      )}

      {error && <ErrorMsg>{error}</ErrorMsg>}

      <SubmitButton $fullWidth onClick={handleSubmit} disabled={!isValid || isPending}>
        {isPending ? "Submitting…" : "Confirm Delivery"}
      </SubmitButton>
    </Modal>
  );
}
