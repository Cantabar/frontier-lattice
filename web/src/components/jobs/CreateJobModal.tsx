import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { buildCreateJob } from "../../lib/sui";
import { useIdentity } from "../../hooks/useIdentity";
import { useNotifications } from "../../hooks/useNotifications";
import { config } from "../../config";
import type { TribeCapData } from "../../lib/types";
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

const Textarea = styled.textarea`
  width: 100%;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;
  font-family: inherit;
  margin-bottom: ${({ theme }) => theme.spacing.md};
  resize: vertical;
  min-height: 80px;

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

type CompletionVariant = "Delivery" | "Bounty" | "Transport" | "Custom";

interface Props {
  tribeId: string;
  cap: TribeCapData;
  onClose: () => void;
}

export function CreateJobModal({ tribeId, cap, onClose }: Props) {
  const { characterId } = useIdentity();
  const { push } = useNotifications();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [description, setDescription] = useState("");
  const [escrow, setEscrow] = useState("");
  const [deadlineHours, setDeadlineHours] = useState("48");
  const [minRep, setMinRep] = useState("0");
  const [variant, setVariant] = useState<CompletionVariant>("Custom");

  // Variant-specific fields
  const [storageUnitId, setStorageUnitId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [targetCharId, setTargetCharId] = useState("");
  const [gateId, setGateId] = useState("");
  const [commitHash, setCommitHash] = useState("");

  function buildCompletionType() {
    const pkg = config.packages.contractBoard;
    switch (variant) {
      case "Delivery":
        return {
          target: `${pkg}::contract_board::completion_delivery`,
          args: [storageUnitId, Number(typeId), Number(quantity)],
        };
      case "Bounty":
        return {
          target: `${pkg}::contract_board::completion_bounty`,
          args: [targetCharId],
        };
      case "Transport":
        return {
          target: `${pkg}::contract_board::completion_transport`,
          args: [gateId],
        };
      case "Custom": {
        const bytes = commitHash
          ? Array.from(new TextEncoder().encode(commitHash))
          : Array(32).fill(0);
        return {
          target: `${pkg}::contract_board::completion_custom`,
          args: [bytes],
        };
      }
    }
  }

  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!characterId || !description || !escrow) return;
    setError(null);
    const tx = buildCreateJob({
      tribeId,
      capId: cap.id,
      characterId,
      description,
      completionType: buildCompletionType(),
      escrowAmount: Math.round(Number(escrow) * 1e9),
      deadlineMs: Date.now() + Number(deadlineHours) * 3600 * 1000,
      minReputation: Number(minRep),
    });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await signAndExecute({ transaction: tx as any });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setError(msg);
      push({
        level: "error",
        title: "Post Job Failed",
        message: msg,
        source: "CreateJobModal",
      });
    }
  }

  return (
    <Modal title="Post Job" onClose={onClose}>
      <Label>Description</Label>
      <Textarea
        placeholder="Describe the contract…"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        autoFocus
      />

      <Label>Completion Type</Label>
      <Select value={variant} onChange={(e) => setVariant(e.target.value as CompletionVariant)}>
        <option value="Delivery">Delivery</option>
        <option value="Bounty">Bounty</option>
        <option value="Transport">Transport</option>
        <option value="Custom">Custom</option>
      </Select>

      {variant === "Delivery" && (
        <>
          <Input placeholder="Storage Unit ID" value={storageUnitId} onChange={(e) => setStorageUnitId(e.target.value)} />
          <Row>
            <div>
              <Label>Type ID</Label>
              <ItemPickerField value={typeId} onChange={setTypeId} />
            </div>
            <div>
              <Label>Quantity</Label>
              <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          </Row>
        </>
      )}
      {variant === "Bounty" && (
        <Input placeholder="Target Character ID" value={targetCharId} onChange={(e) => setTargetCharId(e.target.value)} />
      )}
      {variant === "Transport" && (
        <Input placeholder="Gate ID" value={gateId} onChange={(e) => setGateId(e.target.value)} />
      )}
      {variant === "Custom" && (
        <Input placeholder="Commitment hash (optional)" value={commitHash} onChange={(e) => setCommitHash(e.target.value)} />
      )}

      <Row>
        <div>
          <Label>Escrow (SUI)</Label>
          <Input type="number" value={escrow} onChange={(e) => setEscrow(e.target.value)} />
        </div>
        <div>
          <Label>Deadline (hours)</Label>
          <Input type="number" value={deadlineHours} onChange={(e) => setDeadlineHours(e.target.value)} />
        </div>
      </Row>

      <Label>Min Reputation</Label>
      <Input type="number" value={minRep} onChange={(e) => setMinRep(e.target.value)} />

      {error && (
        <div style={{
          background: "rgba(255,82,82,0.13)",
          border: "1px solid #FF5252",
          borderRadius: 4,
          padding: "8px 16px",
          color: "#FF5252",
          fontSize: 13,
          marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      <Button onClick={handleCreate} disabled={!description || !escrow || !characterId || isPending}>
        {isPending ? "Posting…" : "Post Job"}
      </Button>
    </Modal>
  );
}
