import { useState } from "react";
import styled from "styled-components";
import { TribePickerModal } from "./TribePickerModal";
import { useAllTribes } from "../../hooks/useAllTribes";
import type { InGameTribe } from "../../lib/types";

const Trigger = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 38px;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  margin-bottom: ${({ theme }) => theme.spacing.md};

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const Placeholder = styled.span`
  color: ${({ theme }) => theme.colors.text.muted};
`;

const Pill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: ${({ theme }) => theme.colors.primary.subtle};
  border: 1px solid ${({ theme }) => theme.colors.primary.main}44;
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const RemoveBtn = styled.span`
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  color: ${({ theme }) => theme.colors.text.muted};
  &:hover {
    color: ${({ theme }) => theme.colors.danger};
  }
`;

function displayName(t: InGameTribe): string {
  if (t.onChainTribe) return t.onChainTribe.name;
  if (t.worldInfo) return t.worldInfo.name;
  return `Tribe #${t.inGameTribeId}`;
}

interface Props {
  value: number[];
  onChange: (tribeIds: number[]) => void;
}

export function TribePickerField({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const { allTribes } = useAllTribes();

  // Resolve IDs to display names
  const tribeMap = new Map<number, InGameTribe>();
  for (const t of allTribes) tribeMap.set(t.inGameTribeId, t);

  function handleRemove(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    onChange(value.filter((v) => v !== id));
  }

  return (
    <>
      <Trigger type="button" onClick={() => setOpen(true)}>
        {value.length === 0 ? (
          <Placeholder>Select tribes…</Placeholder>
        ) : (
          value.map((id) => {
            const tribe = tribeMap.get(id);
            const label = tribe ? displayName(tribe) : `#${id}`;
            return (
              <Pill key={id}>
                {label}
                <RemoveBtn onClick={(e) => handleRemove(e, id)}>&times;</RemoveBtn>
              </Pill>
            );
          })
        )}
      </Trigger>
      {open && (
        <TribePickerModal
          selected={value}
          onDone={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
