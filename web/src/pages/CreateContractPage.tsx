import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import styled, { keyframes } from "styled-components";
import { useNavigate } from "react-router-dom";
import { useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { useIdentity } from "../hooks/useIdentity";
import { useMyStructures } from "../hooks/useStructures";
import { useActiveContracts } from "../hooks/useContracts";
import type { TrustlessContractVariant } from "../lib/types";
import {
  buildCreateCoinForCoin,
  buildCreateCoinForItem,
  buildCreateItemForCoin,
  buildCreateItemForItem,
  buildCreateTransport,
  buildAuthorizeExtension,
} from "../lib/sui";
import { ItemPickerField } from "../components/shared/ItemPickerField";
import { SsuPickerField } from "../components/shared/SsuPickerField";
import { SsuItemPickerField } from "../components/shared/SsuItemPickerField";
import { CharacterPickerField } from "../components/shared/CharacterPickerField";
import { TribePickerField } from "../components/shared/TribePickerField";
import { PrimaryButton, SecondaryButton } from "../components/shared/Button";

// ---------------------------------------------------------------------------
// Creation-phase tracking
// ---------------------------------------------------------------------------
type CreationPhase = null | "preparing" | "signing" | "confirming";

const PHASE_LABELS: Record<Exclude<CreationPhase, null>, string> = {
  preparing: "Preparing",
  signing: "Waiting for wallet",
  confirming: "Confirming on chain",
};

const PHASE_ORDER: Exclude<CreationPhase, null>[] = ["preparing", "signing", "confirming"];

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const Page = styled.div`
  max-width: 820px;
`;

const PageHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const BackButton = styled(SecondaryButton)`
  flex-shrink: 0;
`;

const PageTitle = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const FormCard = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.lg};
`;

const Section = styled.section`
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

// ---------------------------------------------------------------------------
// Form elements
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

const SubmitButton = styled(PrimaryButton)`
  font-size: 14px;
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

const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  justify-content: flex-end;
  margin-top: ${({ theme }) => theme.spacing.md};
`;

// ---------------------------------------------------------------------------
// Progress stepper
// ---------------------------------------------------------------------------

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`;

const StepperWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.xs};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const StepDot = styled.div<{ $state: "done" | "active" | "pending" }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${({ $state, theme }) =>
    $state === "done"
      ? theme.colors.primary.main
      : $state === "active"
        ? theme.colors.primary.main
        : theme.colors.surface.border};
  animation: ${({ $state }) => ($state === "active" ? pulse : "none")} 1.2s ease-in-out infinite;
`;

const StepConnector = styled.div<{ $done: boolean }>`
  width: 24px;
  height: 2px;
  background: ${({ $done, theme }) =>
    $done ? theme.colors.primary.main : theme.colors.surface.border};
`;

const StepLabel = styled.span<{ $active: boolean }>`
  font-size: 11px;
  font-weight: ${({ $active }) => ($active ? 600 : 400)};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.text.primary : theme.colors.text.muted};
  white-space: nowrap;
`;

function CreationStepper({ phase }: { phase: Exclude<CreationPhase, null> }) {
  const activeIdx = PHASE_ORDER.indexOf(phase);
  return (
    <StepperWrapper>
      {PHASE_ORDER.map((p, i) => {
        const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
        return (
          <span key={p} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <StepConnector $done={i <= activeIdx} />}
            <StepDot $state={state} />
            <StepLabel $active={state === "active"}>{PHASE_LABELS[p]}</StepLabel>
          </span>
        );
      })}
    </StepperWrapper>
  );
}

// ---------------------------------------------------------------------------

