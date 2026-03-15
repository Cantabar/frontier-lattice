import { useState, useMemo } from "react";
import styled from "styled-components";
import { useCharacters } from "../../hooks/useCharacters";
import { truncateAddress, generateAvatarColor } from "../../lib/format";
import { PrimaryButton } from "./Button";

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

const Portrait = styled.img`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
`;

const AvatarPlaceholder = styled.span<{ $color: string }>`
  display: inline-block;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
  flex-shrink: 0;
`;

const CharName = styled.span`
  flex: 1;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.primary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CharId = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  flex-shrink: 0;
`;

const TribeTag = styled.span`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.text.muted};
  background: ${({ theme }) => theme.colors.surface.bg};
  border-radius: 8px;
  padding: 1px 6px;
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

const DoneButton = styled(PrimaryButton)`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
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

// ── Component ──────────────────────────────────────────────────

interface Props {
  selected: string[];
  onDone: (characterIds: string[]) => void;
  onClose: () => void;
}

export function CharacterPickerModal({ selected, onDone, onClose }: Props) {
  const { characters, isLoading } = useCharacters();
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected));

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return characters;
    return characters.filter((c) => {
      const name = c.name.toLowerCase();
      const id = c.characterId.toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [characters, query]);

  function toggle(id: string) {
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
          <Title>Select Characters</Title>
          <CloseBtn onClick={onClose}>&times;</CloseBtn>
        </Header>

        <Search
          placeholder="Search by name or ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <List>
          {isLoading && <Empty>Loading characters…</Empty>}
          {!isLoading && filtered.length === 0 && <Empty>No characters found</Empty>}
          {filtered.map((char) => {
            const isChecked = checked.has(char.characterId);
            return (
              <Row key={char.characterId} $selected={isChecked}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(char.characterId)}
                />
                {char.portraitUrl ? (
                  <Portrait src={char.portraitUrl} alt={char.name} />
                ) : (
                  <AvatarPlaceholder $color={generateAvatarColor(char.characterId)} />
                )}
                <CharName>{char.name || truncateAddress(char.characterId)}</CharName>
                {char.tribeId > 0 && <TribeTag>Tribe {char.tribeId}</TribeTag>}
                <CharId>{truncateAddress(char.characterId, 6, 4)}</CharId>
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
