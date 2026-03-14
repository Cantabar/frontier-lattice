import styled from "styled-components";
import { ConnectButton } from "@mysten/dapp-kit";
import { useNavigate } from "react-router-dom";
import { useIdentity } from "../../hooks/useIdentity";
import { useNotifications } from "../../hooks/useNotifications";
import { truncateAddress, generateAvatarColor } from "../../lib/format";

const HeaderBar = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  background: ${({ theme }) => theme.colors.surface.raised};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surface.border};
  height: 56px;
  flex-shrink: 0;
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const Logo = styled.span`
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  letter-spacing: -0.02em;
`;

const Accent = styled.span`
  color: ${({ theme }) => theme.colors.primary.main};
`;

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
`;

const CharacterBadge = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const PortraitImg = styled.img`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
`;

const PortraitPlaceholder = styled.span<{ $color: string }>`
  display: inline-block;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
`;

const CharacterName = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const BellButton = styled.button<{ $hasUnread: boolean }>`
  position: relative;
  background: none;
  border: 1px solid ${({ theme, $hasUnread }) =>
    $hasUnread ? theme.colors.warning : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme, $hasUnread }) =>
    $hasUnread ? theme.colors.warning : theme.colors.text.muted};
  padding: 4px 8px;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: border-color 0.15s, color 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const UnreadBadge = styled.span`
  background: ${({ theme }) => theme.colors.danger};
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
`;

export function Header() {
  const { address, characterId, characterName, characterPortraitUrl } = useIdentity();
  const { unreadCount } = useNotifications();
  const navigate = useNavigate();

  const showCharacter = !!address && !!characterId;
  const displayName = characterName || (characterId ? truncateAddress(characterId) : null);
  const avatarColor = characterId ? generateAvatarColor(characterId) : "transparent";

  return (
    <HeaderBar>
      <Brand>
        <Logo>
          Frontier <Accent>Lattice</Accent>
        </Logo>
      </Brand>
      <Controls>
        {showCharacter && (
          <CharacterBadge title={characterId ?? undefined}>
            {characterPortraitUrl ? (
              <PortraitImg src={characterPortraitUrl} alt={displayName ?? ""} />
            ) : (
              <PortraitPlaceholder $color={avatarColor} />
            )}
            <CharacterName>{displayName}</CharacterName>
          </CharacterBadge>
        )}
        <BellButton
          $hasUnread={unreadCount > 0}
          onClick={() => navigate("/notifications")}
          title="Session notifications"
        >
          &#x1F514;
          {unreadCount > 0 && <UnreadBadge>{unreadCount}</UnreadBadge>}
        </BellButton>
        <ConnectButton />
      </Controls>
    </HeaderBar>
  );
}
