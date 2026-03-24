import styled from "styled-components";
import { WalletButton } from "../shared/WalletButton";
import { useNavigate } from "react-router-dom";
import { useIdentity } from "../../hooks/useIdentity";
import { useNotifications } from "../../hooks/useNotifications";
import { truncateAddress, generateAvatarColor } from "../../lib/format";
import { config } from "../../config";
import { Logo as LogoSvg } from "../shared/Logo";

const HeaderBar = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  background: ${({ theme }) => theme.colors.surface.raised};
  border-bottom: 2px solid transparent;
  border-image: linear-gradient(
    90deg,
    ${({ theme }) => theme.colors.rust.main} 0%,
    ${({ theme }) => theme.colors.rust.muted} 40%,
    transparent 100%
  ) 1;
  height: 56px;
  flex-shrink: 0;
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  cursor: pointer;
  animation: powerFlicker 6s ease-in-out infinite;
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

const ENV_COLORS: Record<string, string> = {
  utopia: "#7C4DFF",
  stillness: "#00E5FF",
  local: "#FFB74D",
};

const EnvBadge = styled.span<{ $color: string }>`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${({ $color }) => $color};
  background: ${({ $color }) => $color}18;
  border: 1px solid ${({ $color }) => $color}44;
  border-radius: 4px;
  padding: 2px 6px;
`;

interface HeaderProps {
  sidebarOpenButton?: React.ReactNode;
}

export function Header({ sidebarOpenButton }: HeaderProps) {
  const { address, characterId, characterName, characterPortraitUrl } = useIdentity();
  const { unreadCount } = useNotifications();
  const navigate = useNavigate();

  const showCharacter = !!address && !!characterId;
  const displayName = characterName || (characterId ? truncateAddress(characterId) : null);
  const avatarColor = characterId ? generateAvatarColor(characterId) : "transparent";

  return (
    <HeaderBar>
      <Brand onClick={() => navigate("/")}>
        {sidebarOpenButton}
        <LogoSvg height={28} />
        <EnvBadge $color={ENV_COLORS[config.appEnv] ?? "#78909C"}>
          {config.appEnv}
        </EnvBadge>
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
        <WalletButton />
      </Controls>
    </HeaderBar>
  );
}
