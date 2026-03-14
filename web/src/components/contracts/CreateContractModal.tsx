import { useState, useCallback, useEffect, useMemo } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { useIdentity } from "../../hooks/useIdentity";
import { useMyStructures } from "../../hooks/useStructures";
import type { TrustlessContractVariant } from "../../lib/types";
import {
  buildCreateCoinForCoin,
  buildCreateCoinForItem,
  buildCreateItemForCoin,
  buildCreateItemForItem,
  buildCreateTransport,
  buildAuthorizeExtension,
} from "../../lib/sui";
import { ItemPickerField } from "../shared/ItemPickerField";
import { SsuPickerField } from "../shared/SsuPickerField";
import { SsuItemPickerField } from "../shared/SsuItemPickerField";

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

const WarningBanner = styled.div`
  background: ${({ theme }) => theme.colors.warning}22;
  border: 1px solid ${({ theme }) => theme.colors.warning};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.warning};
  font-size: 13px;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const EnableButton = styled.button`
  width: 100%;
  background: transparent;
  color: ${({ theme }) => theme.colors.warning};
  border: 1px solid ${({ theme }) => theme.colors.warning};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  margin-bottom: ${({ theme }) => theme.spacing.md};

  &:hover {
    background: ${({ theme }) => theme.colors.warning}22;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
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
  const { structures, refetch: refetchStructures } = useMyStructures();

  const getOwnerCapId = useCallback(
    (ssuId: string) => structures.find((s) => s.id === ssuId)?.ownerCapId ?? "",
    [structures],
  );

  const getOwnerCapDetails = useCallback(
    (ssuId: string) => {
      const s = structures.find((s) => s.id === ssuId);
      return {
        ownerCapId: s?.ownerCapId ?? "",
        ownerCapVersion: s?.ownerCapVersion ?? "",
        ownerCapDigest: s?.ownerCapDigest ?? "",
      };
    },
    [structures],
  );

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
  const [offeredQuantity, setOfferedQuantity] = useState("");
  const [availableQuantity, setAvailableQuantity] = useState(0);
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
  const [isEnabling, setIsEnabling] = useState(false);

  // --- Extension check: SSUs that need TrustlessAuth ---
  const TRUSTLESS_EXT = "trustless_contracts::TrustlessAuth";

  /** SSU IDs selected by the current variant that lack the TrustlessAuth extension. */
  const ssusNeedingExtension = useMemo(() => {
    const ids: string[] = [];
    switch (variant) {
      case "ItemForCoin":
        if (sourceSsuId) ids.push(sourceSsuId);
        break;
      case "ItemForItem":
        if (sourceSsuId) ids.push(sourceSsuId);
        if (i4iDestinationSsuId) ids.push(i4iDestinationSsuId);
        break;
      case "CoinForItem":
        if (destinationSsuId) ids.push(destinationSsuId);
        break;
      case "Transport":
        if (destinationSsuId) ids.push(destinationSsuId);
        break;
    }
    // Deduplicate then filter to SSUs missing the correct extension
    return [...new Set(ids)].filter((id) => {
      const ssu = structures.find((s) => s.id === id);
      return ssu && !(ssu.extension?.includes(TRUSTLESS_EXT) ?? false);
    });
  }, [variant, sourceSsuId, destinationSsuId, i4iDestinationSsuId, structures]);

  /** True when at least one SSU has a *different* extension that will be replaced. */
  const willReplaceExtension = useMemo(
    () =>
      ssusNeedingExtension.some((id) => {
        const ssu = structures.find((s) => s.id === id);
        return ssu?.extension != null && !ssu.extension.includes(TRUSTLESS_EXT);
      }),
    [ssusNeedingExtension, structures],
  );

  async function handleEnableExtension(ssuId: string) {
    if (!characterId) return;
    setIsEnabling(true);
    setError(null);
    const cap = getOwnerCapDetails(ssuId);
    const tx = buildAuthorizeExtension({
      characterId,
      structureId: ssuId,
      ownerCapId: cap.ownerCapId,
      ownerCapVersion: cap.ownerCapVersion,
      ownerCapDigest: cap.ownerCapDigest,
    });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await signAndExecute({ transaction: tx as any });
      refetchStructures();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to enable contracts extension";
      setError(msg);
    } finally {
      setIsEnabling(false);
    }
  }

  // Reset item selections when the associated SSU changes
  useEffect(() => { setItemId(""); setOfferedQuantity(""); setAvailableQuantity(0); }, [sourceSsuId]);
  useEffect(() => { setTransportItemTypeId(""); setTransportItemQuantity(""); }, [destinationSsuId]);

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
      case "ItemForCoin": {
        const cap = getOwnerCapDetails(sourceSsuId);
        tx = buildCreateItemForCoin({
          characterId,
          sourceSsuId,
          typeId: Number(itemId),
          quantity: Number(offeredQuantity),
          ownerCapId: cap.ownerCapId,
          ownerCapVersion: cap.ownerCapVersion,
          ownerCapDigest: cap.ownerCapDigest,
          wantedAmount: Math.round(Number(itemWantedAmount) * 1e9),
          allowPartial,
          deadlineMs,
          allowedCharacters: chars,
          allowedTribes: tribes,
        });
        break;
      }
      case "ItemForItem": {
        const cap = getOwnerCapDetails(sourceSsuId);
        tx = buildCreateItemForItem({
          characterId,
          sourceSsuId,
          typeId: Number(itemId),
          quantity: Number(offeredQuantity),
          ownerCapId: cap.ownerCapId,
          ownerCapVersion: cap.ownerCapVersion,
          ownerCapDigest: cap.ownerCapDigest,
          wantedTypeId: Number(i4iWantedTypeId),
          wantedQuantity: Number(i4iWantedQuantity),
          destinationSsuId: i4iDestinationSsuId,
          allowPartial,
          deadlineMs,
          allowedCharacters: chars,
          allowedTribes: tribes,
        });
        break;
      }
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
        return !!sourceSsuId && !!itemId && Number(offeredQuantity) > 0 && Number(itemWantedAmount) > 0;
      case "ItemForItem":
        return !!sourceSsuId && !!itemId && Number(offeredQuantity) > 0 && Number(i4iWantedQuantity) > 0 && !!i4iDestinationSsuId;
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
          <Label>Destination SSU</Label>
          <SsuPickerField value={destinationSsuId} onChange={setDestinationSsuId} />
        </>
      )}

      {variant === "ItemForCoin" && (
        <>
          <Label>Source SSU</Label>
          <SsuPickerField value={sourceSsuId} onChange={setSourceSsuId} />
          {submitted && !sourceSsuId && <FieldError>Required</FieldError>}
          <Row>
            <div>
              <Label>Item</Label>
              <SsuItemPickerField
                ssuId={sourceSsuId}
                ownerCapId={getOwnerCapId(sourceSsuId)}
                value={itemId}
                onChange={(entry) => {
                  setItemId(String(entry.typeId));
                  setOfferedQuantity(String(entry.quantity));
                  setAvailableQuantity(entry.quantity);
                }}
              />
              {submitted && !itemId && <FieldError>Required</FieldError>}
            </div>
            <div>
              <Label>Quantity{availableQuantity > 0 ? ` (max ${availableQuantity.toLocaleString()})` : ""}</Label>
              <Input
                type="number"
                min="1"
                max={availableQuantity || undefined}
                value={offeredQuantity}
                onChange={(e) => setOfferedQuantity(e.target.value)}
              />
              {submitted && !(Number(offeredQuantity) > 0) && <FieldError>Must be greater than 0</FieldError>}
              {Number(offeredQuantity) > availableQuantity && availableQuantity > 0 && (
                <FieldError>Exceeds available ({availableQuantity.toLocaleString()})</FieldError>
              )}
            </div>
          </Row>
          <Label>Wanted Amount (SUI)</Label>
          <Input type="number" placeholder="0.0" value={itemWantedAmount} onChange={(e) => setItemWantedAmount(e.target.value)} />
          {submitted && !(Number(itemWantedAmount) > 0) && <FieldError>Must be greater than 0</FieldError>}
        </>
      )}

      {variant === "ItemForItem" && (
        <>
          <Label>Source SSU</Label>
          <SsuPickerField value={sourceSsuId} onChange={setSourceSsuId} />
          {submitted && !sourceSsuId && <FieldError>Required</FieldError>}
          <Row>
            <div>
              <Label>Offered Item</Label>
              <SsuItemPickerField
                ssuId={sourceSsuId}
                ownerCapId={getOwnerCapId(sourceSsuId)}
                value={itemId}
                onChange={(entry) => {
                  setItemId(String(entry.typeId));
                  setOfferedQuantity(String(entry.quantity));
                  setAvailableQuantity(entry.quantity);
                }}
              />
              {submitted && !itemId && <FieldError>Required</FieldError>}
            </div>
            <div>
              <Label>Quantity{availableQuantity > 0 ? ` (max ${availableQuantity.toLocaleString()})` : ""}</Label>
              <Input
                type="number"
                min="1"
                max={availableQuantity || undefined}
                value={offeredQuantity}
                onChange={(e) => setOfferedQuantity(e.target.value)}
              />
              {submitted && !(Number(offeredQuantity) > 0) && <FieldError>Must be greater than 0</FieldError>}
              {Number(offeredQuantity) > availableQuantity && availableQuantity > 0 && (
                <FieldError>Exceeds available ({availableQuantity.toLocaleString()})</FieldError>
              )}
            </div>
          </Row>
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
          <Label>Destination SSU</Label>
          <SsuPickerField value={i4iDestinationSsuId} onChange={setI4iDestinationSsuId} />
          {submitted && !i4iDestinationSsuId && <FieldError>Required</FieldError>}
        </>
      )}

      {variant === "Transport" && (
        <>
          <Label>Destination SSU</Label>
          <SsuPickerField value={destinationSsuId} onChange={setDestinationSsuId} />
          <Row>
            <div>
              <Label>Item</Label>
              <SsuItemPickerField
                ssuId={destinationSsuId}
                ownerCapId={getOwnerCapId(destinationSsuId)}
                value={transportItemTypeId}
                onChange={(entry) => {
                  setTransportItemTypeId(String(entry.typeId));
                  setTransportItemQuantity(String(entry.quantity));
                }}
              />
            </div>
            <div>
              <Label>Item Quantity</Label>
              <Input type="number" value={transportItemQuantity} onChange={(e) => setTransportItemQuantity(e.target.value)} />
            </div>
          </Row>
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

      {ssusNeedingExtension.length > 0 && (
        <>
          <WarningBanner>
            {ssusNeedingExtension.length === 1
              ? "The selected SSU needs the Contracts extension enabled before creating this contract."
              : "Some selected SSUs need the Contracts extension enabled before creating this contract."}
            {willReplaceExtension &&
              " Warning: this will replace the existing extension on the SSU."}
          </WarningBanner>
          {ssusNeedingExtension.map((id) => {
            const ssu = structures.find((s) => s.id === id);
            const label = ssu?.name || `${id.slice(0, 10)}…`;
            return (
              <EnableButton
                key={id}
                onClick={() => handleEnableExtension(id)}
                disabled={isEnabling || isPending}
              >
                {isEnabling ? "Enabling…" : `Enable Contracts on ${label}`}
              </EnableButton>
            );
          })}
        </>
      )}

      <Button onClick={handleCreate} disabled={isPending || isEnabling || ssusNeedingExtension.length > 0}>
        {isPending ? "Creating…" : "Create Contract"}
      </Button>
    </Modal>
  );
}
