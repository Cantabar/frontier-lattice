import { useState, useMemo, useEffect } from "react";
import styled from "styled-components";
import { useSuiClient, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { TransactionStepper } from "../shared/TransactionStepper";
import { useTransactionPhase } from "../../hooks/useTransactionPhase";
import { useIdentity } from "../../hooks/useIdentity";
import { useMyStructures } from "../../hooks/useStructures";
import { useNotifications } from "../../hooks/useNotifications";
import { formatAmount, formatRate } from "../../lib/format";
import { CopyableId } from "../shared/CopyableId";
import type { TrustlessContractData } from "../../lib/types";
import type { InventoryItemEntry } from "../../hooks/useSsuInventory";
import {
  buildFillWithCoins,
  buildFillItemForCoin,
  buildFillCoinForItemComposite,
  buildFillItemForItemComposite,
  buildFillItemForItemSameSsuComposite,
  buildClaimFreeItems,
  buildClaimFreeCoins,
  buildDeliverTransport,
  type ItemAccessMode,
} from "../../lib/sui";
import { SsuItemPickerField } from "../shared/SsuItemPickerField";
import { ItemBadge } from "../shared/ItemBadge";
import { PrimaryButton } from "../shared/Button";
import { toBaseUnits, fromBaseUnits } from "../../lib/coinUtils";
import { useEscrowCoinDecimals, useFillCoinDecimals } from "../../hooks/useCoinDecimals";

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

const RequirementBox = styled.div`
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.primary.subtle};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.primary};
  line-height: 1.6;
`;

const RequirementNote = styled.div`
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.7;
`;

const Hint = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const CostCallout = styled.div`
  background: ${({ theme }) => theme.colors.primary.subtle};
  border: 1px solid ${({ theme }) => theme.colors.primary.main};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  text-align: center;
`;

const CostLabel = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 2px;
`;

const CostValue = styled.div`
  font-size: 20px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const CostBreakdown = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: 4px;
`;

// ---------------------------------------------------------------------------

const FILL_STEPS = [
  { key: "signing", label: "Waiting for wallet" },
  { key: "confirming", label: "Confirming on chain" },
];

interface Props {
  contract: TrustlessContractData;
  onClose: () => void;
  onFilled?: () => void;
}

export function FillContractModal({ contract, onClose, onFilled }: Props) {
  const {
    characterId,
    characterOwnerCapId,
    characterOwnerCapVersion,
    characterOwnerCapDigest,
  } = useIdentity();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { push } = useNotifications();
  const { structures } = useMyStructures();
  const { phase: fillPhase, setPhase: setFillPhase, isBusy, phaseLabel } = useTransactionPhase(FILL_STEPS);
  const { decimals: ceDecimals, symbol: ceSymbol } = useEscrowCoinDecimals();
  const { decimals: cfDecimals, symbol: cfSymbol } = useFillCoinDecimals();

  // Coin fill fields
  const [fillAmount, setFillAmount] = useState("");

  // ItemForCoin item-quantity fill field
  const [fillItemQty, setFillItemQty] = useState("");

  // Free-claim quantity field
  const [claimQuantity, setClaimQuantity] = useState("");

  // Item fill fields (CoinForItem / ItemForItem)
  const [sourceSsuId, setSourceSsuId] = useState("");
  const [sourceSsuOwned, setSourceSsuOwned] = useState(true);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [selectedQty, setSelectedQty] = useState(0);

  // Transport deliver — still needs manual item ID
  const [itemId, setItemId] = useState("");

  // Resolve the filler's selected source SSU to get OwnerCap info
  const sourceSsu = useMemo(
    () => structures.find((s) => s.id === sourceSsuId),
    [structures, sourceSsuId],
  );

  // Build the access mode based on whether the source SSU is owned or not
  const accessMode: ItemAccessMode | null = useMemo(() => {
    if (sourceSsuOwned && sourceSsu) {
      return {
        mode: "ssuOwner",
        ownerCapId: sourceSsu.ownerCapId,
        ownerCapVersion: sourceSsu.ownerCapVersion,
        ownerCapDigest: sourceSsu.ownerCapDigest,
      };
    }
    if (!sourceSsuOwned && characterOwnerCapId && characterOwnerCapVersion && characterOwnerCapDigest) {
      return {
        mode: "character",
        ownerCapId: characterOwnerCapId,
        ownerCapVersion: characterOwnerCapVersion,
        ownerCapDigest: characterOwnerCapDigest,
      };
    }
    return null;
  }, [sourceSsuOwned, sourceSsu, characterOwnerCapId, characterOwnerCapVersion, characterOwnerCapDigest]);

  // Inventory display key: for owned SSUs use the SSU's ownerCapId,
  // for non-owned SSUs use the Character's ownerCapId (player inventory slot key)
  const inventoryCapId = sourceSsuOwned
    ? (sourceSsu?.ownerCapId ?? "")
    : (characterOwnerCapId ?? "");

  const variant = contract.contractType.variant;
  const isItemForCoin = variant === "ItemForCoin";
  const isCoinForCoin = variant === "CoinForCoin";
  const isCoinForItem = variant === "CoinForItem";

  const isCoinFill = isCoinForCoin || isItemForCoin;

  // When the contract wants 0 coins the filler just needs to claim it.
  // Check wantedAmount from the contract type, not targetQuantity — for free
  // ItemForCoin contracts targetQuantity is the offered item count, not 0.
  const isZeroCoinTarget = (() => {
    const ct = contract.contractType;
    if (ct.variant === "ItemForCoin") return ct.wantedAmount === "0";
    if (ct.variant === "CoinForCoin") return ct.wantedAmount === "0";
    return false;
  })();

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

  // Per-unit price for ItemForCoin (in MIST)
  const perUnitPriceMist = useMemo(() => {
    if (!isItemForCoin || contract.contractType.variant !== "ItemForCoin") return 0;
    const { wantedAmount, offeredQuantity } = contract.contractType;
    if (offeredQuantity === 0) return 0;
    return Number(wantedAmount) / offeredQuantity;
  }, [contract, isItemForCoin]);

  // Total cost for the selected item quantity (in MIST)
  const fillItemCostMist = useMemo(() => {
    const qty = Number(fillItemQty) || 0;
    if (!isItemForCoin || qty <= 0 || perUnitPriceMist <= 0) return 0;
    const ct = contract.contractType;
    if (ct.variant !== "ItemForCoin") return 0;
    // Use integer math to avoid rounding issues: ceil(qty * wantedAmount / offeredQuantity)
    const total = BigInt(qty) * BigInt(ct.wantedAmount);
    const divisor = BigInt(ct.offeredQuantity);
    // Ceiling division
    return Number((total + divisor - 1n) / divisor);
  }, [fillItemQty, isItemForCoin, perUnitPriceMist, contract]);

  // Unit price for CoinForCoin (MIST per unit of fill)
  const c4cUnitPrice = useMemo(() => {
    if (!isCoinForCoin || contract.contractType.variant !== "CoinForCoin") return 0;
    const e = Number(contract.escrowAmount);
    const t = Number(contract.targetQuantity);
    if (t === 0) return 0;
    return e / t;
  }, [contract, isCoinForCoin]);

  // Unit price for CoinForItem (MIST per item)
  const c4iUnitPrice = useMemo(() => {
    if (!isCoinForItem || contract.contractType.variant !== "CoinForItem") return 0;
    const e = Number(contract.escrowAmount);
    const t = Number(contract.targetQuantity);
    if (t === 0) return 0;
    return e / t;
  }, [contract, isCoinForItem]);

  // Dynamic reward for CoinForItem fills (MIST) based on selected quantity
  const fillRewardMist = useMemo(() => {
    if (!isCoinForItem || contract.contractType.variant !== "CoinForItem") return 0;
    if (selectedQty <= 0) return 0;
    const escrow = BigInt(contract.escrowAmount);
    const target = BigInt(contract.targetQuantity);
    if (target === 0n) return 0;
    // Ceiling division: ceil(selectedQty * escrow / target)
    const total = BigInt(selectedQty) * escrow;
    return Number((total + target - 1n) / target);
  }, [selectedQty, isCoinForItem, contract]);

  // Full-fill human-readable amount for non-partial coin fills
  const requiredFillSui = useMemo(() => {
    if (contract.allowPartial) return "";
    const ct = contract.contractType;
    if (ct.variant === "CoinForCoin") return fromBaseUnits(ct.wantedAmount, cfDecimals).toString();
    // ItemForCoin: no longer used for display, but keep for CoinForCoin compat
    if (ct.variant === "ItemForCoin") return fromBaseUnits(ct.wantedAmount, cfDecimals).toString();
    return "";
  }, [contract, cfDecimals]);

  // Required item quantity for non-partial item fills
  const requiredItemQty = useMemo(() => {
    if (contract.allowPartial) return 0;
    const ct = contract.contractType;
    if (ct.variant === "CoinForItem") return ct.wantedQuantity;
    if (ct.variant === "ItemForItem") return ct.wantedQuantity;
    return 0;
  }, [contract]);

  // Dynamic step for the CoinForCoin fill-amount input so the browser
  // stepper arrows increment at a useful decimal granularity.
  const fillStepSui = useMemo(() => {
    const remainingHuman = fromBaseUnits(remaining, cfDecimals);
    if (remainingHuman <= 0) return "any";
    const mag = Math.floor(Math.log10(remainingHuman));
    return String(Math.pow(10, mag - 1));
  }, [remaining, cfDecimals]);

  // Auto-set fillAmount for non-partial coin fills (CoinForCoin only now)
  useEffect(() => {
    if (!contract.allowPartial && requiredFillSui && !isItemForCoin) {
      setFillAmount(requiredFillSui);
    }
  }, [contract.allowPartial, requiredFillSui, isItemForCoin]);

  // Auto-set fillItemQty for non-partial ItemForCoin fills
  useEffect(() => {
    if (!contract.allowPartial && isItemForCoin && remaining > 0) {
      setFillItemQty(String(remaining));
    }
  }, [contract.allowPartial, isItemForCoin, remaining]);

  // For item-fill contracts, lock the source to the destination SSU.
  // The filler's items must already be in their player inventory on that SSU.
  useEffect(() => {
    if (isItemFill && destinationSsuId) {
      setSourceSsuId(destinationSsuId);
      setSourceSsuOwned(false);
    }
  }, [isItemFill, destinationSsuId]);

  function handleItemSelected(entry: InventoryItemEntry) {
    setSelectedTypeId(String(entry.typeId));
    if (!contract.allowPartial && requiredItemQty > 0) {
      setSelectedQty(requiredItemQty);
    } else {
      // Default to min(available, remaining)
      setSelectedQty(Math.min(entry.quantity, Math.max(remaining, 0)));
    }
  }

  function modalTitle(): string {
    if (isTransportDeliver) return "Deliver Items";
    if (isCoinFill) return "Fill with Coins";
    return "Fill with Items";
  }

  async function handleSubmit() {
    if (!characterId) return;
    setFillPhase("signing");

    try {
      let result;
      if (isCoinFill) {
        if (isZeroCoinTarget && variant === "CoinForCoin") {
          // Free coin claim — no fill coin, just specify amount
          const tx = buildClaimFreeCoins({
            contractId: contract.id,
            fillerCharacterId: characterId,
            claimAmount: toBaseUnits(claimQuantity, ceDecimals),
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
          const amount = toBaseUnits(fillAmount, cfDecimals);
          const tx = buildFillWithCoins({
            contractId: contract.id,
            fillAmount: amount,
            characterId,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result = await signAndExecute({ transaction: tx as any });
        } else {
          // ItemForCoin — filler pays coins to get items
          const amount = fillItemCostMist;
          const ct = contract.contractType;
          const sourceSsu = ct.variant === "ItemForCoin" ? ct.sourceSsuId : "";
          const tx = buildFillItemForCoin({
            contractId: contract.id,
            sourceSsuId: sourceSsu,
            fillerCharacterId: characterId,
            fillAmount: amount,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result = await signAndExecute({ transaction: tx as any });
        }
    } else if (isItemFill && accessMode) {
        if (variant === "CoinForItem") {
          const tx = buildFillCoinForItemComposite({
            contractId: contract.id,
            destinationSsuId,
            posterCharacterId: contract.posterId,
            fillerCharacterId: characterId,
            fillerSsuId: sourceSsuId,
            access: accessMode,
            typeId: Number(selectedTypeId),
            quantity: selectedQty,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result = await signAndExecute({ transaction: tx as any });
        } else {
          // ItemForItem
          const ct = contract.contractType;
          const contractSourceSsu = ct.variant === "ItemForItem" ? ct.sourceSsuId : "";
          const sameSsu = contractSourceSsu === destinationSsuId;
          const tx = sameSsu
            ? buildFillItemForItemSameSsuComposite({
                contractId: contract.id,
                ssuId: contractSourceSsu,
                posterCharacterId: contract.posterId,
                fillerCharacterId: characterId,
                fillerSsuId: sourceSsuId,
                access: accessMode,
                typeId: Number(selectedTypeId),
                quantity: selectedQty,
              })
            : buildFillItemForItemComposite({
                contractId: contract.id,
                sourceSsuId: contractSourceSsu,
                destinationSsuId,
                posterCharacterId: contract.posterId,
                fillerCharacterId: characterId,
                fillerSsuId: sourceSsuId,
                access: accessMode,
                typeId: Number(selectedTypeId),
                quantity: selectedQty,
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
      setFillPhase("confirming");
      if (result) {
        await suiClient.waitForTransaction({ digest: result.digest });
      }

      push({ level: "info", title: "Contract Filled", message: "Transaction submitted successfully.", source: "fill-contract" });
      onFilled?.();
      onClose();
    } catch (err) {
      setFillPhase(null);
      push({ level: "error", title: "Fill Failed", message: String(err), source: "fill-contract" });
    }
  }

  const isValid = (() => {
    if (!characterId) return false;
    if (isCoinFill) {
      if (isZeroCoinTarget && (variant === "ItemForCoin" || variant === "CoinForCoin")) return Number(claimQuantity) > 0;
      if (isItemForCoin) return Number(fillItemQty) > 0 && Number(fillItemQty) <= remaining;
      return Number(fillAmount) > 0;
    }
    if (isItemFill) return !!sourceSsuId && !!selectedTypeId && selectedQty > 0;
    if (isTransportDeliver) return !!itemId;
    return false;
  })();

  return (
    <Modal title={modalTitle()} onClose={onClose} disableClose={isBusy}>
      <Info>
        {isItemForCoin && contract.contractType.variant === "ItemForCoin" ? (
          <>
            Items remaining: {remaining.toLocaleString()} / {contract.contractType.offeredQuantity.toLocaleString()}
            <div>Item: <ItemBadge typeId={contract.contractType.offeredTypeId} /></div>
            <div>Price per item: {formatAmount(String(Math.round(perUnitPriceMist)), cfDecimals)} {cfSymbol}</div>
            <div>Total price (all items): {formatAmount(contract.contractType.wantedAmount, cfDecimals)} {cfSymbol}</div>
            {contract.escrowAmount !== "0" && (
              <div>Escrow held: {formatAmount(contract.escrowAmount, ceDecimals)} {ceSymbol}</div>
            )}
          </>
        ) : (
          <>
            Remaining: {isCoinForCoin ? formatAmount(String(remaining), cfDecimals) : remaining.toLocaleString()} / {isCoinForCoin ? formatAmount(contract.targetQuantity, cfDecimals) : Number(contract.targetQuantity).toLocaleString()}{isCoinForCoin ? ` ${cfSymbol}` : ""}
            {isCoinForItem && c4iUnitPrice > 0 && (
              <div>Unit price: {formatAmount(String(Math.round(c4iUnitPrice)), ceDecimals)} {ceSymbol} per item</div>
            )}
          </>
        )}
        {!isItemForCoin && contract.escrowAmount !== "0" && (
          isCoinForItem && c4iUnitPrice > 0
            ? <div>Reward pool: {formatAmount(contract.escrowAmount, ceDecimals)} {ceSymbol} · {formatAmount(String(Math.round(c4iUnitPrice)), ceDecimals)} {ceSymbol} per item</div>
            : <> — Reward: {formatAmount(contract.escrowAmount, ceDecimals)} {ceSymbol} (held in escrow)</>
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

      {!contract.allowPartial && !isZeroCoinTarget && (
        <RequirementBox>
          {variant === "CoinForCoin" && contract.contractType.variant === "CoinForCoin" && (
            <>Pay <strong>{formatAmount(contract.contractType.wantedAmount, cfDecimals)} {cfSymbol}</strong> to receive <strong>{formatAmount(contract.contractType.offeredAmount, ceDecimals)} {ceSymbol}</strong></>
          )}
          {isItemForCoin && contract.contractType.variant === "ItemForCoin" && (
            <>Pay <strong>{formatAmount(contract.contractType.wantedAmount, cfDecimals)} {cfSymbol}</strong> ({formatAmount(String(Math.round(perUnitPriceMist)), cfDecimals)} {cfSymbol}/item) to receive <strong>{contract.contractType.offeredQuantity.toLocaleString()}</strong> × <ItemBadge typeId={contract.contractType.offeredTypeId} /></>
          )}
          {variant === "CoinForItem" && contract.contractType.variant === "CoinForItem" && (
            <>Deliver <strong>{contract.contractType.wantedQuantity.toLocaleString()}</strong> × <ItemBadge typeId={contract.contractType.wantedTypeId} /> to receive <strong>{formatAmount(contract.contractType.offeredAmount, ceDecimals)} {ceSymbol}</strong></>
          )}
          {variant === "ItemForItem" && contract.contractType.variant === "ItemForItem" && (
            <>Deliver <strong>{contract.contractType.wantedQuantity.toLocaleString()}</strong> × <ItemBadge typeId={contract.contractType.wantedTypeId} /> to receive <strong>{contract.contractType.offeredQuantity.toLocaleString()}</strong> × <ItemBadge typeId={contract.contractType.offeredTypeId} /></>
          )}
          {variant === "Transport" && contract.contractType.variant === "Transport" && (
            <>Deliver <strong>{contract.contractType.itemQuantity.toLocaleString()}</strong> × <ItemBadge typeId={contract.contractType.itemTypeId} /> from source to destination</>
          )}
          <RequirementNote>This contract requires a full fill — partial fills are not accepted.</RequirementNote>
        </RequirementBox>
      )}

      {isCoinFill && !isZeroCoinTarget && !isItemForCoin && (
        <>
          <Label>Fill Amount ({cfSymbol}){contract.allowPartial && remaining > 0 ? ` (max ${formatAmount(String(remaining), cfDecimals)})` : ""}</Label>
          {contract.allowPartial ? (
            <>
              <Input
                type="number"
                step={fillStepSui}
                placeholder="0.0"
                value={fillAmount}
                onChange={(e) => setFillAmount(e.target.value)}
                autoFocus
              />
              {remaining > 0 && (
                <Hint>
                  <a href="#" onClick={(e) => { e.preventDefault(); setFillAmount(fromBaseUnits(remaining, cfDecimals).toString()); }} style={{ color: "inherit", textDecoration: "underline" }}>
                    Fill remaining ({formatAmount(String(remaining), cfDecimals)} {cfSymbol})
                  </a>
                  {c4cUnitPrice > 0 && <> · {formatRate(BigInt(contract.escrowAmount), BigInt(contract.targetQuantity))} {ceSymbol} reward per 1 {cfSymbol} filled</>}
                </Hint>
              )}
            </>
          ) : (
            <ReadOnlyField>{requiredFillSui} {cfSymbol}</ReadOnlyField>
          )}
        </>
      )}

      {isItemForCoin && !isZeroCoinTarget && (
        <>
          <Label>Item Quantity{remaining > 0 ? ` (max ${remaining.toLocaleString()})` : ""}</Label>
          {contract.allowPartial ? (
            <>
              <Input
                type="number"
                min="1"
                step="1"
                max={remaining || undefined}
                placeholder="1"
                value={fillItemQty}
                onChange={(e) => setFillItemQty(e.target.value)}
                autoFocus
              />
              {remaining > 0 && (
                <Hint>
                  <a href="#" onClick={(e) => { e.preventDefault(); setFillItemQty(String(remaining)); }} style={{ color: "inherit", textDecoration: "underline" }}>
                    Fill remaining ({remaining.toLocaleString()} items)
                  </a>
                </Hint>
              )}
            </>
          ) : (
            <ReadOnlyField>{remaining.toLocaleString()} items</ReadOnlyField>
          )}

          {Number(fillItemQty) > 0 && fillItemCostMist > 0 && (
            <CostCallout>
              <CostLabel>Total Cost</CostLabel>
              <CostValue>{formatAmount(String(fillItemCostMist), cfDecimals)} {cfSymbol}</CostValue>
              <CostBreakdown>
                {Number(fillItemQty).toLocaleString()} × {formatAmount(String(Math.round(perUnitPriceMist)), cfDecimals)} {cfSymbol} per item
              </CostBreakdown>
            </CostCallout>
          )}
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
          <Info>No coins required — claim free coins from the reward pool.</Info>
          <Label>Amount to Claim ({ceSymbol}){remaining > 0 ? ` (max ${formatAmount(String(remaining), ceDecimals)})` : ""}</Label>
          <Input
            type="number"
            step="any"
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
          <ReadOnlyField><CopyableId id={destinationSsuId} startLen={12} endLen={8} /></ReadOnlyField>

          <Info>Your items will be taken from your player inventory on the destination SSU.</Info>

          <Label>Item</Label>
          <SsuItemPickerField
            ssuId={sourceSsuId}
            ownerCapId={inventoryCapId}
            value={selectedTypeId}
            onChange={handleItemSelected}
            filterTypeId={wantedTypeId}
            ownerOnly
            placeholder="Select matching item…"
          />

          {selectedQty > 0 && (
            <>
              {contract.allowPartial ? (
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
              ) : (
                <>
                  <Label>Required Quantity</Label>
                  <ReadOnlyField>{requiredItemQty.toLocaleString()}</ReadOnlyField>
                </>
              )}

              {isCoinForItem && fillRewardMist > 0 && (
                <CostCallout>
                  <CostLabel>Reward</CostLabel>
                  <CostValue>{formatAmount(String(fillRewardMist), ceDecimals)} {ceSymbol}</CostValue>
                  <CostBreakdown>
                    {selectedQty.toLocaleString()} × {formatAmount(String(Math.round(c4iUnitPrice)), ceDecimals)} {ceSymbol} per item
                  </CostBreakdown>
                </CostCallout>
              )}
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

      <TransactionStepper steps={FILL_STEPS} currentStep={fillPhase} />

      <SubmitButton $fullWidth onClick={handleSubmit} disabled={!isValid || isBusy}>
        {isBusy ? phaseLabel + "…" : "Submit"}
      </SubmitButton>
    </Modal>
  );
}
