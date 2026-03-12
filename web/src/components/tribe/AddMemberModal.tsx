import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { buildAddMember } from "../../lib/sui";
import type { Role, TribeCapData } from "../../lib/types";

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
  tribeId: string;
  cap: TribeCapData;
  onClose: () => void;
}

export function AddMemberModal({ tribeId, cap, onClose }: Props) {
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [characterId, setCharacterId] = useState("");
  const [role, setRole] = useState<Role>("Member");

  async function handleAdd() {
    if (!characterId) return;
    const tx = buildAddMember({
      tribeId,
      capId: cap.id,
      newMemberCharacterId: characterId,
      role,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
    await signAndExecute({ transaction: tx as any });
    onClose();
  }

  return (
    <Modal title="Add Member" onClose={onClose}>
      <Label>Character Object ID</Label>
      <Input
        placeholder="0x..."
        value={characterId}
        onChange={(e) => setCharacterId(e.target.value)}
        autoFocus
      />

      <Label>Role</Label>
      <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="Member">Member</option>
        <option value="Officer">Officer</option>
        <option value="Leader">Leader</option>
      </Select>

      <Button onClick={handleAdd} disabled={!characterId || isPending}>
        {isPending ? "Adding…" : "Add Member"}
      </Button>
    </Modal>
  );
}
