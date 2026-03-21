import { useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "../shared/Modal";
import { TransactionStepper } from "../shared/TransactionStepper";
import { useTransactionPhase } from "../../hooks/useTransactionPhase";
import { buildCreateTribe } from "../../lib/sui";
import { useIdentity } from "../../hooks/useIdentity";
import { useNotifications } from "../../hooks/useNotifications";
import { config } from "../../config";
import { PrimaryButton } from "../shared/Button";
import type { TribeListItem } from "../../lib/types";

const TRIBE_CREATION_STEPS = [
  { key: "signing", label: "Waiting for wallet" },
  { key: "confirming", label: "Confirming on chain" },
  { key: "indexing", label: "Syncing tribe data" },
  { key: "verifying", label: "Loading tribe data" },
];

/** How long (ms) to poll for valid tribe fields before giving up. */
const VERIFY_TIMEOUT_MS = 15_000;
const VERIFY_INTERVAL_MS = 2_000;

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
  const [error, setError] = useState<string | null>(null);
  const { phase: step, setPhase: setStep, isBusy: busy, phaseLabel } = useTransactionPhase(TRIBE_CREATION_STEPS);

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
    setStep("signing");
    const tx = buildCreateTribe({
      registryId: config.tribeRegistryId,
      characterId,
      name,
      sender: address,
    });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
      const result = await signAndExecute(
        { transaction: tx as any },
        { onSuccess: () => {} },
      );

      setStep("confirming" );

      // Parse the created Tribe object ID from the transaction response
      let tribeObjectId: string | null = null;
      const txResult = result as { digest?: string; objectChanges?: { type: string; objectType?: string; objectId?: string }[] };
      const changes = txResult.objectChanges;
      if (changes) {
        const tribeObj = changes.find(
          (c) => c.type === "created" && c.objectType?.includes("::tribe::Tribe"),
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
          coinType: config.coinType,
        });
      }

      setStep("indexing");

      // Wait for the transaction to be indexed so refetches return the new TribeCap
      if (txResult.digest) {
        await client.waitForTransaction({ digest: txResult.digest });
      }

      // Invalidate caches so tribe list, identity, and auto-join state refresh
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tribes"] }),
        queryClient.invalidateQueries({ queryKey: ["autoJoinLookup"] }),
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[1] === "getOwnedObjects",
        }),
      ]);

      // Poll until the tribe object is fully populated before leaving the modal
      let verified = false;
      if (tribeObjectId && tribeObjectId !== "pending") {
        setStep("verifying");
        const deadline = Date.now() + VERIFY_TIMEOUT_MS;
        while (Date.now() < deadline) {
          try {
            const obj = await client.getObject({
              id: tribeObjectId,
              options: { showContent: true },
            });
            const f = (obj.data?.content as { fields?: Record<string, unknown> })?.fields;
            if (
              f &&
              typeof f.name === "string" &&
              f.name.length > 0 &&
              Number.isFinite(Number(f.member_count))
            ) {
              verified = true;
              break;
            }
          } catch {
            // object may not exist yet — keep polling
          }
          await new Promise((r) => setTimeout(r, VERIFY_INTERVAL_MS));
        }
      }

      push({
        level: "info",
        title: "Tribe Created",
        message: `${name} has been created on-chain.`,
        source: "CreateTribeModal",
      });

      // Dismiss modal and navigate to the new tribe page
      onClose();
      if (tribeObjectId && tribeObjectId !== "pending") {
        navigate(`/tribe/${tribeObjectId}`, {
          state: { justCreated: !verified, tribeName: name },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setStep(null);
      setError(msg);
      push({
        level: "error",
        title: "Create Tribe Failed",
        message: msg,
        source: "CreateTribeModal",
      });
    }
  }

  // -- View --
  return (
    <Modal title="Create Tribe" onClose={onClose} disableClose={busy}>
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
        disabled={!hasTribe || busy}
      />

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

      <TransactionStepper steps={TRIBE_CREATION_STEPS} currentStep={step} />

      <SubmitButton $fullWidth onClick={handleCreate} disabled={!name || !characterId || !hasTribe || busy || misconfigured}>
        {busy ? phaseLabel + "…" : misconfigured ? "Tribe contracts not configured" : "Create Tribe"}
      </SubmitButton>
    </Modal>
  );
}
