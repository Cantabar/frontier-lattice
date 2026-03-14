import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { buildIssueRepUpdateCap } from "../../lib/sui";

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

const InfoText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.muted};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px dashed ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  line-height: 1.5;
`;

interface Props {
  tribeId: string;
  capId: string;
  onClose: () => void;
}

export function IssueRepCapModal({ tribeId, capId, onClose }: Props) {
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [recipientAddress, setRecipientAddress] = useState("");

  async function handleIssue() {
    if (!recipientAddress) return;
    const tx = buildIssueRepUpdateCap({
      tribeId,
      capId,
      recipientAddress,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
    await signAndExecute({ transaction: tx as any });
    onClose();
  }

  return (
    <Modal title="Issue Reputation Update Cap" onClose={onClose}>
      <InfoText>
        A <strong>RepUpdateCap</strong> authorises an external address or contract to update
        member reputation scores in this tribe without requiring a TribeCap. This is used for
        automated reputation updates (e.g. by the Contract Board on job completion).
      </InfoText>

      <Label>Recipient Address</Label>
      <Input
        placeholder="0x... (hot wallet or contract address)"
        value={recipientAddress}
        onChange={(e) => setRecipientAddress(e.target.value)}
        autoFocus
      />

      <Button onClick={handleIssue} disabled={!recipientAddress || isPending}>
        {isPending ? "Issuing…" : "Issue RepUpdateCap"}
      </Button>
    </Modal>
  );
}
