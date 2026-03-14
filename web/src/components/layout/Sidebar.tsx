import { NavLink } from "react-router-dom";
import styled from "styled-components";
import { useIdentity } from "../../hooks/useIdentity";
import { useNotifications } from "../../hooks/useNotifications";

const Nav = styled.nav`
  width: 200px;
  flex-shrink: 0;
  background: ${({ theme }) => theme.colors.surface.raised};
  border-right: 1px solid ${({ theme }) => theme.colors.surface.border};
  padding: ${({ theme }) => theme.spacing.md} 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const StyledLink = styled(NavLink)`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  border-left: 3px solid transparent;
  transition: all 0.15s ease;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
    background: ${({ theme }) => theme.colors.surface.overlay};
  }

  &.active {
    color: ${({ theme }) => theme.colors.primary.main};
    border-left-color: ${({ theme }) => theme.colors.primary.main};
    background: ${({ theme }) => theme.colors.surface.overlay};
  }
`;

const SectionLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${({ theme }) => theme.colors.text.muted};
  padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.lg}
    ${({ theme }) => theme.spacing.xs};
`;

const NotifBadge = styled.span`
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
  margin-left: auto;
`;

export function Sidebar() {
  const { tribeCaps } = useIdentity();
  const { unreadCount } = useNotifications();
  const userTribeId = tribeCaps[0]?.tribeId;

  return (
    <Nav>
      <StyledLink to="/" end>
        Dashboard
      </StyledLink>
      <SectionLabel>Tribe</SectionLabel>
      <StyledLink to="/tribes">All Tribes</StyledLink>
      {userTribeId && (
        <StyledLink to={`/tribe/${userTribeId}`}>My Tribe</StyledLink>
      )}
      <SectionLabel>Modules</SectionLabel>
      <StyledLink to="/jobs">Contract Board</StyledLink>
      <StyledLink to="/contracts">Trustless Contracts</StyledLink>
      <StyledLink to="/forge">Forge Planner</StyledLink>
      <StyledLink to="/events">Event Explorer</StyledLink>
      <SectionLabel>System</SectionLabel>
      <StyledLink to="/notifications">
        Notifications{unreadCount > 0 && <NotifBadge>{unreadCount}</NotifBadge>}
      </StyledLink>
    </Nav>
  );
}
