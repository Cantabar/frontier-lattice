import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { buildTransferLeadership } from "../../lib/sui";
import { useIdentity } from "../../hooks/useIdentity";
import { truncateAddress } from "../../lib/format";
import { DangerButton } from "../shared/Button";
import type { TribeMember } from "../../lib/types";

const Label = styled.label`
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
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

const SubmitButton = styled(DangerButton)`
  font-size: 14px;
`;

const Warning = styled.div`
  font-size: 13px;
  color: #e53935;
  background: rgba(229, 57, 53, 0.1);
  border: 1px solid rgba(229, 57, 53, 0.3);
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  line-height: 1.5;
`;

interface Props {
  tribeId: string;
  capId: string;
  members: TribeMember[];
  leaderCharacterId: string;
  /** Pre-selected character ID when triggered from the member list. */
  preselectedCharacterId?: string;
  onClose: () => void;
}

export function TransferLeadershipModal({
  tribeId,
  capId,
  members,
  leaderCharacterId,
  preselectedCharacterId,
  onClose,
}: Props) {
  const { address } = useIdentity();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const candidates = members.filter((m) => m.characterId !== leaderCharacterId);
  const [selectedCharId, setSelectedCharId] = useState(
    preselectedCharacterId ?? candidates[0]?.characterId ?? "",
  );
  const [walletAddress, setWalletAddress] = useState("");

  async function handleTransfer() {
    if (!selectedCharId || !walletAddress || !address) return;
    const tx = buildTransferLeadership({
      tribeId,
      capId,
      newLeaderCharacterId: selectedCharId,
      newLeaderWalletAddress: walletAddress,
      callerAddress: address,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
    await signAndExecute({ transaction: tx as any });
    onClose();
  }

  return (
    <Modal title="Transfer Leadership" onClose={onClose}>
      <Warning>
        This action is irreversible. You will become an Officer and the selected member
        will become the new Leader. Both parties will receive new TribeCaps and your
        current cap will be invalidated.
      </Warning>

      <Label>New Leader</Label>
      <Select value={selectedCharId} onChange={(e) => setSelectedCharId(e.target.value)}>
        {candidates.map((m) => (
          <option key={m.characterId} value={m.characterId}>
            {truncateAddress(m.characterId)} ({m.role})
          </option>
        ))}
      </Select>

      <Label>New Leader&apos;s Wallet Address</Label>
      <Input
        placeholder="0x..."
        value={walletAddress}
        onChange={(e) => setWalletAddress(e.target.value)}
        autoFocus
      />

      <SubmitButton $fullWidth onClick={handleTransfer} disabled={!selectedCharId || !walletAddress || isPending}>
        {isPending ? "Transferring…" : "Transfer Leadership"}
      </SubmitButton>
    </Modal>
  );
}
