import { useState } from "react";
import { useNavigate } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "../shared/Modal";
import { buildCreateTribe } from "../../lib/sui";
import { useIdentity } from "../../hooks/useIdentity";
import { useNotifications } from "../../hooks/useNotifications";
import { config } from "../../config";
import type { TribeListItem } from "../../lib/types";

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

const SecondaryButton = styled(Button)`
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  margin-top: ${({ theme }) => theme.spacing.sm};

  &:hover {
    background: ${({ theme }) => theme.colors.surface.raised};
  }
`;

const fadeIn = keyframes`
  from { opacity: 0; transform: scale(0.9); }
  to   { opacity: 1; transform: scale(1); }
`;

const SuccessWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.lg} 0;
  animation: ${fadeIn} 0.3s ease;
`;

const SuccessIcon = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.success}20;
  border: 2px solid ${({ theme }) => theme.colors.success};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: ${({ theme }) => theme.colors.success};
`;

const SuccessTitle = styled.div`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const SuccessDetail = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-align: center;
`;

interface Props {
  onClose: () => void;
  onCreated?: (tribe: TribeListItem) => void;
}

export function CreateTribeModal({ onClose, onCreated }: Props) {
  const navigate = useNavigate();
  const { characterId, inGameTribeId, address } = useIdentity();
  const { push } = useNotifications();
  const queryClient = useQueryClient();
  const hasTribe = inGameTribeId != null && inGameTribeId > 0;
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState("50");
  const [error, setError] = useState<string | null>(null);
  const [createdTribeId, setCreatedTribeId] = useState<string | null>(null);

  const misconfigured =
    config.tribeRegistryId === "0x0" || config.packages.tribe === "0x0";

  async function handleCreate() {
    if (!characterId || !name) return;
    if (misconfigured) {
      const msg =
        "Tribe contracts are not configured. Publish the Move packages and set VITE_TRIBE_PACKAGE_ID / VITE_TRIBE_REGISTRY_ID in your .env file.";
      setError(msg);
      push({ level: "error", title: "Create Tribe Failed", message: msg, source: "CreateTribeModal" });
      return;
    }
    setError(null);
    const tx = buildCreateTribe({
      registryId: config.tribeRegistryId,
      characterId,
      name,
      voteThreshold: Number(threshold),
      sender: address,
    });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
      const result = await signAndExecute(
        { transaction: tx as any },
        { onSuccess: () => {} },
      );

      // Parse the created Tribe object ID from the transaction response
      let tribeObjectId: string | null = null;
      const changes = (result as { objectChanges?: { type: string; objectType?: string; objectId?: string }[] }).objectChanges;
      if (changes) {
        const tribeObj = changes.find(
          (c) => c.type === "created" && c.objectType?.includes("::tribe::Tribe<"),
        );
        if (tribeObj?.objectId) tribeObjectId = tribeObj.objectId;
      }

      setCreatedTribeId(tribeObjectId);

      // Notify parent for optimistic list update
      if (onCreated) {
        onCreated({
          id: tribeObjectId ?? "pending",
          name,
          inGameTribeId: inGameTribeId ?? 0,
          leaderCharacterId: characterId,
        });
      }

      // Invalidate caches so tribe list and identity refresh
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tribes"] }),
        queryClient.invalidateQueries({ queryKey: ["sui.getOwnedObjects"] }),
      ]);

      push({
        level: "info",
        title: "Tribe Created",
        message: `${name} has been created on-chain.`,
        source: "CreateTribeModal",
      });
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

  // -- Success view --
  if (createdTribeId !== null) {
    return (
      <Modal title="Tribe Created" onClose={onClose}>
        <SuccessWrapper>
          <SuccessIcon>&#10003;</SuccessIcon>
          <SuccessTitle>{name}</SuccessTitle>
          <SuccessDetail>
            Your tribe has been created on-chain.
            {createdTribeId !== "pending" && " You can now view and manage it."}
          </SuccessDetail>
          {createdTribeId !== "pending" && (
            <Button
              onClick={() => {
                onClose();
                navigate(`/tribe/${createdTribeId}`);
              }}
            >
              View Tribe
            </Button>
          )}
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </SuccessWrapper>
      </Modal>
    );
  }

  // -- Form view --
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

      <Button onClick={handleCreate} disabled={!name || !characterId || !hasTribe || isPending || misconfigured}>
        {isPending ? "Creating…" : misconfigured ? "Tribe contracts not configured" : "Create Tribe"}
      </Button>
    </Modal>
  );
}
