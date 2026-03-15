import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { buildCreateOrder } from "../../lib/sui";
import { useIdentity } from "../../hooks/useIdentity";
import type { TribeCapData } from "../../lib/types";
import { ItemPickerField } from "../shared/ItemPickerField";
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

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.md};
`;

const SubmitButton = styled(PrimaryButton)`
  font-size: 14px;
`;

interface Props {
  tribeId: string;
  registryId: string;
  cap: TribeCapData;
  onClose: () => void;
}

export function CreateOrderModal({ tribeId, registryId, cap, onClose }: Props) {
  const { characterId } = useIdentity();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [description, setDescription] = useState("");
  const [outputTypeId, setOutputTypeId] = useState("");
  const [runCount, setRunCount] = useState("1");
  const [bounty, setBounty] = useState("");

  async function handleCreate() {
    if (!characterId || !outputTypeId || !bounty) return;
    const tx = buildCreateOrder({
      registryId,
      tribeId,
      capId: cap.id,
      characterId,
      description,
      outputTypeId: Number(outputTypeId),
      runCount: Number(runCount),
      bountyAmount: Math.round(Number(bounty) * 1e9),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
    onClose();
  }

  return (
    <Modal title="Create Manufacturing Order" onClose={onClose}>
      <Label>Description</Label>
      <Input
        placeholder="What needs to be built?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        autoFocus
      />

      <Row>
        <div>
          <Label>Output Type ID</Label>
          <ItemPickerField value={outputTypeId} onChange={setOutputTypeId} />
        </div>
        <div>
          <Label>Run Count</Label>
          <Input
            type="number"
            min={1}
            value={runCount}
            onChange={(e) => setRunCount(e.target.value)}
          />
        </div>
      </Row>

      <Label>Bounty (SUI)</Label>
      <Input
        type="number"
        placeholder="Reward for fulfilling this order"
        value={bounty}
        onChange={(e) => setBounty(e.target.value)}
      />

      <SubmitButton $fullWidth onClick={handleCreate} disabled={!outputTypeId || !bounty || !characterId || isPending}>
        {isPending ? "Creating…" : "Create Order"}
      </SubmitButton>
    </Modal>
  );
}
