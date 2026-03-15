import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { buildAddMember } from "../../lib/sui";
import { PrimaryButton } from "../shared/Button";
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

const SubmitButton = styled(PrimaryButton)`
  font-size: 14px;
`;

interface Props {
  tribeId: string;
  cap: TribeCapData;
  onClose: () => void;
}

export function AddMemberModal({ tribeId, cap, onClose }: Props) {
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [characterId, setCharacterId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [role, setRole] = useState<Role>("Member");

  async function handleAdd() {
    if (!characterId || !walletAddress) return;
    const tx = buildAddMember({
      tribeId,
      capId: cap.id,
      newMemberCharacterId: characterId,
      role,
      newMemberAddress: walletAddress,
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

      <Label>Member Wallet Address</Label>
      <Input
        placeholder="0x..."
        value={walletAddress}
        onChange={(e) => setWalletAddress(e.target.value)}
      />

      <Label>Role</Label>
      <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="Member">Member</option>
        <option value="Officer">Officer</option>
      </Select>

      <SubmitButton $fullWidth onClick={handleAdd} disabled={!characterId || !walletAddress || isPending}>
        {isPending ? "Adding…" : "Add Member"}
      </SubmitButton>
    </Modal>
  );
}
