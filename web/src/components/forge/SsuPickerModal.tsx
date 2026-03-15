import { useState, useMemo } from "react";
import styled from "styled-components";
import type { AssemblyData } from "../../lib/types";
import { ASSEMBLY_TYPES } from "../../lib/types";
import { truncateAddress } from "../../lib/format";

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
  width: 480px;
  max-width: 95vw;
  max-height: 70vh;
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
  gap: ${({ theme }) => theme.spacing.xs};
  overflow-y: auto;
  flex: 1;
`;

const SsuCard = styled.button`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s;
  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const SsuInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const SsuName = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SsuMeta = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

const StatusDot = styled.span<{ $online: boolean }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $online, theme }) =>
    $online ? theme.colors.success : theme.colors.text.muted};
  flex-shrink: 0;
`;

const Empty = styled.p`
  text-align: center;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 13px;
  padding: ${({ theme }) => theme.spacing.lg} 0;
`;

// ── Component ──────────────────────────────────────────────────

interface Props {
  ssus: AssemblyData[];
  onSelect: (ssuId: string) => void;
  onClose: () => void;
}

export function SsuPickerModal({ ssus, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return ssus;
    return ssus.filter((ssu) => {
      const label =
        ssu.name || ASSEMBLY_TYPES[ssu.typeId]?.label || "SSU";
      return (
        label.toLowerCase().includes(q) ||
        ssu.id.toLowerCase().includes(q)
      );
    });
  }, [ssus, query]);

  function handleSelect(ssu: AssemblyData) {
    onSelect(ssu.id);
    onClose();
  }

  return (
    <Overlay
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Panel>
        <Header>
          <Title>Select SSU</Title>
          <CloseBtn onClick={onClose}>&times;</CloseBtn>
        </Header>

        <Search
          placeholder="Search by name or ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <List>
          {filtered.length === 0 && <Empty>No SSUs found</Empty>}
          {filtered.map((ssu) => {
            const label =
              ssu.name || ASSEMBLY_TYPES[ssu.typeId]?.label || "SSU";
            const isOnline = ssu.status === "Online";
            return (
              <SsuCard key={ssu.id} onClick={() => handleSelect(ssu)}>
                <StatusDot $online={isOnline} title={ssu.status} />
                <SsuInfo>
                  <SsuName>{label}</SsuName>
                  <SsuMeta>{truncateAddress(ssu.id, 8, 6)}</SsuMeta>
                </SsuInfo>
              </SsuCard>
            );
          })}
        </List>
      </Panel>
    </Overlay>
  );
}
