import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { useIdentity } from "../../hooks/useIdentity";
import type { TrustlessContractVariant } from "../../lib/types";
import {
  buildCreateCoinForCoin,
  buildCreateCoinForItem,
  buildCreateItemForCoin,
  buildCreateItemForItem,
  buildCreateTransport,
} from "../../lib/sui";
import { ItemPickerField } from "../shared/ItemPickerField";

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

const Select = styled.select`
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

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.md};
`;

const CheckboxRow = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  cursor: pointer;
`;

const Hint = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Separator = styled.hr`
  border: none;
  border-top: 1px solid ${({ theme }) => theme.colors.surface.border};
  margin: ${({ theme }) => theme.spacing.md} 0;
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

const ErrorBanner = styled.div`
  background: ${({ theme }) => theme.colors.danger}22;
  border: 1px solid ${({ theme }) => theme.colors.danger};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.danger};
  font-size: 13px;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const FieldError = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.danger};
  margin-top: -${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

// ---------------------------------------------------------------------------

const VARIANT_DESCRIPTIONS: Record<TrustlessContractVariant, string> = {
  CoinForCoin: "Offer coins, receive different coins",
  CoinForItem: "Offer coins, receive items at an SSU",
  ItemForCoin: "Offer items at an SSU, receive coins",
  ItemForItem: "Trade items at one SSU for items at another",
  Transport: "Pay for item delivery to an SSU (courier stakes collateral)",
};

interface Props {
  onClose: () => void;
  onCreated?: () => void;
}

export function CreateContractModal({ onClose, onCreated }: Props) {
  const { characterId } = useIdentity();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  // Contract type selection
  const [variant, setVariant] = useState<TrustlessContractVariant>("CoinForCoin");

  // CoinForCoin fields
  const [escrow, setEscrow] = useState("");
  const [wantedAmount, setWantedAmount] = useState("");

  // CoinForItem fields
  const [wantedTypeId, setWantedTypeId] = useState("");
  const [wantedQuantity, setWantedQuantity] = useState("");
  const [destinationSsuId, setDestinationSsuId] = useState("");

  // ItemForCoin fields
  const [sourceSsuId, setSourceSsuId] = useState("");
  const [itemId, setItemId] = useState("");
  const [itemWantedAmount, setItemWantedAmount] = useState("");

  // Transport fields
  const [transportItemTypeId, setTransportItemTypeId] = useState("");
  const [transportItemQuantity, setTransportItemQuantity] = useState("");
  const [requiredStake, setRequiredStake] = useState("");

  // ItemForItem extra fields
  const [i4iWantedTypeId, setI4iWantedTypeId] = useState("");
  const [i4iWantedQuantity, setI4iWantedQuantity] = useState("");
  const [i4iDestinationSsuId, setI4iDestinationSsuId] = useState("");

  // Common fields
  const [allowPartial, setAllowPartial] = useState(true);
  const [deadlineHours, setDeadlineHours] = useState("48");
  const [allowedCharacters, setAllowedCharacters] = useState("");
  const [allowedTribes, setAllowedTribes] = useState("");

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function parseIdList(s: string): string[] {
    return s.split(",").map((x) => x.trim()).filter(Boolean);
  }

  function parseTribeList(s: string): number[] {
    return s.split(",").map((x) => Number(x.trim())).filter((n) => !isNaN(n) && n > 0);
  }

  async function handleCreate() {
    setSubmitted(true);
    if (!characterId || !isValid) return;
    setError(null);

    const deadlineMs = Date.now() + Number(deadlineHours) * 3600 * 1000;
    const chars = parseIdList(allowedCharacters);
    const tribes = parseTribeList(allowedTribes);

    let tx;
    switch (variant) {
      case "CoinForCoin":
        tx = buildCreateCoinForCoin({
          characterId,
          escrowAmount: Math.round(Number(escrow) * 1e9),
          wantedAmount: Math.round(Number(wantedAmount) * 1e9),
          allowPartial,
          deadlineMs,
          allowedCharacters: chars,
          allowedTribes: tribes,
        });
        break;
      case "CoinForItem":
        tx = buildCreateCoinForItem({
          characterId,
          escrowAmount: Math.round(Number(escrow) * 1e9),
          wantedTypeId: Number(wantedTypeId),
          wantedQuantity: Number(wantedQuantity),
          destinationSsuId,
          allowPartial,
          deadlineMs,
          allowedCharacters: chars,
          allowedTribes: tribes,
        });
        break;
      case "ItemForCoin":
        tx = buildCreateItemForCoin({
          characterId,
          sourceSsuId,
          itemId,
          wantedAmount: Math.round(Number(itemWantedAmount) * 1e9),
          allowPartial,
          deadlineMs,
          allowedCharacters: chars,
          allowedTribes: tribes,
        });
        break;
      case "ItemForItem":
        tx = buildCreateItemForItem({
          characterId,
          sourceSsuId,
          itemId,
          wantedTypeId: Number(i4iWantedTypeId),
          wantedQuantity: Number(i4iWantedQuantity),
          destinationSsuId: i4iDestinationSsuId,
          allowPartial,
          deadlineMs,
          allowedCharacters: chars,
          allowedTribes: tribes,
        });
        break;
      case "Transport":
        tx = buildCreateTransport({
          characterId,
          escrowAmount: Math.round(Number(escrow) * 1e9),
          itemTypeId: Number(transportItemTypeId),
          itemQuantity: Number(transportItemQuantity),
          destinationSsuId,
          requiredStake: Math.round(Number(requiredStake) * 1e9),
          deadlineMs,
          allowedCharacters: chars,
          allowedTribes: tribes,
        });
        break;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await signAndExecute({ transaction: tx as any });
      onCreated?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setError(msg);
    }
  }

  const isValid = (() => {
    if (!characterId) return false;
    switch (variant) {
      case "CoinForCoin":
        return Number(escrow) > 0 && Number(wantedAmount) > 0;
      case "CoinForItem":
        return Number(escrow) > 0 && Number(wantedQuantity) > 0 && !!destinationSsuId;
      case "ItemForCoin":
        return !!sourceSsuId && !!itemId && Number(itemWantedAmount) > 0;
      case "ItemForItem":
        return !!sourceSsuId && !!itemId && Number(i4iWantedQuantity) > 0 && !!i4iDestinationSsuId;
      case "Transport":
        return Number(escrow) > 0 && Number(transportItemQuantity) > 0 && !!destinationSsuId && Number(requiredStake) > 0;
    }
  })();

  return (
    <Modal title="Create Trustless Contract" onClose={onClose}>
      <Label>Contract Type</Label>
      <Select value={variant} onChange={(e) => setVariant(e.target.value as TrustlessContractVariant)}>
        {(Object.keys(VARIANT_DESCRIPTIONS) as TrustlessContractVariant[]).map((v) => (
          <option key={v} value={v}>{v.replace(/([A-Z])/g, " $1").trim()}</option>
        ))}
      </Select>
      <Hint>{VARIANT_DESCRIPTIONS[variant]}</Hint>

      <Separator />

      {/* Type-specific fields */}
      {(variant === "CoinForCoin" || variant === "CoinForItem" || variant === "Transport") && (
        <div>
          <Label>Escrow Amount (SUI)</Label>
          <Input type="number" placeholder="0.0" value={escrow} onChange={(e) => setEscrow(e.target.value)} />
        </div>
      )}

      {variant === "CoinForCoin" && (
        <div>
          <Label>Wanted Amount (SUI)</Label>
          <Input type="number" placeholder="0.0" value={wantedAmount} onChange={(e) => setWantedAmount(e.target.value)} />
        </div>
      )}

      {variant === "CoinForItem" && (
        <>
          <Row>
            <div>
              <Label>Wanted Type ID</Label>
              <ItemPickerField value={wantedTypeId} onChange={setWantedTypeId} />
            </div>
            <div>
              <Label>Wanted Quantity</Label>
              <Input type="number" value={wantedQuantity} onChange={(e) => setWantedQuantity(e.target.value)} />
            </div>
          </Row>
          <Label>Destination SSU ID</Label>
          <Input placeholder="0x..." value={destinationSsuId} onChange={(e) => setDestinationSsuId(e.target.value)} />
        </>
      )}

      {variant === "ItemForCoin" && (
        <>
          <Label>Source SSU ID</Label>
          <Input placeholder="0x..." value={sourceSsuId} onChange={(e) => setSourceSsuId(e.target.value)} />
          {submitted && !sourceSsuId && <FieldError>Required</FieldError>}
          <Label>Item Object ID</Label>
          <Input placeholder="0x..." value={itemId} onChange={(e) => setItemId(e.target.value)} />
          {submitted && !itemId && <FieldError>Required</FieldError>}
          <Label>Wanted Amount (SUI)</Label>
          <Input type="number" placeholder="0.0" value={itemWantedAmount} onChange={(e) => setItemWantedAmount(e.target.value)} />
          {submitted && !(Number(itemWantedAmount) > 0) && <FieldError>Must be greater than 0</FieldError>}
        </>
      )}

      {variant === "ItemForItem" && (
        <>
          <Label>Source SSU ID</Label>
          <Input placeholder="0x..." value={sourceSsuId} onChange={(e) => setSourceSsuId(e.target.value)} />
          {submitted && !sourceSsuId && <FieldError>Required</FieldError>}
          <Label>Offered Item Object ID</Label>
          <Input placeholder="0x..." value={itemId} onChange={(e) => setItemId(e.target.value)} />
          {submitted && !itemId && <FieldError>Required</FieldError>}
          <Separator />
          <Hint>What you want in return:</Hint>
          <Row>
            <div>
              <Label>Wanted Type ID</Label>
              <ItemPickerField value={i4iWantedTypeId} onChange={setI4iWantedTypeId} />
            </div>
            <div>
              <Label>Wanted Quantity</Label>
              <Input type="number" value={i4iWantedQuantity} onChange={(e) => setI4iWantedQuantity(e.target.value)} />
              {submitted && !(Number(i4iWantedQuantity) > 0) && <FieldError>Must be greater than 0</FieldError>}
            </div>
          </Row>
          <Label>Destination SSU ID</Label>
          <Input placeholder="0x..." value={i4iDestinationSsuId} onChange={(e) => setI4iDestinationSsuId(e.target.value)} />
          {submitted && !i4iDestinationSsuId && <FieldError>Required</FieldError>}
        </>
      )}

      {variant === "Transport" && (
        <>
          <Row>
            <div>
              <Label>Item Type ID</Label>
              <ItemPickerField value={transportItemTypeId} onChange={setTransportItemTypeId} />
            </div>
            <div>
              <Label>Item Quantity</Label>
              <Input type="number" value={transportItemQuantity} onChange={(e) => setTransportItemQuantity(e.target.value)} />
            </div>
          </Row>
          <Label>Destination SSU ID</Label>
          <Input placeholder="0x..." value={destinationSsuId} onChange={(e) => setDestinationSsuId(e.target.value)} />
          <Label>Required Stake (SUI)</Label>
          <Input type="number" placeholder="0.0" value={requiredStake} onChange={(e) => setRequiredStake(e.target.value)} />
        </>
      )}

      <Separator />

      {/* Common fields */}
      <Row>
        <div>
          <Label>Deadline (hours)</Label>
          <Input type="number" value={deadlineHours} onChange={(e) => setDeadlineHours(e.target.value)} />
        </div>
        <CheckboxRow>
          <input type="checkbox" checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} />
          Allow partial fill
        </CheckboxRow>
      </Row>

      <Label>Allowed Characters (comma-separated IDs, optional)</Label>
      <Input placeholder="0xabc..., 0xdef..." value={allowedCharacters} onChange={(e) => setAllowedCharacters(e.target.value)} />

      <Label>Allowed Tribes (comma-separated IDs, optional)</Label>
      <Input placeholder="1, 2, 3" value={allowedTribes} onChange={(e) => setAllowedTribes(e.target.value)} />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Button onClick={handleCreate} disabled={isPending}>
        {isPending ? "Creating…" : "Create Contract"}
      </Button>
    </Modal>
  );
}
