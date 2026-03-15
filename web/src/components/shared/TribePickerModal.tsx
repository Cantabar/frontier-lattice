import { useState, useMemo } from "react";
import styled from "styled-components";
import { useAllTribes } from "../../hooks/useAllTribes";
import type { InGameTribe } from "../../lib/types";

// ── Styled components (follows ItemPickerModal pattern) ────────

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
  width: 520px;
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
  min-height: 120px;
  max-height: 400px;
`;

const Row = styled.label<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ $selected, theme }) =>
    $selected ? theme.colors.primary.subtle : "transparent"};
  cursor: pointer;
  transition: background 0.12s;

  &:hover {
    background: ${({ theme }) => theme.colors.surface.bg};
  }
`;

const TribeName = styled.span`
  flex: 1;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.primary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Ticker = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  flex-shrink: 0;
`;

const MemberCount = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  flex-shrink: 0;
`;

const Empty = styled.p`
  text-align: center;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 13px;
  padding: ${({ theme }) => theme.spacing.lg} 0;
`;

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const DoneButton = styled.button`
  background: ${({ theme }) => theme.colors.primary.main};
  color: #fff;
  border: none;
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.colors.primary.hover};
  }
`;

const ClearButton = styled.button`
  background: transparent;
  color: ${({ theme }) => theme.colors.text.muted};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  font-size: 13px;
  cursor: pointer;
  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

// ── Helpers ────────────────────────────────────────────────────

function displayName(t: InGameTribe): string {
  if (t.onChainTribe) return t.onChainTribe.name;
  if (t.worldInfo) return t.worldInfo.name;
  return `Tribe #${t.inGameTribeId}`;
}

// ── Component ──────────────────────────────────────────────────

interface Props {
  selected: number[];
  onDone: (tribeIds: number[]) => void;
  onClose: () => void;
}

export function TribePickerModal({ selected, onDone, onClose }: Props) {
  const { allTribes, isLoading } = useAllTribes();
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<number>>(() => new Set(selected));

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return allTribes;
    return allTribes.filter((t) => {
      const name = displayName(t).toLowerCase();
      const ticker = t.worldInfo?.nameShort?.toLowerCase() ?? "";
      const idStr = String(t.inGameTribeId);
      return name.includes(q) || ticker.includes(q) || idStr.includes(q);
    });
  }, [allTribes, query]);

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDone() {
    onDone([...checked]);
    onClose();
  }

  return (
    <Overlay onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Panel>
        <Header>
          <Title>Select Tribes</Title>
          <CloseBtn onClick={onClose}>&times;</CloseBtn>
        </Header>

        <Search
          placeholder="Search by name, ticker, or ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <List>
          {isLoading && <Empty>Loading tribes…</Empty>}
          {!isLoading && filtered.length === 0 && <Empty>No tribes found</Empty>}
          {filtered.map((tribe) => {
            const id = tribe.inGameTribeId;
            const isChecked = checked.has(id);
            return (
              <Row key={id} $selected={isChecked}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(id)}
                />
                <TribeName>{displayName(tribe)}</TribeName>
                {tribe.worldInfo?.nameShort && (
                  <Ticker>[{tribe.worldInfo.nameShort}]</Ticker>
                )}
                {tribe.characterCount > 0 && (
                  <MemberCount>{tribe.characterCount} chars</MemberCount>
                )}
              </Row>
            );
          })}
        </List>

        <Footer>
          {checked.size > 0 && (
            <ClearButton onClick={() => setChecked(new Set())}>
              Clear ({checked.size})
            </ClearButton>
          )}
          <DoneButton onClick={handleDone}>
            Done{checked.size > 0 ? ` (${checked.size})` : ""}
          </DoneButton>
        </Footer>
      </Panel>
    </Overlay>
  );
}
