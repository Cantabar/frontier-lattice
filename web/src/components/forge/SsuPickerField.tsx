import { useState } from "react";
import styled from "styled-components";
import { SsuPickerModal } from "./SsuPickerModal";
import type { AssemblyData } from "../../lib/types";
import { ASSEMBLY_TYPES } from "../../lib/types";
import { truncateAddress } from "../../lib/format";

const Trigger = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 12px;
  cursor: pointer;
  text-align: left;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const Placeholder = styled.span`
  color: ${({ theme }) => theme.colors.text.muted};
`;

const StatusDot = styled.span<{ $online: boolean }>`
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${({ $online, theme }) =>
    $online ? theme.colors.success : theme.colors.text.muted};
  flex-shrink: 0;
`;

const Name = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const IdLabel = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  flex-shrink: 0;
`;

interface Props {
  /** All available SSUs to choose from. */
  ssus: AssemblyData[];
  /** Currently selected SSU ID, or null for none. */
  value: string | null;
  /** Called when the user picks an SSU. */
  onSelect: (ssuId: string) => void;
}

export function SsuPickerField({ ssus, value, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  const selected = value ? ssus.find((s) => s.id === value) : undefined;

  return (
    <>
      <Trigger type="button" onClick={() => setOpen(true)}>
        {selected ? (
          <>
            <StatusDot
              $online={selected.status === "Online"}
              title={selected.status}
            />
            <Name>
              {selected.name ||
                ASSEMBLY_TYPES[selected.typeId]?.label ||
                "SSU"}
            </Name>
            <IdLabel>{truncateAddress(selected.id, 6, 4)}</IdLabel>
          </>
        ) : (
          <Placeholder>Pick a specific SSU…</Placeholder>
        )}
      </Trigger>
      {open && (
        <SsuPickerModal
          ssus={ssus}
          onSelect={(id) => {
            onSelect(id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
