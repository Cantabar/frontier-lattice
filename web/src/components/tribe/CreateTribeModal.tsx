import { useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "../shared/Modal";
import { CoinTypeSelector } from "../shared/CoinTypeSelector";
import { buildCreateTribe } from "../../lib/sui";
import { useIdentity } from "../../hooks/useIdentity";
import { useNotifications } from "../../hooks/useNotifications";
import { config } from "../../config";
import { PrimaryButton } from "../shared/Button";
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

const SubmitButton = styled(PrimaryButton)`
  font-size: 14px;
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
  const client = useSuiClient();
  const hasTribe = inGameTribeId != null && inGameTribeId > 0;
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction({
    execute: async ({ bytes, signature }) => {
      return await client.executeTransactionBlock({
        transactionBlock: bytes,
        signature,
        options: {
          showRawEffects: true,
          showObjectChanges: true,
        },
      });
    },
  });

  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState("50");
  const [selectedCoinType, setSelectedCoinType] = useState(config.coinType);
  const [error, setError] = useState<string | null>(null);

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
      coinType: selectedCoinType,
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

      // Notify parent for optimistic list update
      if (onCreated) {
        onCreated({
          id: tribeObjectId ?? "pending",
          name,
          inGameTribeId: inGameTribeId ?? 0,
          leaderCharacterId: characterId,
          coinType: selectedCoinType,
        });
      }

      // Invalidate caches so tribe list and identity refresh
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tribes"] }),
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[1] === "getOwnedObjects",
        }),
      ]);

      push({
        level: "info",
        title: "Tribe Created",
        message: `${name} has been created on-chain.`,
        source: "CreateTribeModal",
      });

      // Dismiss modal and navigate to the new tribe page
      onClose();
      if (tribeObjectId && tribeObjectId !== "pending") {
        navigate(`/tribe/${tribeObjectId}`);
      }
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

      <CoinTypeSelector value={selectedCoinType} onChange={setSelectedCoinType} />

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

      <SubmitButton $fullWidth onClick={handleCreate} disabled={!name || !characterId || !hasTribe || isPending || misconfigured || !selectedCoinType}>
        {isPending ? "Creating…" : misconfigured ? "Tribe contracts not configured" : "Create Tribe"}
      </SubmitButton>
    </Modal>
  );
}
