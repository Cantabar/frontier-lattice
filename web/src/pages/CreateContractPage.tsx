import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import styled, { keyframes } from "styled-components";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { useIdentity } from "../hooks/useIdentity";
import { useMyStructures } from "../hooks/useStructures";
import { useActiveContracts } from "../hooks/useContracts";
import type { TrustlessContractVariant } from "../lib/types";
import {
  buildCreateCoinForCoin,
  buildCreateCoinForItem,
  buildCreateItemForCoin,
  buildCreateItemForCoinBatch,
  buildCreateItemForItem,
  buildCreateTransport,
  buildAuthorizeExtension,
  type ItemAccessMode,
} from "../lib/sui";
import { contractTypeLabel, formatAmount, formatRate } from "../lib/format";
import { ItemPickerField } from "../components/shared/ItemPickerField";
import { SsuPickerField } from "../components/shared/SsuPickerField";
import { SsuItemPickerField } from "../components/shared/SsuItemPickerField";
import { SsuMultiItemPickerModal } from "../components/shared/SsuMultiItemPickerModal";
import { CharacterPickerField } from "../components/shared/CharacterPickerField";
import { TribePickerField } from "../components/shared/TribePickerField";
import { ItemBadge } from "../components/shared/ItemBadge";
import { BulkItemEditor } from "../components/contracts/BulkItemEditor";
import { BatchProgressPanel, type BatchState, type BatchStatus } from "../components/contracts/BatchProgressPanel";
import { PrimaryButton, SecondaryButton } from "../components/shared/Button";
import { toBaseUnits, fromBaseUnits } from "../lib/coinUtils";
import { useEscrowCoinDecimals, useFillCoinDecimals } from "../hooks/useCoinDecimals";
import type { BulkItemRow } from "../lib/bulkItemForCoin";
import { hasAnyError, rowsToPayloads, chunkPayloads } from "../lib/bulkItemForCoin";
import { useItems } from "../hooks/useItems";

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
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: ${({ theme }) => theme.spacing.lg};
  align-items: start;

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }
`;

const FormColumn = styled.div`
  min-width: 0;
`;

const SidebarColumn = styled.div`
  position: sticky;
  top: ${({ theme }) => theme.spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};

  @media (max-width: 960px) {
    position: static;
  }
`;

const PageHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  grid-column: 1 / -1;
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
// Sidebar / Preview
// ---------------------------------------------------------------------------

const SidebarPanel = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.md};
`;

const SidebarTitle = styled.h3`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const PreviewTypeTag = styled.span`
  display: inline-block;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.module.trustlessContracts};
`;

const PreviewRestrictedTag = styled.span`
  display: inline-block;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.primary.subtle};
  color: ${({ theme }) => theme.colors.primary.muted};
  margin-left: ${({ theme }) => theme.spacing.xs};
`;

const PreviewSummary = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin: ${({ theme }) => theme.spacing.sm} 0;
`;

const PreviewMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const PreviewAmount = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary.muted};
`;

const DescriptionText = styled.p`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  line-height: 1.5;
  margin: 0;
`;

const ChecklistList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const ChecklistItem = styled.li<{ $done: boolean }>`
  font-size: 13px;
  color: ${({ $done, theme }) =>
    $done ? theme.colors.text.muted : theme.colors.text.primary};
  text-decoration: ${({ $done }) => ($done ? "line-through" : "none")};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};

  &::before {
    content: ${({ $done }) => ($done ? "'✓'" : "'○'")};
    color: ${({ $done, theme }) =>
      $done ? theme.colors.primary.main : theme.colors.text.muted};
    font-size: 14px;
    flex-shrink: 0;
  }
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

function parseToBaseUnits(value: string, decimals: number): bigint | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return BigInt(toBaseUnits(value, decimals));
}

function parsePositiveInteger(value: string): bigint | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) return null;
  return BigInt(amount);
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

const VALID_VARIANTS = new Set<string>(["CoinForCoin", "CoinForItem", "ItemForCoin", "ItemForItem", "Transport"]);

