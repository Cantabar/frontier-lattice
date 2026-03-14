import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { buildRemoveMember } from "../../lib/sui";

const RemoveBtn = styled.button`
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: #e53935;
    color: #e53935;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

interface Props {
  tribeId: string;
  capId: string;
  characterId: string;
}

export function RemoveMemberButton({ tribeId, capId, characterId }: Props) {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [pending, setPending] = useState(false);

  async function handleRemove() {
    if (!confirm("Remove this member? Their TribeCap will become invalid.")) return;
    setPending(true);
    try {
      const tx = buildRemoveMember({ tribeId, capId, characterId });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
      await signAndExecute({ transaction: tx as any });
    } finally {
      setPending(false);
    }
  }

  return (
    <RemoveBtn onClick={handleRemove} disabled={pending}>
      {pending ? "…" : "Remove"}
    </RemoveBtn>
  );
}
