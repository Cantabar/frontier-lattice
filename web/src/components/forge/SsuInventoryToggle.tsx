import { useMemo } from "react";
import styled from "styled-components";
import type { AssemblyData } from "../../lib/types";
import { ASSEMBLY_TYPES } from "../../lib/types";
import { truncateAddress } from "../../lib/format";
import { SsuPickerField } from "./SsuPickerField";

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Wrapper = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ToggleRow = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  cursor: pointer;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const SsuList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  padding-left: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const SsuRow = styled.label<{ $checked: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: 12px;
  color: ${({ $checked, theme }) =>
    $checked ? theme.colors.text.primary : theme.colors.text.muted};
  cursor: pointer;
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ $checked, theme }) =>
    $checked ? theme.colors.surface.bg : "transparent"};

  &:hover {
    background: ${({ theme }) => theme.colors.surface.bg};
  }
`;

const SelectActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  padding-left: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const ActionLink = styled.button`
  background: none;
  border: none;
  padding: 0;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.primary.main};
  cursor: pointer;
  text-decoration: underline;

  &:hover {
    opacity: 0.8;
  }
`;

const StatusLine = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  padding-left: ${({ theme }) => theme.spacing.md};
`;

const Hint = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const QuickPickRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding-left: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const QuickPickLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.03em;
  flex-shrink: 0;
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  /** All owned SSU structures. */
  ssus: AssemblyData[];
  /** Whether SSU inventory subtraction is enabled. */
  enabled: boolean;
  /** Toggle the enabled state. */
  onToggle: (enabled: boolean) => void;
  /** Currently selected SSU IDs. */
  selectedIds: Set<string>;
  /** Update the selected SSU IDs. */
  onSelectionChange: (ids: Set<string>) => void;
  /** Whether structures are still loading. */
  isLoadingStructures: boolean;
  /** Inventory loading indicator. */
  isLoadingInventory: boolean;
  /** Number of unique item types found. */
  uniqueTypeCount: number;
  /** Number of SSUs with items. */
  ssuCount: number;
  /** Whether a wallet is connected. */
  walletConnected: boolean;
}

export function SsuInventoryToggle({
  ssus,
  enabled,
  onToggle,
  selectedIds,
  onSelectionChange,
  isLoadingStructures,
  isLoadingInventory,
  uniqueTypeCount,
  ssuCount,
  walletConnected,
}: Props) {
  const sortedSsus = useMemo(
    () =>
      [...ssus].sort((a, b) => {
        const nameA = a.name || ASSEMBLY_TYPES[a.typeId]?.label || "";
        const nameB = b.name || ASSEMBLY_TYPES[b.typeId]?.label || "";
        return nameA.localeCompare(nameB);
      }),
    [ssus],
  );

  // Derive which single SSU is selected when only one is picked
  const quickPickValue = useMemo(() => {
    if (selectedIds.size === 1) return [...selectedIds][0];
    return null;
  }, [selectedIds]);

  function handleQuickPick(ssuId: string) {
    onSelectionChange(new Set([ssuId]));
  }

  function toggleSsu(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  function selectAll() {
    onSelectionChange(new Set(ssus.map((s) => s.id)));
  }

  function selectNone() {
    onSelectionChange(new Set());
  }

  if (!walletConnected) {
    return (
      <Wrapper>
        <ToggleRow>
          <input type="checkbox" disabled />
          Subtract SSU inventory
        </ToggleRow>
        <Hint>Connect wallet to use SSU inventory.</Hint>
      </Wrapper>
    );
  }

  if (!isLoadingStructures && ssus.length === 0) {
    return (
      <Wrapper>
        <ToggleRow>
          <input type="checkbox" disabled />
          Subtract SSU inventory
        </ToggleRow>
        <Hint>No SSUs found on-chain.</Hint>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <ToggleRow>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          disabled={isLoadingStructures}
        />
        Subtract SSU inventory
      </ToggleRow>

      {enabled && (
        <>
          <QuickPickRow>
            <QuickPickLabel>Quick pick</QuickPickLabel>
            <SsuPickerField
              ssus={sortedSsus}
              value={quickPickValue}
              onSelect={handleQuickPick}
            />
          </QuickPickRow>

          <SelectActions>
            <ActionLink onClick={selectAll}>Select all</ActionLink>
            <ActionLink onClick={selectNone}>Select none</ActionLink>
          </SelectActions>

          <SsuList>
            {isLoadingStructures ? (
              <Hint>Loading structures…</Hint>
            ) : (
              sortedSsus.map((ssu) => {
                const isChecked = selectedIds.has(ssu.id);
                const label =
                  ssu.name || ASSEMBLY_TYPES[ssu.typeId]?.label || "SSU";
                return (
                  <SsuRow key={ssu.id} $checked={isChecked}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSsu(ssu.id)}
                    />
                    {label} — {truncateAddress(ssu.id, 8, 6)}
                  </SsuRow>
                );
              })
            )}
          </SsuList>

          <StatusLine>
            {isLoadingInventory
              ? "Loading inventory…"
              : selectedIds.size === 0
                ? "No SSUs selected"
                : `${uniqueTypeCount} item type${uniqueTypeCount !== 1 ? "s" : ""} across ${ssuCount} SSU${ssuCount !== 1 ? "s" : ""}`}
          </StatusLine>
        </>
      )}
    </Wrapper>
  );
}