export function CreateContractPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    characterId,
    characterOwnerCapId,
    characterOwnerCapVersion,
    characterOwnerCapDigest,
  } = useIdentity();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();
  const { structures, refetch: refetchStructures } = useMyStructures();
  const { refetch: refetchContracts } = useActiveContracts();
  const { decimals: ceDecimals, symbol: ceSymbol } = useEscrowCoinDecimals();
  const { decimals: cfDecimals, symbol: cfSymbol } = useFillCoinDecimals();

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

  // Contract type selection — honour ?type= query param if valid
  const typeParam = searchParams.get("type");
  const initialVariant: TrustlessContractVariant =
    typeParam && VALID_VARIANTS.has(typeParam) ? (typeParam as TrustlessContractVariant) : "CoinForCoin";
  const [variant, setVariant] = useState<TrustlessContractVariant>(initialVariant);

  // CoinForCoin fields
  const [escrow, setEscrow] = useState("");
  const [wantedAmount, setWantedAmount] = useState("");

  // CoinForItem fields
  const [wantedTypeId, setWantedTypeId] = useState("");
  const [wantedQuantity, setWantedQuantity] = useState("");
  const [destinationSsuId, setDestinationSsuId] = useState("");

  // ItemForCoin fields
  const [sourceSsuId, setSourceSsuId] = useState("");
  const [sourceSsuOwned, setSourceSsuOwned] = useState(true);
  const [itemId, setItemId] = useState("");
  const [offeredQuantity, setOfferedQuantity] = useState("");
  const [availableQuantity, setAvailableQuantity] = useState(0);
  const [itemWantedAmount, setItemWantedAmount] = useState("");

  // Transport fields
  const [transportSourceSsuId, setTransportSourceSsuId] = useState("");
  const [transportSourceSsuOwned, setTransportSourceSsuOwned] = useState(true);
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

  // Bulk ItemForCoin state
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkItemRow[]>([]);
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [bulkBatches, setBulkBatches] = useState<BatchState[]>([]);
  const bulkBusy = bulkBatches.length > 0 && bulkBatches.some((b) => b.status !== "succeeded" && b.status !== "failed" && b.status !== "pending");
  const { getItem } = useItems();

  const isBusy = creationPhase !== null || bulkBusy;

  /** Build the correct ItemAccessMode for a source SSU. */
  const buildAccessMode = useCallback(
    async (ssuId: string, owned: boolean): Promise<ItemAccessMode> => {
      if (owned) {
        const cap = await getFreshOwnerCap(ssuId);
        return { mode: "ssuOwner", ownerCapId: cap.ownerCapId, ownerCapVersion: cap.ownerCapVersion, ownerCapDigest: cap.ownerCapDigest };
      }
      if (!characterOwnerCapId) throw new Error("Character OwnerCap not available");
      try {
        const obj = await suiClient.getObject({ id: characterOwnerCapId });
        return {
          mode: "character",
          ownerCapId: characterOwnerCapId,
          ownerCapVersion: obj.data?.version ?? characterOwnerCapVersion ?? "",
          ownerCapDigest: obj.data?.digest ?? characterOwnerCapDigest ?? "",
        };
      } catch {
        return {
          mode: "character",
          ownerCapId: characterOwnerCapId,
          ownerCapVersion: characterOwnerCapVersion ?? "",
          ownerCapDigest: characterOwnerCapDigest ?? "",
        };
      }
    },
    [getFreshOwnerCap, suiClient, characterOwnerCapId, characterOwnerCapVersion, characterOwnerCapDigest],
  );

  /** Resolve the ownerCapId to use for reading a source SSU's inventory. */
  const getInventoryCapId = useCallback(
    (ssuId: string, owned: boolean) => owned ? getOwnerCapId(ssuId) : (characterOwnerCapId ?? ""),
    [getOwnerCapId, characterOwnerCapId],
  );

  // ---------------------------------------------------------------------------
  // Divisibility validation — prevents rounding dust on partial fills.
  // The Move contract enforces these same guards at creation time.
  // ---------------------------------------------------------------------------
  const divisibilityError: string | null = useMemo(() => {
    if (!allowPartial) return null;
    switch (variant) {
      case "CoinForCoin": {
        const e = toBaseUnits(escrow, ceDecimals);
        const w = toBaseUnits(wantedAmount, cfDecimals);
        if (e > 0 && w > 0 && e % w !== 0) {
          const unitDown = Math.floor(e / w) * w;
          const unitUp = (Math.floor(e / w) + 1) * w;
          return `Reward must be evenly divisible by wanted amount. Nearest valid rewards: ${fromBaseUnits(unitDown, ceDecimals).toFixed(ceDecimals).replace(/\.?0+$/, "")} or ${fromBaseUnits(unitUp, ceDecimals).toFixed(ceDecimals).replace(/\.?0+$/, "")} ${ceSymbol}`;
        }
        return null;
      }
      case "CoinForItem": {
        const e = toBaseUnits(escrow, ceDecimals);
        const q = Number(wantedQuantity);
        if (e > 0 && q > 0 && e % q !== 0) {
          const unitDown = Math.floor(e / q) * q;
          const unitUp = (Math.floor(e / q) + 1) * q;
          return `Reward must be evenly divisible by wanted quantity (${q}). Nearest valid rewards: ${fromBaseUnits(unitDown, ceDecimals).toFixed(ceDecimals).replace(/\.?0+$/, "")} or ${fromBaseUnits(unitUp, ceDecimals).toFixed(ceDecimals).replace(/\.?0+$/, "")} ${ceSymbol}`;
        }
        return null;
      }
      case "ItemForCoin": {
        const w = toBaseUnits(itemWantedAmount, cfDecimals);
        const q = Number(offeredQuantity);
        if (w > 0 && q > 0 && w % q !== 0) {
          const unitDown = Math.floor(w / q) * q;
          const unitUp = (Math.floor(w / q) + 1) * q;
          return `Wanted amount must be evenly divisible by offered quantity (${q}). Nearest valid amounts: ${fromBaseUnits(unitDown, cfDecimals).toFixed(cfDecimals).replace(/\.?0+$/, "")} or ${fromBaseUnits(unitUp, cfDecimals).toFixed(cfDecimals).replace(/\.?0+$/, "")} ${cfSymbol}`;
        }
        return null;
      }
      case "ItemForItem": {
        const o = Number(offeredQuantity);
        const w = Number(i4iWantedQuantity);
        if (o > 0 && w > 0 && o % w !== 0) {
          const unitDown = Math.floor(o / w) * w;
          const unitUp = (Math.floor(o / w) + 1) * w;
          return `Offered quantity must be evenly divisible by wanted quantity (${w}). Nearest valid offered: ${unitDown} or ${unitUp}`;
        }
        return null;
      }
      case "Transport": {
        const p = toBaseUnits(escrow, ceDecimals);
        const s = toBaseUnits(requiredStake, ceDecimals);
        const q = Number(transportItemQuantity);
        if (q > 0) {
          if (p > 0 && p % q !== 0)
            return `Reward must be evenly divisible by item quantity (${q})`;
          if (s > 0 && s % q !== 0)
            return `Stake must be evenly divisible by item quantity (${q})`;
        }
        return null;
      }
    }
  }, [variant, escrow, wantedAmount, wantedQuantity, itemWantedAmount, offeredQuantity, i4iWantedQuantity, transportItemQuantity, requiredStake, allowPartial, ceDecimals, cfDecimals, ceSymbol, cfSymbol]);

  /** Two-part rate hint: ratio + plain-language explanation. */
  const unitPriceHint: { ratio: string; detail: string } | null = useMemo(() => {
    if (divisibilityError) return null;
    switch (variant) {
      case "CoinForCoin": {
        const rewardBase = parseToBaseUnits(escrow, ceDecimals);
        const fillBase = parseToBaseUnits(wantedAmount, cfDecimals);
        if (rewardBase && fillBase) {
          const rate = formatRate(rewardBase, fillBase);
          return {
            ratio: `Exchange rate: ${rate} : 1 (reward : fill)`,
            detail: `For every 1 ${cfSymbol} a filler sends, they receive ${rate} ${ceSymbol} from escrow`,
          };
        }
        return null;
      }
      case "CoinForItem": {
        const rewardBase = parseToBaseUnits(escrow, ceDecimals);
        const wantedQty = parsePositiveInteger(wantedQuantity);
        if (rewardBase && wantedQty) {
          const oneUnit = BigInt(10 ** ceDecimals);
          const rate = formatRate(rewardBase, wantedQty * oneUnit);
          return {
            ratio: `Exchange rate: ${rate} : 1 (${ceSymbol} reward : item)`,
            detail: `For every 1 item delivered, ${rate} ${ceSymbol} is paid from escrow`,
          };
        }
        return null;
      }
      case "ItemForCoin": {
        const wantedBase = parseToBaseUnits(itemWantedAmount, cfDecimals);
        const offeredQty = parsePositiveInteger(offeredQuantity);
        if (wantedBase && offeredQty) {
          const oneUnit = BigInt(10 ** cfDecimals);
          const rate = formatRate(wantedBase, offeredQty * oneUnit);
          return {
            ratio: `Exchange rate: ${rate} : 1 (${cfSymbol} : item)`,
            detail: `For every 1 item purchased, the filler pays ${rate} ${cfSymbol}`,
          };
        }
        return null;
      }
      case "ItemForItem": {
        const offeredQty = parsePositiveInteger(offeredQuantity);
        const wantedQty = parsePositiveInteger(i4iWantedQuantity);
        if (offeredQty && wantedQty) {
          const rate = formatRate(offeredQty, wantedQty);
          return {
            ratio: `Exchange rate: ${rate} : 1 (offered : wanted items)`,
            detail: `For every 1 wanted item delivered, ${rate} offered items are released`,
          };
        }
        return null;
      }
      case "Transport": {
        const rewardBase = parseToBaseUnits(escrow, ceDecimals);
        const itemQty = parsePositiveInteger(transportItemQuantity);
        if (rewardBase && itemQty) {
          const oneUnit = BigInt(10 ** ceDecimals);
          const rate = formatRate(rewardBase, itemQty * oneUnit);
          return {
            ratio: `Exchange rate: ${rate} : 1 (${ceSymbol} : delivered item)`,
            detail: `For every 1 item delivered, ${rate} ${ceSymbol} is paid`,
          };
        }
        return null;
      }
    }
  }, [variant, escrow, wantedAmount, wantedQuantity, itemWantedAmount, offeredQuantity, i4iWantedQuantity, transportItemQuantity, divisibilityError]);

  // --- Extension check ---
  const CORM_EXT = "corm_auth::CormAuth";

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
      return ssu && !(ssu.extension?.includes(CORM_EXT) ?? false);
    });
  }, [variant, sourceSsuId, transportSourceSsuId, destinationSsuId, i4iDestinationSsuId, structures]);

  const willReplaceExtension = useMemo(
    () =>
      ssusNeedingExtension.some((id) => {
        const ssu = structures.find((s) => s.id === id);
        return ssu?.extension != null && !ssu.extension.includes(CORM_EXT);
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
            escrowAmount: toBaseUnits(escrow, ceDecimals),
            wantedAmount: toBaseUnits(wantedAmount, cfDecimals),
            allowPartial,
            deadlineMs,
            allowedCharacters: chars,
            allowedTribes: tribes,
          });
          break;
        case "CoinForItem":
          tx = buildCreateCoinForItem({
            characterId,
            escrowAmount: toBaseUnits(escrow, ceDecimals),
            wantedTypeId: Number(wantedTypeId),
            wantedQuantity: Number(wantedQuantity),
            destinationSsuId,
            allowPartial,
            useOwnerInventory: structures.some((s) => s.id === destinationSsuId),
            deadlineMs,
            allowedCharacters: chars,
            allowedTribes: tribes,
          });
          break;
        case "ItemForCoin": {
          const access = await buildAccessMode(sourceSsuId, sourceSsuOwned);
          tx = buildCreateItemForCoin({
            characterId,
            sourceSsuId,
            typeId: Number(itemId),
            quantity: Number(offeredQuantity),
            access,
            wantedAmount: toBaseUnits(itemWantedAmount, cfDecimals),
            allowPartial,
            deadlineMs,
            allowedCharacters: chars,
            allowedTribes: tribes,
          });
          break;
        }
        case "ItemForItem": {
          const access = await buildAccessMode(sourceSsuId, sourceSsuOwned);
          tx = buildCreateItemForItem({
            characterId,
            sourceSsuId,
            typeId: Number(itemId),
            quantity: Number(offeredQuantity),
            access,
            wantedTypeId: Number(i4iWantedTypeId),
            wantedQuantity: Number(i4iWantedQuantity),
            destinationSsuId: i4iDestinationSsuId,
            allowPartial,
            useOwnerInventory: structures.some((s) => s.id === i4iDestinationSsuId),
            deadlineMs,
            allowedCharacters: chars,
            allowedTribes: tribes,
          });
          break;
        }
        case "Transport": {
          const access = await buildAccessMode(transportSourceSsuId, transportSourceSsuOwned);
          tx = buildCreateTransport({
            characterId,
            sourceSsuId: transportSourceSsuId,
            typeId: Number(transportItemTypeId),
            quantity: Number(transportItemQuantity),
            access,
            escrowAmount: toBaseUnits(escrow, ceDecimals),
            destinationSsuId,
            requiredStake: toBaseUnits(requiredStake, ceDecimals),
            useOwnerInventory: structures.some((s) => s.id === destinationSsuId),
            deadlineMs,
            allowedCharacters: chars,
            allowedTribes: tribes,
          });
          break;
        }
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
    if (!characterId || divisibilityError) return false;
    switch (variant) {
      case "CoinForCoin":
        return isValidCoinAmount(escrow) && isValidCoinAmount(wantedAmount)
          && (Number(escrow) > 0 || Number(wantedAmount) > 0);
      case "CoinForItem":
        return isValidCoinAmount(escrow) && Number(wantedQuantity) > 0 && !!destinationSsuId;
      case "ItemForCoin":
        if (bulkMode) {
          return !!sourceSsuId && bulkRows.length > 0 && !hasAnyError(bulkRows, allowPartial, cfDecimals, cfSymbol);
        }
        return !!sourceSsuId && !!itemId && Number(offeredQuantity) > 0 && isValidCoinAmount(itemWantedAmount);
      case "ItemForItem":
        return !!sourceSsuId && !!itemId && Number(offeredQuantity) > 0 && Number(i4iWantedQuantity) > 0 && !!i4iDestinationSsuId;
      case "Transport":
        return isValidCoinAmount(escrow) && Number(transportItemQuantity) > 0 && !!transportSourceSsuId && !!destinationSsuId && Number(requiredStake) > 0;
    }
  })();

  // Reset bulk state when SSU changes
  useEffect(() => { if (bulkMode) { setBulkRows([]); setBulkBatches([]); } }, [sourceSsuId]);

  /** Bulk ItemForCoin creation: chunk payloads, sign sequentially. */
  async function handleBulkCreate() {
    setSubmitted(true);
    if (!characterId || !isValid || !sourceSsuId) return;
    setError(null);

    const payloads = rowsToPayloads(bulkRows, cfDecimals);
    const chunks = chunkPayloads(payloads);
    const deadlineMs = Date.now() + Number(deadlineHours) * 3600 * 1000;

    // Initialise batch state
    const initial: BatchState[] = chunks.map((items) => ({ items, status: "pending" as BatchStatus }));
    setBulkBatches(initial);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Update status: preparing
      setBulkBatches((prev) =>
        prev.map((b, idx) => (idx === i ? { ...b, status: "preparing" } : b)),
      );

      try {
        const access = await buildAccessMode(sourceSsuId, sourceSsuOwned);
        const tx = buildCreateItemForCoinBatch({
          characterId,
          sourceSsuId,
          access,
          items: chunk.map((p) => ({ typeId: p.typeId, quantity: p.quantity, wantedAmount: p.wantedAmount })),
          allowPartial,
          deadlineMs,
          allowedCharacters,
          allowedTribes,
        });

        // Sign
        setBulkBatches((prev) =>
          prev.map((b, idx) => (idx === i ? { ...b, status: "signing" } : b)),
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await signAndExecute({ transaction: tx as any });

        // Confirm
        setBulkBatches((prev) =>
          prev.map((b, idx) => (idx === i ? { ...b, status: "confirming" } : b)),
        );
        await suiClient.waitForTransaction({ digest: result.digest });

        setBulkBatches((prev) =>
          prev.map((b, idx) => (idx === i ? { ...b, status: "succeeded" } : b)),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Transaction failed";
        setBulkBatches((prev) =>
          prev.map((b, idx) => (idx === i ? { ...b, status: "failed", error: msg } : b)),
        );
        // Stop on failure — remaining batches stay pending
        setError(`Transaction ${i + 1} failed: ${msg}`);
        break;
      }
    }

    await refetchContracts();
    // Navigate only if ALL succeeded
    setBulkBatches((prev) => {
      if (prev.every((b) => b.status === "succeeded")) {
        navigate("/contracts");
      }
      return prev;
    });
  }

  // ---- Preview helpers ----
  const previewSummary = useMemo(() => {
    switch (variant) {
      case "CoinForCoin": {
        const e = Number(escrow) || 0;
        const w = Number(wantedAmount) || 0;
        return { offering: `${e} ${ceSymbol}`, wanting: `${w} ${cfSymbol}` };
      }
      case "CoinForItem": {
        const e = Number(escrow) || 0;
        return { offering: `${e} ${ceSymbol}`, wantedTypeId: Number(wantedTypeId) || 0, wantedQty: Number(wantedQuantity) || 0 };
      }
      case "ItemForCoin": {
        const qty = Number(offeredQuantity) || 0;
        const want = Number(itemWantedAmount) || 0;
        const perUnit = qty > 0 && want > 0 ? (want / qty).toFixed(4) : null;
        return { offeredTypeId: Number(itemId) || 0, offeredQty: qty, wanting: `${want} ${cfSymbol}`, perUnit };
      }
      case "ItemForItem":
        return { offeredTypeId: Number(itemId) || 0, offeredQty: Number(offeredQuantity) || 0, wantedTypeId: Number(i4iWantedTypeId) || 0, wantedQty: Number(i4iWantedQuantity) || 0 };
      case "Transport": {
        const e = Number(escrow) || 0;
        return { offering: `${e} ${ceSymbol}`, itemTypeId: Number(transportItemTypeId) || 0, itemQty: Number(transportItemQuantity) || 0 };
      }
    }
  }, [variant, escrow, wantedAmount, wantedTypeId, wantedQuantity, itemId, offeredQuantity, itemWantedAmount, i4iWantedTypeId, i4iWantedQuantity, transportItemTypeId, transportItemQuantity]);

  const checklist = useMemo(() => {
    const items: { label: string; done: boolean }[] = [];
    switch (variant) {
      case "CoinForCoin":
        items.push({ label: "Set reward amount", done: isValidCoinAmount(escrow) && Number(escrow) > 0 });
        items.push({ label: "Set wanted amount", done: isValidCoinAmount(wantedAmount) && Number(wantedAmount) > 0 });
        break;
      case "CoinForItem":
        items.push({ label: "Set reward amount", done: isValidCoinAmount(escrow) });
        items.push({ label: "Select wanted item", done: !!wantedTypeId });
        items.push({ label: "Set wanted quantity", done: Number(wantedQuantity) > 0 });
        items.push({ label: "Select destination SSU", done: !!destinationSsuId });
        break;
      case "ItemForCoin":
        items.push({ label: "Select source SSU", done: !!sourceSsuId });
        if (bulkMode) {
          items.push({ label: "Select items", done: bulkRows.length > 0 });
          items.push({ label: "Set prices for all items", done: bulkRows.length > 0 && !hasAnyError(bulkRows, allowPartial, cfDecimals, cfSymbol) });
        } else {
          items.push({ label: "Select item to offer", done: !!itemId });
          items.push({ label: "Set quantity", done: Number(offeredQuantity) > 0 });
          items.push({ label: "Set wanted amount", done: isValidCoinAmount(itemWantedAmount) });
        }
        break;
      case "ItemForItem":
        items.push({ label: "Select source SSU", done: !!sourceSsuId });
        items.push({ label: "Select item to offer", done: !!itemId });
        items.push({ label: "Set offered quantity", done: Number(offeredQuantity) > 0 });
        items.push({ label: "Select wanted item", done: !!i4iWantedTypeId });
        items.push({ label: "Set wanted quantity", done: Number(i4iWantedQuantity) > 0 });
        items.push({ label: "Select destination SSU", done: !!i4iDestinationSsuId });
        break;
      case "Transport":
        items.push({ label: "Set reward amount", done: isValidCoinAmount(escrow) });
        items.push({ label: "Select source SSU", done: !!transportSourceSsuId });
        items.push({ label: "Select item", done: !!transportItemTypeId });
        items.push({ label: "Set item quantity", done: Number(transportItemQuantity) > 0 });
        items.push({ label: "Select destination SSU", done: !!destinationSsuId });
        items.push({ label: "Set required stake", done: Number(requiredStake) > 0 });
        break;
    }
    return items;
  }, [variant, escrow, wantedAmount, wantedTypeId, wantedQuantity, destinationSsuId, sourceSsuId, itemId, offeredQuantity, itemWantedAmount, i4iWantedTypeId, i4iWantedQuantity, i4iDestinationSsuId, transportSourceSsuId, transportItemTypeId, transportItemQuantity, requiredStake]);

  const isRestricted = allowedCharacters.length > 0 || allowedTribes.length > 0;

  function renderPreviewSummary() {
    const p = previewSummary;
    switch (variant) {
      case "CoinForCoin":
        return <>Offering {(p as { offering: string }).offering} for {(p as { wanting: string }).wanting}</>;
      case "CoinForItem": {
        const s = p as { offering: string; wantedTypeId: number; wantedQty: number };
        return <>Offering {s.offering} for {s.wantedTypeId ? <ItemBadge typeId={s.wantedTypeId} showQuantity={s.wantedQty || undefined} /> : "…"}</>;
      }
      case "ItemForCoin": {
        if (bulkMode && bulkRows.length > 0) {
          const totalItems = bulkRows.reduce((s, r) => s + r.quantity, 0);
          return <>{bulkRows.length} items ({totalItems.toLocaleString()} units total)</>;
        }
        const s = p as { offeredTypeId: number; offeredQty: number; wanting: string; perUnit: string | null };
        return <>{s.offeredTypeId ? <ItemBadge typeId={s.offeredTypeId} showQuantity={s.offeredQty || undefined} /> : "…"} for {s.wanting}{s.perUnit && <> ({s.perUnit} {cfSymbol}/item)</>}</>;
      }
      case "ItemForItem": {
        const s = p as { offeredTypeId: number; offeredQty: number; wantedTypeId: number; wantedQty: number };
        return <>{s.offeredTypeId ? <ItemBadge typeId={s.offeredTypeId} showQuantity={s.offeredQty || undefined} /> : "…"} for {s.wantedTypeId ? <ItemBadge typeId={s.wantedTypeId} showQuantity={s.wantedQty || undefined} /> : "…"}</>;
      }
      case "Transport": {
        const s = p as { offering: string; itemTypeId: number; itemQty: number };
        return <>Deliver {s.itemTypeId ? <ItemBadge typeId={s.itemTypeId} showQuantity={s.itemQty || undefined} /> : "…"} for {s.offering}</>;
      }
    }
  }

  return (
    <Page>
      <PageHeader>
        <BackButton onClick={() => navigate("/contracts")} disabled={isBusy}>← Back</BackButton>
        <PageTitle>Create Trustless Contract</PageTitle>
      </PageHeader>

      <FormColumn>
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
              <Label>Reward Amount ({ceSymbol})</Label>
              <Input type="number" placeholder="0.0" value={escrow} onChange={(e) => setEscrow(e.target.value)} />
              <Hint>This amount will be held in escrow until the contract is fulfilled or cancelled.</Hint>
              {submitted && !isValidCoinAmount(escrow) && <FieldError>Enter a valid amount</FieldError>}
            </div>
          )}

          {variant === "CoinForCoin" && (
            <div>
              <Label>Wanted Amount ({cfSymbol})</Label>
              <Input type="number" placeholder="0.0" value={wantedAmount} onChange={(e) => setWantedAmount(e.target.value)} />
              {submitted && !isValidCoinAmount(wantedAmount) && <FieldError>Enter a valid amount</FieldError>}
            </div>
          )}

          {unitPriceHint && (
            <>
              <Hint>{unitPriceHint.ratio}</Hint>
              <Hint>{unitPriceHint.detail}</Hint>
            </>
          )}
          {divisibilityError && <FieldError>{divisibilityError}</FieldError>}

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
              <SsuPickerField value={destinationSsuId} onChange={(id) => setDestinationSsuId(id)} allowManualEntry />
            </>
          )}

          {variant === "ItemForCoin" && (
            <>
              {/* Mode toggle */}
              <Row>
                <div>
                  <Label>Creation Mode</Label>
                  <Row>
                    <SecondaryButton
                      style={{ fontWeight: !bulkMode ? 700 : 400, opacity: !bulkMode ? 1 : 0.6 }}
                      onClick={() => { setBulkMode(false); setBulkBatches([]); }}
                      disabled={isBusy}
                    >
                      Single
                    </SecondaryButton>
                    <SecondaryButton
                      style={{ fontWeight: bulkMode ? 700 : 400, opacity: bulkMode ? 1 : 0.6 }}
                      onClick={() => { setBulkMode(true); setBulkBatches([]); }}
                      disabled={isBusy}
                    >
                      Bulk
                    </SecondaryButton>
                  </Row>
                </div>
              </Row>

              <Label>Source SSU</Label>
              <SsuPickerField value={sourceSsuId} onChange={(id, owned) => { setSourceSsuId(id); setSourceSsuOwned(owned); }} allowManualEntry />
              {submitted && !sourceSsuId && <FieldError>Required</FieldError>}

              {!bulkMode ? (
                /* ---- Single mode (existing) ---- */
                <>
                  <Row>
                    <div>
                      <Label>Item</Label>
                      <SsuItemPickerField
                        ssuId={sourceSsuId}
                        ownerCapId={getInventoryCapId(sourceSsuId, sourceSsuOwned)}
                        value={itemId}
                        ownerOnly
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
                  <Label>Wanted Amount ({cfSymbol})</Label>
                  <Input type="number" placeholder="0.0" value={itemWantedAmount} onChange={(e) => setItemWantedAmount(e.target.value)} />
                  {submitted && !isValidCoinAmount(itemWantedAmount) && <FieldError>Enter a valid amount</FieldError>}
                  {itemWantedAmount === "0" && <Hint>Items will be offered for free &mdash; fillers can claim without paying.</Hint>}
                  {Number(offeredQuantity) > 0 && Number(itemWantedAmount) > 0 && (
                    <Hint>
                      Price per item: {(Number(itemWantedAmount) / Number(offeredQuantity)).toFixed(4)} {cfSymbol}
                      &nbsp;·&nbsp; Total for {Number(offeredQuantity).toLocaleString()} items: {itemWantedAmount} {cfSymbol}
                    </Hint>
                  )}
                </>
              ) : (
                /* ---- Bulk mode ---- */
                <>
                  <Hint>
                    Select multiple items to create one contract per item. Shared options (deadline,
                    partial fill, access) apply to all contracts.
                  </Hint>
                  <SecondaryButton
                    disabled={!sourceSsuId || !getInventoryCapId(sourceSsuId, sourceSsuOwned) || isBusy}
                    onClick={() => setBulkPickerOpen(true)}
                    style={{ marginBottom: 12 }}
                  >
                    + Add Items ({bulkRows.length} selected)
                  </SecondaryButton>

                  {bulkPickerOpen && (
                    <SsuMultiItemPickerModal
                      ssuId={sourceSsuId}
                      ownerCapId={getInventoryCapId(sourceSsuId, sourceSsuOwned)}
                      alreadySelected={new Set(bulkRows.map((r) => r.typeId))}
                      onConfirm={(entries) => {
                        setBulkRows((prev) => {
                          const existing = new Map(prev.map((r) => [r.typeId, r]));
                          return entries.map((e) => {
                            const info = getItem(e.typeId);
                            const prev = existing.get(e.typeId);
                            return prev ?? {
                              typeId: e.typeId,
                              itemName: info?.name ?? `Type ${e.typeId}`,
                              quantity: e.quantity,
                              availableQuantity: e.quantity,
                              priceMode: "unit" as const,
                              priceInput: "",
                            };
                          });
                        });
                      }}
                      onClose={() => setBulkPickerOpen(false)}
                    />
                  )}

                  <BulkItemEditor
                    rows={bulkRows}
                    onChange={setBulkRows}
                    allowPartial={allowPartial}
                    decimals={cfDecimals}
                    symbol={cfSymbol}
                    submitted={submitted}
                  />

                  {submitted && bulkRows.length === 0 && (
                    <FieldError>Select at least one item</FieldError>
                  )}
                </>
              )}
            </>
          )}

          {variant === "ItemForItem" && (
            <>
              <Label>Source SSU</Label>
              <SsuPickerField value={sourceSsuId} onChange={(id, owned) => { setSourceSsuId(id); setSourceSsuOwned(owned); }} allowManualEntry />
              {submitted && !sourceSsuId && <FieldError>Required</FieldError>}
              <Row>
                <div>
                  <Label>Offered Item</Label>
                  <SsuItemPickerField
                    ssuId={sourceSsuId}
                    ownerCapId={getInventoryCapId(sourceSsuId, sourceSsuOwned)}
                    value={itemId}
                    ownerOnly
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
              <SsuPickerField value={i4iDestinationSsuId} onChange={(id) => setI4iDestinationSsuId(id)} allowManualEntry />
              {submitted && !i4iDestinationSsuId && <FieldError>Required</FieldError>}
            </>
          )}

          {variant === "Transport" && (
            <>
              <Label>Source SSU (pickup)</Label>
              <SsuPickerField value={transportSourceSsuId} onChange={(id, owned) => { setTransportSourceSsuId(id); setTransportSourceSsuOwned(owned); }} allowManualEntry />
              {submitted && !transportSourceSsuId && <FieldError>Required</FieldError>}
              <Row>
                <div>
                  <Label>Item</Label>
                  <SsuItemPickerField
                    ssuId={transportSourceSsuId}
                    ownerCapId={getInventoryCapId(transportSourceSsuId, transportSourceSsuOwned)}
                    value={transportItemTypeId}
                    ownerOnly
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
              <SsuPickerField value={destinationSsuId} onChange={(id) => setDestinationSsuId(id)} allowManualEntry />
              {submitted && !destinationSsuId && <FieldError>Required</FieldError>}
              <Label>Required Stake ({ceSymbol})</Label>
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

        {bulkBatches.length > 0 && (
          <BatchProgressPanel batches={bulkBatches} totalContracts={bulkRows.length} />
        )}

        <ButtonRow>
          <SecondaryButton onClick={() => navigate("/contracts")} disabled={isBusy}>
            Cancel
          </SecondaryButton>
          {variant === "ItemForCoin" && bulkMode ? (
            <SubmitButton
              onClick={handleBulkCreate}
              disabled={isBusy || isEnabling || ssusNeedingExtension.length > 0}
            >
              {bulkBusy
                ? "Creating…"
                : `Create ${bulkRows.length} Contract${bulkRows.length !== 1 ? "s" : ""} (${chunkPayloads(rowsToPayloads(bulkRows, cfDecimals)).length} tx)`}
            </SubmitButton>
          ) : (
            <SubmitButton onClick={handleCreate} disabled={isBusy || isEnabling || ssusNeedingExtension.length > 0}>
              {creationPhase ? PHASE_LABELS[creationPhase] + "…" : "Create Contract"}
            </SubmitButton>
          )}
        </ButtonRow>
      </FormCard>
      </FormColumn>

      <SidebarColumn>
        {/* Live Preview */}
        <SidebarPanel>
          <SidebarTitle>Preview</SidebarTitle>
          <div>
            <PreviewTypeTag>{contractTypeLabel(variant)}</PreviewTypeTag>
            {isRestricted && <PreviewRestrictedTag>Restricted</PreviewRestrictedTag>}
          </div>
          <PreviewSummary>{renderPreviewSummary()}</PreviewSummary>
          <PreviewMeta>
            {(variant === "CoinForCoin" || variant === "CoinForItem" || variant === "Transport") && Number(escrow) > 0 && (
              <PreviewAmount>
                {formatAmount(String(toBaseUnits(escrow, ceDecimals)), ceDecimals)} {ceSymbol} reward
              </PreviewAmount>
            )}
            <span>{Number(deadlineHours) > 0 ? `${deadlineHours}h deadline` : "No deadline"}</span>
            {allowPartial && <span>Partial OK</span>}
          </PreviewMeta>
        </SidebarPanel>

        {/* Contract Type Info */}
        <SidebarPanel>
          <SidebarTitle>About This Type</SidebarTitle>
          <DescriptionText>{VARIANT_DESCRIPTIONS[variant]}</DescriptionText>
        </SidebarPanel>

        {/* Validation Checklist */}
        <SidebarPanel>
          <SidebarTitle>Checklist</SidebarTitle>
          <ChecklistList>
            {checklist.map((item) => (
              <ChecklistItem key={item.label} $done={item.done}>
                {item.label}
              </ChecklistItem>
            ))}
          </ChecklistList>
        </SidebarPanel>
      </SidebarColumn>
    </Page>
  );
}