const VARIANT_DESCRIPTIONS: Record<TrustlessContractVariant, string> = {
  CoinForCoin: "Offer coins, receive different coins",
  CoinForItem: "Offer coins, receive items at an SSU",
  ItemForCoin: "Offer items at an SSU, receive coins",
  ItemForItem: "Trade items at one SSU for items at another",
  Transport: "Pay for item delivery to an SSU (courier stakes collateral)",
};

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function CreateContractPage() {
  const navigate = useNavigate();
  const { characterId } = useIdentity();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();
  const { structures, refetch: refetchStructures } = useMyStructures();
  const { refetch: refetchContracts } = useActiveContracts();

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

  const getFreshOwnerCap = useCallback(
    async (ssuId: string) => {
      const cached = getOwnerCapDetails(ssuId);
      if (!cached.ownerCapId) return cached;
      try {
        const obj = await suiClient.getObject({ id: cached.ownerCapId });
        return {
          ownerCapId: cached.ownerCapId,
          ownerCapVersion: obj.data?.version ?? cached.ownerCapVersion,
          ownerCapDigest: obj.data?.digest ?? cached.ownerCapDigest,
        };
      } catch {
        return cached;
      }
    },
    [suiClient, getOwnerCapDetails],
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
  const [transportSourceSsuId, setTransportSourceSsuId] = useState("");
  const [transportItemTypeId, setTransportItemTypeId] = useState("");
  const [transportItemQuantity, setTransportItemQuantity] = useState("");
  const [transportAvailableQuantity, setTransportAvailableQuantity] = useState(0);
  const [requiredStake, setRequiredStake] = useState("");

  // ItemForItem extra fields
  const [i4iWantedTypeId, setI4iWantedTypeId] = useState("");
  const [i4iWantedQuantity, setI4iWantedQuantity] = useState("");
  const [i4iDestinationSsuId, setI4iDestinationSsuId] = useState("");

  // Common fields
  const [allowPartial, setAllowPartial] = useState(true);
  const [deadlineHours, setDeadlineHours] = useState("48");
  const [allowedCharacters, setAllowedCharacters] = useState<string[]>([]);
  const [allowedTribes, setAllowedTribes] = useState<number[]>([]);

  // UI state
  const isValidCoinAmount = (v: string) => v !== "" && !isNaN(Number(v)) && Number(v) >= 0;
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const [creationPhase, setCreationPhase] = useState<CreationPhase>(null);
  const isBusy = creationPhase !== null;

  // --- Extension check ---
  const TRUSTLESS_EXT = "trustless_contracts::TrustlessAuth";

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
        if (transportSourceSsuId) ids.push(transportSourceSsuId);
        if (destinationSsuId) ids.push(destinationSsuId);
        break;
    }
    return [...new Set(ids)].filter((id) => {
      const ssu = structures.find((s) => s.id === id);
      return ssu && !(ssu.extension?.includes(TRUSTLESS_EXT) ?? false);
    });
  }, [variant, sourceSsuId, transportSourceSsuId, destinationSsuId, i4iDestinationSsuId, structures]);

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
    try {
      const cap = await getFreshOwnerCap(ssuId);
      const tx = buildAuthorizeExtension({
        characterId,
        structureId: ssuId,
        ownerCapId: cap.ownerCapId,
        ownerCapVersion: cap.ownerCapVersion,
        ownerCapDigest: cap.ownerCapDigest,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await signAndExecute({ transaction: tx as any });
      await suiClient.waitForTransaction({ digest: result.digest });
      await refetchStructures();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to enable contracts extension";
      setError(msg);
    } finally {
      setIsEnabling(false);
    }
  }

  // Reset item selections when the associated SSU changes
  useEffect(() => { setItemId(""); setOfferedQuantity(""); setAvailableQuantity(0); }, [sourceSsuId]);
  useEffect(() => { setTransportItemTypeId(""); setTransportItemQuantity(""); setTransportAvailableQuantity(0); }, [transportSourceSsuId]);

  // Auto-sync ItemForItem destination SSU from source SSU
  const prevSourceSsuId = useRef(sourceSsuId);
  useEffect(() => {
    if (sourceSsuId) {
      setI4iDestinationSsuId((prev) =>
        prev === "" || prev === prevSourceSsuId.current ? sourceSsuId : prev,
      );
    }
    prevSourceSsuId.current = sourceSsuId;
  }, [sourceSsuId]);

  async function handleCreate() {
    setSubmitted(true);
    if (!characterId || !isValid) return;
    setError(null);
    setCreationPhase("preparing");

    const deadlineMs = Date.now() + Number(deadlineHours) * 3600 * 1000;
    const chars = allowedCharacters;
    const tribes = allowedTribes;

    let tx;
    try {
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
          const cap = await getFreshOwnerCap(sourceSsuId);
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
          const cap = await getFreshOwnerCap(sourceSsuId);
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
            sourceSsuId: transportSourceSsuId,
            destinationSsuId,
            requiredStake: Math.round(Number(requiredStake) * 1e9),
            deadlineMs,
            allowedCharacters: chars,
            allowedTribes: tribes,
          });
          break;
      }

      setCreationPhase("signing");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await signAndExecute({ transaction: tx as any });

      setCreationPhase("confirming");
      await suiClient.waitForTransaction({ digest: result.digest });
      await refetchContracts();
      navigate("/contracts");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setError(msg);
    } finally {
      setCreationPhase(null);
    }
  }

  const isValid = (() => {
    if (!characterId) return false;
    switch (variant) {
      case "CoinForCoin":
        return isValidCoinAmount(escrow) && isValidCoinAmount(wantedAmount)
          && (Number(escrow) > 0 || Number(wantedAmount) > 0);
      case "CoinForItem":
        return isValidCoinAmount(escrow) && Number(wantedQuantity) > 0 && !!destinationSsuId;
      case "ItemForCoin":
        return !!sourceSsuId && !!itemId && Number(offeredQuantity) > 0 && isValidCoinAmount(itemWantedAmount);
      case "ItemForItem":
        return !!sourceSsuId && !!itemId && Number(offeredQuantity) > 0 && Number(i4iWantedQuantity) > 0 && !!i4iDestinationSsuId;
      case "Transport":
        return isValidCoinAmount(escrow) && Number(transportItemQuantity) > 0 && !!transportSourceSsuId && !!destinationSsuId && Number(requiredStake) > 0;
    }
  })();

  return (
    <Page>
      <PageHeader>
        <BackButton onClick={() => navigate("/contracts")} disabled={isBusy}>← Back</BackButton>
        <PageTitle>Create Trustless Contract</PageTitle>
      </PageHeader>

      <FormCard>
        {/* Contract type */}
        <Section>
          <SectionTitle>Contract Type</SectionTitle>
          <Select value={variant} onChange={(e) => setVariant(e.target.value as TrustlessContractVariant)}>
            {(Object.keys(VARIANT_DESCRIPTIONS) as TrustlessContractVariant[]).map((v) => (
              <option key={v} value={v}>{v.replace(/([A-Z])/g, " $1").trim()}</option>
            ))}
          </Select>
          <Hint>{VARIANT_DESCRIPTIONS[variant]}</Hint>
        </Section>

        <Separator />

        {/* Type-specific fields */}
        <Section>
          <SectionTitle>Details</SectionTitle>

          {(variant === "CoinForCoin" || variant === "CoinForItem" || variant === "Transport") && (
            <div>
              <Label>Escrow Amount (SUI)</Label>
              <Input type="number" placeholder="0.0" value={escrow} onChange={(e) => setEscrow(e.target.value)} />
              {submitted && !isValidCoinAmount(escrow) && <FieldError>Enter a valid amount</FieldError>}
            </div>
          )}

          {variant === "CoinForCoin" && (
            <div>
              <Label>Wanted Amount (SUI)</Label>
              <Input type="number" placeholder="0.0" value={wantedAmount} onChange={(e) => setWantedAmount(e.target.value)} />
              {submitted && !isValidCoinAmount(wantedAmount) && <FieldError>Enter a valid amount</FieldError>}
            </div>
          )}

          {variant === "CoinForItem" && (
            <>
              <Row>
                <div>
                  <Label>Wanted Item</Label>
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
              {submitted && !isValidCoinAmount(itemWantedAmount) && <FieldError>Enter a valid amount</FieldError>}
              {itemWantedAmount === "0" && <Hint>Items will be offered for free &mdash; fillers can claim without paying.</Hint>}
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
                  <Label>Wanted Item</Label>
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
              <Label>Source SSU (pickup)</Label>
              <SsuPickerField value={transportSourceSsuId} onChange={setTransportSourceSsuId} />
              {submitted && !transportSourceSsuId && <FieldError>Required</FieldError>}
              <Row>
                <div>
                  <Label>Item</Label>
                  <SsuItemPickerField
                    ssuId={transportSourceSsuId}
                    ownerCapId={getOwnerCapId(transportSourceSsuId)}
                    value={transportItemTypeId}
                    onChange={(entry) => {
                      setTransportItemTypeId(String(entry.typeId));
                      setTransportItemQuantity(String(entry.quantity));
                      setTransportAvailableQuantity(entry.quantity);
                    }}
                  />
                </div>
                <div>
                  <Label>Quantity{transportAvailableQuantity > 0 ? ` (max ${transportAvailableQuantity.toLocaleString()})` : ""}</Label>
                  <Input
                    type="number"
                    min="1"
                    max={transportAvailableQuantity || undefined}
                    value={transportItemQuantity}
                    onChange={(e) => setTransportItemQuantity(e.target.value)}
                  />
                  {submitted && !(Number(transportItemQuantity) > 0) && <FieldError>Must be greater than 0</FieldError>}
                  {Number(transportItemQuantity) > transportAvailableQuantity && transportAvailableQuantity > 0 && (
                    <FieldError>Exceeds available ({transportAvailableQuantity.toLocaleString()})</FieldError>
                  )}
                </div>
              </Row>
              <Label>Destination SSU (delivery)</Label>
              <SsuPickerField value={destinationSsuId} onChange={setDestinationSsuId} />
              {submitted && !destinationSsuId && <FieldError>Required</FieldError>}
              <Label>Required Stake (SUI)</Label>
              <Input type="number" placeholder="0.0" value={requiredStake} onChange={(e) => setRequiredStake(e.target.value)} />
              {submitted && !(Number(requiredStake) > 0) && <FieldError>Must be greater than 0</FieldError>}
            </>
          )}
        </Section>

        <Separator />

        {/* Common fields */}
        <Section>
          <SectionTitle>Options</SectionTitle>
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

          <Label>Allowed Characters (optional)</Label>
          <CharacterPickerField value={allowedCharacters} onChange={setAllowedCharacters} />

          <Label>Allowed Tribes (optional)</Label>
          <TribePickerField value={allowedTribes} onChange={setAllowedTribes} />
        </Section>

        {/* Errors / extension warnings */}
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
                  disabled={isEnabling || isBusy}
                >
                  {isEnabling ? "Enabling…" : `Enable Contracts on ${label}`}
                </EnableButton>
              );
            })}
          </>
        )}

        {creationPhase && <CreationStepper phase={creationPhase} />}

        <ButtonRow>
          <SecondaryButton onClick={() => navigate("/contracts")} disabled={isBusy}>
            Cancel
          </SecondaryButton>
          <SubmitButton onClick={handleCreate} disabled={isBusy || isEnabling || ssusNeedingExtension.length > 0}>
            {creationPhase ? PHASE_LABELS[creationPhase] + "…" : "Create Contract"}
          </SubmitButton>
        </ButtonRow>
      </FormCard>
    </Page>
  );
}
