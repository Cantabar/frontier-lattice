import { useState, useMemo } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "../shared/Modal";
import { ItemPickerField } from "../shared/ItemPickerField";
import { SsuPickerField } from "./SsuPickerField";
import { ItemBadge } from "../shared/ItemBadge";
import { PrimaryButton } from "../shared/Button";
import { useIdentity } from "../../hooks/useIdentity";
import { useBlueprints } from "../../hooks/useBlueprints";
import { useMyStructures } from "../../hooks/useStructures";
import { useNotifications } from "../../hooks/useNotifications";
import { buildCreateMultiInputContract } from "../../lib/sui";
import { toBaseUnits } from "../../lib/coinUtils";
import { useEscrowCoinDecimals } from "../../hooks/useCoinDecimals";
import { buildRecipeMap, expandToBomDepth, slotsToArrays, depthLabel } from "../../lib/bom";

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

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const FieldGroup = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const DepthRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  flex-wrap: wrap;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const DepthBtn = styled.button<{ $active: boolean }>`
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  border: 1px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.primary.main : theme.colors.surface.border};
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary.subtle : theme.colors.surface.bg};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.muted};
  }
`;

const PreviewBox = styled.div`
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  max-height: 160px;
  overflow-y: auto;
`;

const PreviewRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 0;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const PreviewLabel = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const EmptyPreview = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-align: center;
  padding: ${({ theme }) => theme.spacing.sm};
`;

const ErrorBanner = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.danger};
  background: ${({ theme }) => theme.colors.danger}11;
  border: 1px solid ${({ theme }) => theme.colors.danger}44;
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  word-break: break-word;
`;

const ValidationHint = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-align: center;
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const BOM_DEPTHS = [0, 1, 2, Infinity];

interface Props {
  onClose: () => void;
}

export function CreateMultiInputContractModal({ onClose }: Props) {
  const { characterId } = useIdentity();
  const { recipesForOptimizer } = useBlueprints();
  const { structures } = useMyStructures();
  const { push } = useNotifications();
  const queryClient = useQueryClient();
  const { decimals, symbol: coinSymbol } = useEscrowCoinDecimals();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const ssus = useMemo(
    () => structures.filter((s) => s.moveType === "StorageUnit"),
    [structures],
  );

  const recipeMap = useMemo(
    () => buildRecipeMap(recipesForOptimizer),
    [recipesForOptimizer],
  );

  const [description, setDescription] = useState("");
  const [targetTypeId, setTargetTypeId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [depth, setDepth] = useState<number>(1);
  const [destinationSsuId, setDestinationSsuId] = useState<string | null>(null);
  const [bounty, setBounty] = useState("");
  const [deadlineHours, setDeadlineHours] = useState("24");
  const [error, setError] = useState<string | null>(null);

  const slots = useMemo(() => {
    const tid = Number(targetTypeId);
    const qty = Number(quantity);
    if (!tid || qty <= 0) return new Map<number, number>();
    return expandToBomDepth(recipeMap, tid, qty, depth);
  }, [recipeMap, targetTypeId, quantity, depth]);

  const { typeIds, quantities } = useMemo(() => slotsToArrays(slots), [slots]);

  const canSubmit =
    !!characterId &&
    !!destinationSsuId &&
    !!bounty &&
    Number(bounty) > 0 &&
    !!description.trim() &&
    typeIds.length > 0 &&
    !isPending;

  /** Derive a human-readable hint for the first missing required field. */
  const validationHint = !characterId
    ? "Connect your wallet to create an order"
    : !description.trim()
      ? "Enter a description"
      : typeIds.length === 0
        ? "Pick a target item"
        : !destinationSsuId
          ? "Select a destination SSU"
          : !bounty || Number(bounty) <= 0
            ? "Enter a bounty amount"
            : null;

  async function handleCreate() {
    if (!canSubmit || !characterId || !destinationSsuId) return;
    setError(null);
    const deadlineMs = Date.now() + Number(deadlineHours) * 60 * 60 * 1000;
    const tx = buildCreateMultiInputContract({
      characterId,
      bountyAmount: toBaseUnits(bounty, decimals),
      description: description.trim(),
      destinationSsuId,
      typeIds,
      quantities,
      deadlineMs,
      allowedCharacters: [],
      allowedTribes: [],
    });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await signAndExecute({ transaction: tx as any });

      // Invalidate contract list so Active Orders refreshes
      await queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[1] === "queryEvents",
      });

      push({
        level: "info",
        title: "Order Created",
        message: `Manufacturing order "${description.trim()}" has been posted on-chain.`,
        source: "CreateMultiInputContractModal",
      });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setError(msg);
      push({
        level: "error",
        title: "Create Order Failed",
        message: msg,
        source: "CreateMultiInputContractModal",
      });
    }
  }

  return (
    <Modal title="New Manufacturing Order" onClose={onClose} disableClose={isPending}>
      <FieldGroup>
        <Label>Description</Label>
        <Input
          placeholder="What needs to be manufactured?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          autoFocus
        />
      </FieldGroup>

      <Row>
        <div>
          <Label>Target Item</Label>
          <ItemPickerField value={targetTypeId} onChange={setTargetTypeId} />
        </div>
        <div>
          <Label>Quantity</Label>
          <Input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
      </Row>

      <FieldGroup>
        <Label>BOM Depth</Label>
        <DepthRow>
          {BOM_DEPTHS.map((d) => (
            <DepthBtn key={String(d)} $active={depth === d} onClick={() => setDepth(d)}>
              {depthLabel(d)}
            </DepthBtn>
          ))}
        </DepthRow>
      </FieldGroup>

      <FieldGroup>
        <Label>Destination SSU (where items are delivered)</Label>
        <SsuPickerField ssus={ssus} value={destinationSsuId} onSelect={setDestinationSsuId} />
      </FieldGroup>

      <Row>
        <div>
          <Label>Bounty ({coinSymbol})</Label>
          <Input
            type="number"
            min={0}
            step={0.1}
            placeholder="0.0"
            value={bounty}
            onChange={(e) => setBounty(e.target.value)}
          />
        </div>
        <div>
          <Label>Deadline (hours)</Label>
          <Input
            type="number"
            min={1}
            value={deadlineHours}
            onChange={(e) => setDeadlineHours(e.target.value)}
          />
        </div>
      </Row>

      {/* Slot preview */}
      <FieldGroup>
        <PreviewLabel>
          Required Material Slots
          {typeIds.length > 0 && ` (${typeIds.length})`}
        </PreviewLabel>
        <PreviewBox>
          {typeIds.length === 0 ? (
            <EmptyPreview>
              {targetTypeId
                ? "No recipe found — item will be used as-is (depth 0)"
                : "Pick a target item to see required materials"}
            </EmptyPreview>
          ) : (
            typeIds.map((tid, i) => (
              <PreviewRow key={tid}>
                <ItemBadge typeId={tid} />
                <span>{quantities[i].toLocaleString()} units</span>
              </PreviewRow>
            ))
          )}
        </PreviewBox>
      </FieldGroup>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <PrimaryButton $fullWidth onClick={handleCreate} disabled={!canSubmit}>
        {isPending ? "Creating…" : "Create Order"}
      </PrimaryButton>

      {!canSubmit && !isPending && validationHint && (
        <ValidationHint>{validationHint}</ValidationHint>
      )}
    </Modal>
  );
}
