import { useState } from "react";
import styled from "styled-components";
import type { InventoryItemEntry } from "../../hooks/useSsuInventory";
import { useItems } from "../../hooks/useItems";
import { SsuItemPickerModal } from "./SsuItemPickerModal";

// ── Styled components ──────────────────────────────────────────

const Wrapper = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Trigger = styled.button<{ $disabled?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};
  text-align: left;

  &:hover {
    border-color: ${({ $disabled, theme }) =>
      $disabled ? theme.colors.surface.border : theme.colors.primary.main};
  }
`;

const Placeholder = styled.span`
  color: ${({ theme }) => theme.colors.text.muted};
`;

const Icon = styled.img`
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
`;

const IconPlaceholder = styled.div`
  width: 24px;
  height: 24px;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.border};
  flex-shrink: 0;
`;

const ItemName = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ItemMeta = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  flex-shrink: 0;
`;

// ── Component ──────────────────────────────────────────────────

interface Props {
  ssuId: string;
  ownerCapId: string;
  /** Currently selected value — compared against `String(entry.typeId)` */
  value: string;
  onChange: (entry: InventoryItemEntry) => void;
  disabled?: boolean;
  placeholder?: string;
  /** When set, only items matching this typeId are shown. */
  filterTypeId?: number;
  /** When true, only items from the owner inventory slot are shown (excludes open storage & other player slots). */
  ownerOnly?: boolean;
}

export function SsuItemPickerField({
  ssuId,
  ownerCapId,
  value,
  onChange,
  disabled,
  placeholder = "Select an item from this SSU…",
  filterTypeId,
  ownerOnly,
}: Props) {
  const [open, setOpen] = useState(false);
  const { getItem } = useItems();

  const enabled = !!ssuId && !!ownerCapId;
  const isDisabled = disabled || !enabled;

  // Resolve display info for the currently selected item
  const numericValue = Number(value);
  const selectedInfo = numericValue ? getItem(numericValue) : undefined;

  return (
    <Wrapper>
      <Trigger
        type="button"
        $disabled={isDisabled}
        onClick={() => {
          if (!isDisabled) setOpen(true);
        }}
      >
        {value && selectedInfo ? (
          <>
            {selectedInfo.icon ? (
              <Icon src={`/${selectedInfo.icon}`} alt={selectedInfo.name} />
            ) : (
              <IconPlaceholder />
            )}
            <ItemName>{selectedInfo.name}</ItemName>
            <ItemMeta>#{value}</ItemMeta>
          </>
        ) : value ? (
          <>
            <IconPlaceholder />
            <ItemName>Type {value}</ItemName>
          </>
        ) : (
          <Placeholder>{!enabled ? "Select an SSU first" : placeholder}</Placeholder>
        )}
      </Trigger>

      {open && (
        <SsuItemPickerModal
          ssuId={ssuId}
          ownerCapId={ownerCapId}
          value={value}
          filterTypeId={filterTypeId}
          ownerOnly={ownerOnly}
          onSelect={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </Wrapper>
  );
}
