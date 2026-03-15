import { useState } from "react";
import styled from "styled-components";
import { CharacterPickerModal } from "./CharacterPickerModal";
import { useCharacters } from "../../hooks/useCharacters";
import { truncateAddress, generateAvatarColor } from "../../lib/format";

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

const Portrait = styled.img`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
`;

const AvatarDot = styled.span<{ $color: string }>`
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
  flex-shrink: 0;
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

interface Props {
  value: string[];
  onChange: (characterIds: string[]) => void;
}

export function CharacterPickerField({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const { characters } = useCharacters();

  // Build lookup map
  const charMap = new Map<string, { name: string; portraitUrl: string }>();
  for (const c of characters) charMap.set(c.characterId, c);

  function handleRemove(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    onChange(value.filter((v) => v !== id));
  }

  return (
    <>
      <Trigger type="button" onClick={() => setOpen(true)}>
        {value.length === 0 ? (
          <Placeholder>Select characters…</Placeholder>
        ) : (
          value.map((id) => {
            const char = charMap.get(id);
            const label = char?.name || truncateAddress(id, 6, 4);
            return (
              <Pill key={id}>
                {char?.portraitUrl ? (
                  <Portrait src={char.portraitUrl} alt={label} />
                ) : (
                  <AvatarDot $color={generateAvatarColor(id)} />
                )}
                {label}
                <RemoveBtn onClick={(e) => handleRemove(e, id)}>&times;</RemoveBtn>
              </Pill>
            );
          })
        )}
      </Trigger>
      {open && (
        <CharacterPickerModal
          selected={value}
          onDone={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
