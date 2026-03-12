import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { buildCreateTribe } from "../../lib/sui";
import { useIdentity } from "../../hooks/useIdentity";

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

const HelpText = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: -12px;
  margin-bottom: ${({ theme }) => theme.spacing.md};
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

interface Props {
  onClose: () => void;
}

export function CreateTribeModal({ onClose }: Props) {
  const { characterId } = useIdentity();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState("50");

  async function handleCreate() {
    if (!characterId || !name) return;
    const tx = buildCreateTribe({
      characterId,
      name,
      voteThreshold: Number(threshold),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
    await signAndExecute({ transaction: tx as any });
    onClose();
  }

  return (
    <Modal title="Create Tribe" onClose={onClose}>
      <Label>Tribe Name</Label>
      <Input
        placeholder="e.g. Frontier Syndicate"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />

      <Label>Vote Threshold (%)</Label>
      <Input
        type="number"
        min={1}
        max={100}
        value={threshold}
        onChange={(e) => setThreshold(e.target.value)}
      />
      <HelpText>Percentage of members needed to pass a treasury proposal</HelpText>

      <Button onClick={handleCreate} disabled={!name || !characterId || isPending}>
        {isPending ? "Creating…" : "Create Tribe"}
      </Button>
    </Modal>
  );
}
