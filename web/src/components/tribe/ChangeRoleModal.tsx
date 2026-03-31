import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { buildChangeRole } from "../../lib/sui";
import { CopyableId } from "../shared/CopyableId";
import { CustomSelect } from "../shared/CustomSelect";
import { PrimaryButton } from "../shared/Button";
import type { Role } from "../../lib/types";

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

const SelectWrapper = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const SubmitButton = styled(PrimaryButton)`
  font-size: 14px;
`;

const CharacterLabel = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Warning = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px dashed ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ALL_ROLES: Role[] = ["Officer", "Member"];

interface Props {
  tribeId: string;
  capId: string;
  characterId: string;
  currentRole: Role;
  onClose: () => void;
}

export function ChangeRoleModal({ tribeId, capId, characterId, currentRole, onClose }: Props) {
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const availableRoles = ALL_ROLES.filter((r) => r !== currentRole);
  const [newRole, setNewRole] = useState<Role>(availableRoles[0]);
  const [walletAddress, setWalletAddress] = useState("");

  async function handleChangeRole() {
    if (!walletAddress || !newRole) return;
    const tx = buildChangeRole({
      tribeId,
      capId,
      characterId,
      newRole,
      memberWalletAddress: walletAddress,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
    await signAndExecute({ transaction: tx as any });
    onClose();
  }

  return (
    <Modal title="Change Member Role" onClose={onClose}>
      <CharacterLabel>
        Character: <CopyableId id={characterId} asCode /> · Current role: {currentRole}
      </CharacterLabel>

      <Warning>
        This removes the member and re-adds them with the new role in a single transaction.
        Their old TribeCap will be invalidated and a new one sent to the wallet address below.
      </Warning>

      <Label>New Role</Label>
      <SelectWrapper>
        <CustomSelect
          value={newRole}
          onChange={(v) => setNewRole(v as Role)}
          options={availableRoles.map((r) => ({ value: r, label: r }))}
        />
      </SelectWrapper>

      <Label>Member Wallet Address</Label>
      <Input
        placeholder="0x..."
        value={walletAddress}
        onChange={(e) => setWalletAddress(e.target.value)}
        autoFocus
      />

      <SubmitButton $fullWidth onClick={handleChangeRole} disabled={!walletAddress || isPending}>
        {isPending ? "Changing…" : `Change to ${newRole}`}
      </SubmitButton>
    </Modal>
  );
}
