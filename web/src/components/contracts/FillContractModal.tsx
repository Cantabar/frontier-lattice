import { useState, useMemo } from "react";
import styled from "styled-components";
import { useSuiClient, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { useIdentity } from "../../hooks/useIdentity";
import { useMyStructures } from "../../hooks/useStructures";
import { useNotifications } from "../../hooks/useNotifications";
import { formatAmount, truncateAddress } from "../../lib/format";
import type { TrustlessContractData } from "../../lib/types";
import type { InventoryItemEntry } from "../../hooks/useSsuInventory";
import {
  buildFillWithCoins,
  buildFillItemForCoin,
  buildFillCoinForItemComposite,
  buildFillItemForItemComposite,
  buildClaimFreeItems,
  buildClaimFreeCoins,
  buildDeliverTransport,
} from "../../lib/sui";
import { SsuPickerField } from "../shared/SsuPickerField";
import { SsuItemPickerField } from "../shared/SsuItemPickerField";
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

const ReadOnlyField = styled.div`
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 14px;
  margin-bottom: ${({ theme }) => theme.spacing.md};
  font-family: monospace;
`;

const SubmitButton = styled(PrimaryButton)`
  font-size: 14px;
`;

// ---------------------------------------------------------------------------

interface Props {
  contract: TrustlessContractData;
  onClose: () => void;
  onFilled?: () => void;
}

export function FillContractModal({ contract, onClose, onFilled }: Props) {
  const { characterId } = useIdentity();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const { push } = useNotifications();
  const { structures } = useMyStructures();

  // Coin fill fields
  const [fillAmount, setFillAmount] = useState("");

  // Free-claim quantity field
  const [claimQuantity, setClaimQuantity] = useState("");

  // Item fill fields (CoinForItem / ItemForItem)
  const [sourceSsuId, setSourceSsuId] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [selectedQty, setSelectedQty] = useState(0);

  // Transport deliver — still needs manual item ID
  const [itemId, setItemId] = useState("");

  // Resolve the filler's selected source SSU to get OwnerCap info
  const sourceSsu = useMemo(
    () => structures.find((s) => s.id === sourceSsuId),
    [structures, sourceSsuId],
  );

  const variant = contract.contractType.variant;

  const isCoinFill = variant === "CoinForCoin" || variant === "ItemForCoin";

  // When the contract wants 0 coins the filler just needs to claim it.
  const isZeroCoinTarget = isCoinFill && contract.targetQuantity === "0";

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

  // Destination SSU is already specified in the contract for item-fill types
  const destinationSsuId = (() => {
    const ct = contract.contractType;
    if (ct.variant === "CoinForItem") return ct.destinationSsuId;
    if (ct.variant === "ItemForItem") return ct.destinationSsuId;
    return "";
  })();

  // Wanted type for item-fill filtering
  const wantedTypeId = (() => {
    const ct = contract.contractType;
    if (ct.variant === "CoinForItem") return ct.wantedTypeId;
    if (ct.variant === "ItemForItem") return ct.wantedTypeId;
    return undefined;
  })();

  function handleItemSelected(entry: InventoryItemEntry) {
    setSelectedTypeId(String(entry.typeId));
    // Default to min(available, remaining)
    setSelectedQty(Math.min(entry.quantity, Math.max(remaining, 0)));
  }

  function modalTitle(): string {
    if (isTransportDeliver) return "Deliver Items";
    if (isCoinFill) return "Fill with Coins";
    return "Fill with Items";
  }

  async function handleSubmit() {
    if (!characterId) return;

    try {
      let result;
      if (isCoinFill) {
        if (isZeroCoinTarget && variant === "CoinForCoin") {
          // Free coin claim — no fill coin, just specify amount
          const tx = buildClaimFreeCoins({
            contractId: contract.id,
            fillerCharacterId: characterId,
            claimAmount: Math.round(Number(claimQuantity) * 1e9),
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result = await signAndExecute({ transaction: tx as any });
        } else if (isZeroCoinTarget && variant === "ItemForCoin") {
          // Free item claim — no coins, just specify quantity
          const ct = contract.contractType;
          const sourceSsu = ct.variant === "ItemForCoin" ? ct.sourceSsuId : "";
          const tx = buildClaimFreeItems({
            contractId: contract.id,
            sourceSsuId: sourceSsu,
            fillerCharacterId: characterId,
            quantity: Number(claimQuantity),
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result = await signAndExecute({ transaction: tx as any });
        } else if (variant === "CoinForCoin") {
          const amount = Math.round(Number(fillAmount) * 1e9);
          const tx = buildFillWithCoins({
            contractId: contract.id,
            fillAmount: amount,
            characterId,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result = await signAndExecute({ transaction: tx as any });
        } else {
          // ItemForCoin — filler pays coins to get items
          const amount = Math.round(Number(fillAmount) * 1e9);
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
          result = await signAndExecute({ transaction: tx as any });
        }
      } else if (isItemFill && sourceSsu) {
        const capParams = {
          fillerSsuId: sourceSsuId,
          fillerOwnerCapId: sourceSsu.ownerCapId,
          fillerOwnerCapVersion: sourceSsu.ownerCapVersion,
          fillerOwnerCapDigest: sourceSsu.ownerCapDigest,
          typeId: Number(selectedTypeId),
          quantity: selectedQty,
        };
        if (variant === "CoinForItem") {
          const tx = buildFillCoinForItemComposite({
            contractId: contract.id,
            destinationSsuId,
            posterCharacterId: contract.posterId,
            fillerCharacterId: characterId,
            ...capParams,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result = await signAndExecute({ transaction: tx as any });
        } else {
          // ItemForItem
          const ct = contract.contractType;
          const contractSourceSsu = ct.variant === "ItemForItem" ? ct.sourceSsuId : "";
          const tx = buildFillItemForItemComposite({
            contractId: contract.id,
            sourceSsuId: contractSourceSsu,
            destinationSsuId,
            posterCharacterId: contract.posterId,
            fillerCharacterId: characterId,
            ...capParams,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result = await signAndExecute({ transaction: tx as any });
        }
      } else if (isTransportDeliver) {
        const ct = contract.contractType;
        const destSsu = ct.variant === "Transport" ? ct.destinationSsuId : "";
        const tx = buildDeliverTransport({
          contractId: contract.id,
          destinationSsuId: destSsu,
          courierCharacterId: characterId,
          posterCharacterId: contract.posterId,
          itemId,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await signAndExecute({ transaction: tx as any });
      }

      // Wait for the transaction to be indexed before refreshing UI
      if (result) {
        await suiClient.waitForTransaction({ digest: result.digest });
      }

      push({ level: "info", title: "Contract Filled", message: "Transaction submitted successfully.", source: "fill-contract" });
      onFilled?.();
      onClose();
    } catch (err) {
      push({ level: "error", title: "Fill Failed", message: String(err), source: "fill-contract" });
    }
  }

  const isValid = (() => {
    if (!characterId) return false;
    if (isCoinFill) {
      if (isZeroCoinTarget && (variant === "ItemForCoin" || variant === "CoinForCoin")) return Number(claimQuantity) > 0;
      return Number(fillAmount) > 0;
    }
    if (isItemFill) return !!sourceSsuId && !!selectedTypeId && selectedQty > 0;
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

      {isCoinFill && !isZeroCoinTarget && (
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

      {isCoinFill && isZeroCoinTarget && variant === "ItemForCoin" && (
        <>
          <Info>No coins required — claim items for free.</Info>
          <Label>Quantity to Claim{remaining > 0 ? ` (max ${remaining.toLocaleString()})` : ""}</Label>
          <Input
            type="number"
            min="1"
            max={remaining || undefined}
            placeholder="1"
            value={claimQuantity}
            onChange={(e) => setClaimQuantity(e.target.value)}
            autoFocus
          />
        </>
      )}

      {isCoinFill && isZeroCoinTarget && variant === "CoinForCoin" && (
        <>
          <Info>No coins required — claim free coins from escrow.</Info>
          <Label>Amount to Claim (SUI){remaining > 0 ? ` (max ${formatAmount(String(remaining))})` : ""}</Label>
          <Input
            type="number"
            min="0"
            placeholder="0.0"
            value={claimQuantity}
            onChange={(e) => setClaimQuantity(e.target.value)}
            autoFocus
          />
        </>
      )}

      {isItemFill && (
        <>
          <Label>Destination SSU</Label>
          <ReadOnlyField>{truncateAddress(destinationSsuId, 12, 8)}</ReadOnlyField>

          <Label>Your Source SSU</Label>
          <SsuPickerField
            value={sourceSsuId}
            onChange={(id) => {
              setSourceSsuId(id);
              setSelectedTypeId("");
              setSelectedQty(0);
            }}
            placeholder="Select one of your SSUs…"
          />

          <Label>Item</Label>
          <SsuItemPickerField
            ssuId={sourceSsuId}
            ownerCapId={sourceSsu?.ownerCapId ?? ""}
            value={selectedTypeId}
            onChange={handleItemSelected}
            filterTypeId={wantedTypeId}
            placeholder="Select matching item…"
          />

          {selectedQty > 0 && contract.allowPartial && (
            <>
              <Label>Quantity (max {Math.min(selectedQty, Math.max(remaining, 0)).toLocaleString()})</Label>
              <Input
                type="number"
                min="1"
                max={Math.min(selectedQty, Math.max(remaining, 0)) || undefined}
                value={selectedQty}
                onChange={(e) => setSelectedQty(Math.max(1, Number(e.target.value)))}
              />
            </>
          )}
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
