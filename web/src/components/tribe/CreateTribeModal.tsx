import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { buildCreateTribe } from "../../lib/sui";
import { useIdentity } from "../../hooks/useIdentity";
import { useNotifications } from "../../hooks/useNotifications";
import { config } from "../../config";

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

const InfoRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const InfoLabel = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.04em;
`;

const Warning = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.muted};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px dashed ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
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
  const { characterId, inGameTribeId } = useIdentity();
  const { push } = useNotifications();
  const hasTribe = inGameTribeId != null && inGameTribeId > 0;
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState("50");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!characterId || !name) return;
    setError(null);
    const tx = buildCreateTribe({
      registryId: config.tribeRegistryId,
      characterId,
      name,
      voteThreshold: Number(threshold),
    });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
      await signAndExecute({ transaction: tx as any });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setError(msg);
      push({
        level: "error",
        title: "Create Tribe Failed",
        message: msg,
        source: "CreateTribeModal",
      });
    }
  }

  return (
    <Modal title="Create Tribe" onClose={onClose}>
      {hasTribe ? (
        <InfoRow>
          <InfoLabel>In-Game Tribe ID</InfoLabel>
          #{inGameTribeId}
        </InfoRow>
      ) : (
        <Warning>
          Your Character has no in-game tribe assignment. You must belong to a tribe in-game before
          creating one on-chain.
        </Warning>
      )}

      <Label>Tribe Name</Label>
      <Input
        placeholder="e.g. Frontier Syndicate"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        disabled={!hasTribe}
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

      <Button onClick={handleCreate} disabled={!name || !characterId || !hasTribe || isPending}>
        {isPending ? "Creating…" : "Create Tribe"}
      </Button>
    </Modal>
  );
}
