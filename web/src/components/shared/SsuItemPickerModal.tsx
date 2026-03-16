import { useState, useMemo } from "react";
import styled from "styled-components";
import { useSsuInventory, type InventoryItemEntry } from "../../hooks/useSsuInventory";
import { useItems } from "../../hooks/useItems";

// ── Styled components ──────────────────────────────────────────

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
`;

const Panel = styled.div`
  background: ${({ theme }) => theme.colors.surface.overlay};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.lg};
  width: 560px;
  max-width: 95vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const Title = styled.h2`
  font-size: 18px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const CloseBtn = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 20px;
  line-height: 1;
  padding: ${({ theme }) => theme.spacing.xs};
  cursor: pointer;
  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const Search = styled.input`
  width: 100%;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 13px;
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  flex: 1;
`;

const Row = styled.button<{ $selected?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ $selected, theme }) =>
    $selected ? theme.colors.primary.subtle : "transparent"};
  border: none;
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 13px;
  cursor: pointer;
  text-align: left;

  &:hover {
    background: ${({ theme }) => theme.colors.surface.raised};
  }
`;

const Icon = styled.img`
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
`;

const IconPlaceholder = styled.div`
  width: 32px;
  height: 32px;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.surface.border};
  flex-shrink: 0;
`;

const ItemName = styled.span`
  flex: 1;
  line-height: 1.3;
  word-break: break-word;
`;

const ItemMeta = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  flex-shrink: 0;
  white-space: nowrap;
`;

const Qty = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  flex-shrink: 0;
`;

const StatusText = styled.div`
  padding: ${({ theme }) => theme.spacing.lg};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-align: center;
`;

// ── Component ──────────────────────────────────────────────────

interface Props {
  ssuId: string;
  ownerCapId: string;
  value: string;
  /** When set, only items matching this typeId are shown. */
  filterTypeId?: number;
  /** When true, only items from the owner inventory slot are shown (excludes open storage & other player slots). */
  ownerOnly?: boolean;
  onSelect: (entry: InventoryItemEntry) => void;
  onClose: () => void;
}

export function SsuItemPickerModal({
  ssuId,
  ownerCapId,
  value,
  filterTypeId,
  ownerOnly,
  onSelect,
  onClose,
}: Props) {
  const { getItem } = useItems();
  const { slots, isLoading } = useSsuInventory(ssuId || undefined, ownerCapId || undefined, !!ssuId && !!ownerCapId);
  const [query, setQuery] = useState("");

  // Deduplicate inventory entries (sum quantities per typeId)
  const items = useMemo(() => {
    const map = new Map<number, InventoryItemEntry>();
    const filteredSlots = ownerOnly ? slots.filter((s) => s.kind === "owner") : slots;
    for (const slot of filteredSlots) {
      for (const entry of slot.items) {
        if (filterTypeId != null && entry.typeId !== filterTypeId) continue;
        const existing = map.get(entry.typeId);
        if (existing) {
          map.set(entry.typeId, { ...existing, quantity: existing.quantity + entry.quantity });
        } else {
          map.set(entry.typeId, { ...entry });
        }
      }
    }
    return [...map.values()].sort((a, b) => {
      const aName = getItem(a.typeId)?.name ?? "";
      const bName = getItem(b.typeId)?.name ?? "";
      return aName.localeCompare(bName);
    });
  }, [slots, getItem, filterTypeId, ownerOnly]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter((entry) => {
      const info = getItem(entry.typeId);
      const name = info?.name?.toLowerCase() ?? "";
      return name.includes(q) || String(entry.typeId).includes(q);
    });
  }, [items, query, getItem]);

  function handleSelect(entry: InventoryItemEntry) {
    onSelect(entry);
    onClose();
  }

  return (
    <Overlay onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Panel>
        <Header>
          <Title>Select SSU Item</Title>
          <CloseBtn onClick={onClose}>&times;</CloseBtn>
        </Header>

        <Search
          placeholder="Search by name or type ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <List>
          {isLoading ? (
            <StatusText>Loading inventory…</StatusText>
          ) : filtered.length === 0 ? (
            <StatusText>{items.length === 0 ? "No items in this SSU" : "No matching items"}</StatusText>
          ) : (
            filtered.map((entry) => {
              const info = getItem(entry.typeId);
              return (
                <Row
                  key={entry.typeId}
                  $selected={String(entry.typeId) === value}
                  onClick={() => handleSelect(entry)}
                >
                  {info?.icon ? (
                    <Icon src={`/${info.icon}`} alt={info.name} />
                  ) : (
                    <IconPlaceholder />
                  )}
                  <ItemName>{info?.name ?? `Type ${entry.typeId}`}</ItemName>
                  <ItemMeta>#{entry.typeId}</ItemMeta>
                  <Qty>×{entry.quantity.toLocaleString()}</Qty>
                </Row>
              );
            })
          )}
        </List>
      </Panel>
    </Overlay>
  );
}
