import { NavLink } from "react-router-dom";
import styled, { css } from "styled-components";
import {
  LayoutDashboard,
  Shield,
  Building2,
  FileText,
  Cpu,
  Hammer,
  MapPin,
  ShieldCheck,
  Activity,
  Bell,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Menu,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useIdentity } from "../../hooks/useIdentity";
import { useNotifications } from "../../hooks/useNotifications";
import type { SidebarMode } from "../../hooks/useSidebarState";

/* ---------- types ---------- */

interface SidebarProps {
  mode: SidebarMode;
  toggle: () => void;
}

/* ---------- styled ---------- */

const ICON_SIZE = 18;

const Nav = styled.nav<{ $mode: SidebarMode }>`
  flex-shrink: 0;
  background: ${({ theme }) => theme.colors.surface.raised};
  border-right: 1px solid ${({ theme }) => theme.colors.surface.border};
  padding: ${({ theme }) => theme.spacing.md} 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  transition: width 0.2s ease;
  overflow: hidden;

  ${({ $mode, theme }) =>
    $mode === "expanded" &&
    css`
      width: ${theme.sidebar.expandedWidth}px;
    `}

  ${({ $mode, theme }) =>
    $mode === "icons" &&
    css`
      width: ${theme.sidebar.iconWidth}px;
    `}

  ${({ $mode }) =>
    $mode === "hidden" &&
    css`
      width: 0;
      padding: 0;
      border-right: none;
    `}
`;

const linkBase = css`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  border-left: 3px solid transparent;
  transition: all 0.15s ease;
  white-space: nowrap;
`;

const StyledLink = styled(NavLink)<{ $mode: SidebarMode }>`
  ${linkBase}

  padding: ${({ theme, $mode }) =>
    $mode === "icons"
      ? `${theme.spacing.sm} 0`
      : `${theme.spacing.sm} ${theme.spacing.lg}`};

  justify-content: ${({ $mode }) => ($mode === "icons" ? "center" : "flex-start")};

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
    background: ${({ theme }) => theme.colors.surface.overlay};
  }

  &.active {
    color: ${({ theme }) => theme.colors.primary.main};
    border-left-color: ${({ theme }) => theme.colors.rust.main};
    background: ${({ theme }) => theme.colors.surface.overlay};
  }
`;

const DisabledNavItem = styled.span<{ $mode: SidebarMode }>`
  ${linkBase}

  padding: ${({ theme, $mode }) =>
    $mode === "icons"
      ? `${theme.spacing.sm} 0`
      : `${theme.spacing.sm} ${theme.spacing.lg}`};

  justify-content: ${({ $mode }) => ($mode === "icons" ? "center" : "flex-start")};
  color: ${({ theme }) => theme.colors.text.muted};
  cursor: not-allowed;
  position: relative;

  &:hover::after {
    content: "Create or join a Tribe to access this page.";
    position: absolute;
    left: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
    background: ${({ theme }) => theme.colors.surface.raised};
    color: ${({ theme }) => theme.colors.text.secondary};
    border: 1px solid ${({ theme }) => theme.colors.surface.border};
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 12px;
    white-space: nowrap;
    z-index: 10;
    pointer-events: none;
  }
`;

const Label = styled.span<{ $visible: boolean }>`
  display: ${({ $visible }) => ($visible ? "inline" : "none")};
`;

const SectionLabel = styled.div<{ $visible: boolean }>`
  font-size: 11px;
  font-weight: 600;
  font-family: ${({ theme }) => theme.fonts.heading};
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: ${({ theme }) => theme.colors.text.muted};
  padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.lg}
    ${({ theme }) => theme.spacing.xs};
  display: ${({ $visible }) => ($visible ? "block" : "none")};
  border-top: 1px solid ${({ theme }) => theme.colors.rust.muted}33;
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

/** Small dot overlay for icon-only mode */
const NotifDot = styled.span`
  position: absolute;
  top: -2px;
  right: -4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.danger};
`;

const IconWrap = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
`;

const Spacer = styled.div`
  margin-top: auto;
`;

const ToggleButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.text.muted};
  padding: ${({ theme }) => theme.spacing.sm};
  cursor: pointer;
  transition: color 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

/* ---------- helpers ---------- */

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  disabled?: boolean;
  badge?: number;
}

function NavItem({ entry, mode }: { entry: NavEntry; mode: SidebarMode }) {
  const showLabel = mode === "expanded";

  if (entry.disabled) {
    return (
      <DisabledNavItem $mode={mode} title={entry.label}>
        <IconWrap>
          <entry.icon size={ICON_SIZE} />
        </IconWrap>
        <Label $visible={showLabel}>{entry.label}</Label>
      </DisabledNavItem>
    );
  }

  return (
    <StyledLink to={entry.to} end={entry.end} $mode={mode} title={entry.label}>
      <IconWrap>
        <entry.icon size={ICON_SIZE} />
        {entry.badge != null && entry.badge > 0 && mode === "icons" && <NotifDot />}
      </IconWrap>
      <Label $visible={showLabel}>{entry.label}</Label>
      {entry.badge != null && entry.badge > 0 && mode === "expanded" && (
        <NotifBadge>{entry.badge}</NotifBadge>
      )}
    </StyledLink>
  );
}

/* ---------- component ---------- */

export function Sidebar({ mode, toggle }: SidebarProps) {
  const { characterId, tribeCaps } = useIdentity();
  const { unreadCount } = useNotifications();
  const userTribeId = tribeCaps[0]?.tribeId;

  const mainEntries: NavEntry[] = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    {
      to: userTribeId ? `/tribe/${userTribeId}` : "#",
      label: "My Tribe",
      icon: Shield,
      disabled: !userTribeId,
    },
    {
      to: characterId ? `/structures/${characterId}` : "/structures",
      label: "My Structures",
      icon: Building2,
    },
    { to: "/contracts", label: "Contracts", icon: FileText },
    { to: "/forge", label: "Forge Planner", icon: Hammer },
    { to: "/continuity", label: "Continuity", icon: Cpu },
    {
      to: "/locations",
      label: "Locations",
      icon: MapPin,
      disabled: !userTribeId,
    },
  ];

  const systemEntries: NavEntry[] = [
    { to: "/verify", label: "Verify Proof", icon: ShieldCheck },
    { to: "/events", label: "Event Explorer", icon: Activity },
    {
      to: "/notifications",
      label: "Notifications",
      icon: Bell,
      badge: unreadCount,
    },
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  if (mode === "hidden") {
    return null;
  }

  return (
    <Nav $mode={mode}>
      {mainEntries.map((e) => (
        <NavItem key={e.to + e.label} entry={e} mode={mode} />
      ))}

      <Spacer />
      <SectionLabel $visible={mode === "expanded"}>System</SectionLabel>
      {systemEntries.map((e) => (
        <NavItem key={e.to} entry={e} mode={mode} />
      ))}

      <ToggleButton
        onClick={toggle}
        title={mode === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
      >
        {mode === "expanded" ? (
          <ChevronsLeft size={ICON_SIZE} />
        ) : (
          <ChevronsRight size={ICON_SIZE} />
        )}
      </ToggleButton>
    </Nav>
  );
}

/** Floating button rendered in the Header when sidebar is completely hidden */
export function SidebarOpenButton({ onClick }: { onClick: () => void }) {
  return (
    <ToggleButton onClick={onClick} title="Open sidebar">
      <Menu size={ICON_SIZE} />
    </ToggleButton>
  );
}
