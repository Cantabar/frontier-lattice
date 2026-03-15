import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Modal } from "../shared/Modal";
import { buildUpdateReputation } from "../../lib/sui";
import { truncateAddress } from "../../lib/format";
import { PrimaryButton } from "../shared/Button";

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

const Row = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ToggleButton = styled.button<{ $active: boolean }>`
  flex: 1;
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.surface.overlay};
  color: ${({ $active, theme }) => ($active ? theme.colors.button.primaryText : "inherit")};
  border: 1px solid ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm};
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
`;

const SubmitButton = styled(PrimaryButton)`
  font-size: 14px;
`;

const CharacterLabel = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

interface Props {
  tribeId: string;
  capId: string;
  characterId: string;
  currentReputation: number;
  onClose: () => void;
}

export function UpdateReputationModal({ tribeId, capId, characterId, currentReputation, onClose }: Props) {
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [delta, setDelta] = useState("");
  const [increase, setIncrease] = useState(true);

  async function handleUpdate() {
    const d = Number(delta);
    if (!d || d <= 0) return;
    const tx = buildUpdateReputation({
      tribeId,
      capId,
      characterId,
      delta: d,
      increase,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
    await signAndExecute({ transaction: tx as any });
    onClose();
  }

  return (
    <Modal title="Update Reputation" onClose={onClose}>
      <CharacterLabel>
        Character: <code>{truncateAddress(characterId)}</code> · Current score: {currentReputation}
      </CharacterLabel>

      <Label>Direction</Label>
      <Row>
        <ToggleButton $active={increase} onClick={() => setIncrease(true)}>
          + Increase
        </ToggleButton>
        <ToggleButton $active={!increase} onClick={() => setIncrease(false)}>
          − Decrease
        </ToggleButton>
      </Row>

      <Label>Amount</Label>
      <Input
        type="number"
        min={1}
        placeholder="Reputation delta"
        value={delta}
        onChange={(e) => setDelta(e.target.value)}
        autoFocus
      />

      <SubmitButton $fullWidth onClick={handleUpdate} disabled={!delta || Number(delta) <= 0 || isPending}>
        {isPending ? "Updating…" : `${increase ? "Increase" : "Decrease"} Reputation`}
      </SubmitButton>
    </Modal>
  );
}
