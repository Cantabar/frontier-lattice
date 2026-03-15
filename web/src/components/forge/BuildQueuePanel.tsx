import { useState } from "react";
import styled from "styled-components";
import { ItemPickerField } from "../shared/ItemPickerField";
import { PrimaryButton, SecondaryButton, DangerButton } from "../shared/Button";
import { useItems } from "../../hooks/useItems";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface BuildQueueItem {
  typeId: number;
  quantity: number;
}

/* ------------------------------------------------------------------ */
/* Styled                                                              */
/* ------------------------------------------------------------------ */

const Panel = styled.section`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const AddRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: center;
`;

const QtyInput = styled.input`
  flex: 0 0 80px;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const QueueList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  max-height: 420px;
  overflow-y: auto;
`;

const QueueRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
`;

const ItemIcon = styled.img`
  width: 28px;
  height: 28px;
  object-fit: contain;
  flex-shrink: 0;
`;

const ItemName = styled.span`
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Qty = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  white-space: nowrap;
`;

const ResolveLink = styled.button`
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary.main};
  cursor: pointer;
  white-space: nowrap;
  &:hover {
    text-decoration: underline;
  }
`;

const RemoveBtn = styled.button`
  background: none;
  border: none;
  padding: 2px 4px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.muted};
  cursor: pointer;
  &:hover {
    color: ${({ theme }) => theme.colors.danger};
  }
`;

const Empty = styled.p`
  text-align: center;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 13px;
  padding: ${({ theme }) => theme.spacing.md} 0;
  margin: 0;
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`;

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface Props {
  onResolveItem: (typeId: number, quantity: number) => void;
}

export function BuildQueuePanel({ onResolveItem }: Props) {
  const { getItem } = useItems();
  const [queue, setQueue] = useState<BuildQueueItem[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [quantity, setQuantity] = useState("1");

  function handleAdd() {
    const typeId = Number(selectedType);
    if (!typeId || Number(quantity) < 1) return;

    setQueue((prev) => {
      const existing = prev.find((i) => i.typeId === typeId);
      if (existing) {
        return prev.map((i) =>
          i.typeId === typeId
            ? { ...i, quantity: i.quantity + Number(quantity) }
            : i,
        );
      }
      return [...prev, { typeId, quantity: Number(quantity) }];
    });
    setSelectedType("");
    setQuantity("1");
  }

  function handleRemove(typeId: number) {
    setQueue((prev) => prev.filter((i) => i.typeId !== typeId));
  }

  function handleClear() {
    setQueue([]);
  }

  return (
    <Panel>
      <SectionTitle>Build Queue</SectionTitle>

      <AddRow>
        <ItemPickerField value={selectedType} onChange={setSelectedType} />
        <QtyInput
          type="number"
          min={1}
          placeholder="Qty"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <PrimaryButton onClick={handleAdd} disabled={!selectedType}>
          Add
        </PrimaryButton>
      </AddRow>

      <QueueList>
        {queue.length === 0 ? (
          <Empty>No items queued — add items above to plan your builds.</Empty>
        ) : (
          queue.map((entry) => {
            const item = getItem(entry.typeId);
            return (
              <QueueRow key={entry.typeId}>
                {item?.icon && (
                  <ItemIcon src={`/${item.icon}`} alt={item.name} loading="lazy" />
                )}
                <ItemName>{item?.name ?? `Type ${entry.typeId}`}</ItemName>
                <Qty>×{entry.quantity}</Qty>
                <ResolveLink onClick={() => onResolveItem(entry.typeId, entry.quantity)}>
                  Resolve
                </ResolveLink>
                <RemoveBtn onClick={() => handleRemove(entry.typeId)} title="Remove">
                  ✕
                </RemoveBtn>
              </QueueRow>
            );
          })
        )}
      </QueueList>

      {queue.length > 0 && (
        <Actions>
          <SecondaryButton onClick={() => onResolveItem(queue[0].typeId, queue[0].quantity)}>
            Resolve First
          </SecondaryButton>
          <DangerButton onClick={handleClear}>Clear All</DangerButton>
        </Actions>
      )}
    </Panel>
  );
}
