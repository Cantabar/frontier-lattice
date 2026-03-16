import { useMemo, useState } from "react";
import styled from "styled-components";
import { useMyStructures } from "../../hooks/useStructures";
import { ASSEMBLY_TYPES } from "../../lib/types";
import { truncateAddress } from "../../lib/format";

const MANUAL_SENTINEL = "__other__";

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

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ManualInput = styled.input`
  width: 100%;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;
  font-family: monospace;
  margin-bottom: ${({ theme }) => theme.spacing.md};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const Hint = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: -${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

interface Props {
  value: string;
  /**
   * Called when the selected SSU changes.
   * `owned` is true when the SSU is one of the player's own structures,
   * false when entered manually (non-owned SSU / player inventory).
   */
  onChange: (ssuId: string, owned: boolean) => void;
  placeholder?: string;
  /** When true, show the "Other SSU" manual-entry option. Defaults to false. */
  allowManualEntry?: boolean;
}

export function SsuPickerField({
  value,
  onChange,
  placeholder = "Select an SSU…",
  allowManualEntry = false,
}: Props) {
  const { structures, isLoading } = useMyStructures();
  const [isManual, setIsManual] = useState(false);

  const ssus = useMemo(
    () => structures.filter((s) => s.moveType === "StorageUnit"),
    [structures],
  );

  // Determine effective dropdown value for the <select>
  const selectValue = isManual ? MANUAL_SENTINEL : value;

  function handleSelectChange(raw: string) {
    if (raw === MANUAL_SENTINEL) {
      setIsManual(true);
      onChange("", false);
    } else {
      setIsManual(false);
      onChange(raw, true);
    }
  }

  if (isLoading) {
    return <Select disabled><option>Loading structures…</option></Select>;
  }

  if (ssus.length === 0 && !allowManualEntry) {
    return (
      <>
        <Select disabled>
          <option>No SSUs found</option>
        </Select>
        <Hint>You need to own at least one SSU on-chain.</Hint>
      </>
    );
  }

  return (
    <>
      <Select value={selectValue} onChange={(e) => handleSelectChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {ssus.map((ssu) => (
          <option key={ssu.id} value={ssu.id}>
            {ssu.name || ASSEMBLY_TYPES[ssu.typeId]?.label || "SSU"} — {truncateAddress(ssu.id, 8, 6)}
          </option>
        ))}
        {allowManualEntry && (
          <option value={MANUAL_SENTINEL}>Other SSU (enter ID)…</option>
        )}
      </Select>
      {isManual && (
        <>
          <ManualInput
            placeholder="0x…"
            value={value}
            onChange={(e) => onChange(e.target.value.trim(), false)}
            autoFocus
          />
          <Hint>Enter the SSU object ID where you have a player inventory.</Hint>
        </>
      )}
    </>
  );
}
