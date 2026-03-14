/**
 * Full session notification log.
 *
 * Displays every notification pushed during the current browser session,
 * with filters by level and a "Clear All" action.
 */

import { useState } from "react";
import styled from "styled-components";
import { useNotifications, type NotificationLevel } from "../hooks/useNotifications";
import { timeAgo } from "../lib/format";

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Page = styled.div`
  max-width: 720px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const ClearButton = styled.button`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    border-color: ${({ theme }) => theme.colors.danger};
    color: ${({ theme }) => theme.colors.danger};
  }
`;

const Filters = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const FilterChip = styled.button<{ $active: boolean }>`
  background: ${({ $active, theme }) =>
    $active ? theme.colors.surface.overlay : "transparent"};
  border: 1px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.primary.main : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const levelBorderColor = (level: NotificationLevel) => {
  switch (level) {
    case "error":
      return "danger";
    case "warning":
      return "warning";
    default:
      return "primary.main";
  }
};

const Row = styled.div<{ $level: NotificationLevel; $dismissed: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-left: 4px solid
    ${({ $level, theme }) => {
      switch ($level) {
        case "error":
          return theme.colors.danger;
        case "warning":
          return theme.colors.warning;
        default:
          return theme.colors.primary.main;
      }
    }};
  border-radius: ${({ theme }) => theme.radii.sm};
  opacity: ${({ $dismissed }) => ($dismissed ? 0.5 : 1)};
`;

const Badge = styled.span<{ $level: NotificationLevel }>`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
  margin-top: 1px;
  background: ${({ $level, theme }) => {
    switch ($level) {
      case "error":
        return `${theme.colors.danger}22`;
      case "warning":
        return `${theme.colors.warning}22`;
      default:
        return `${theme.colors.primary.main}22`;
    }
  }};
  color: ${({ $level, theme }) => {
    switch ($level) {
      case "error":
        return theme.colors.danger;
      case "warning":
        return theme.colors.warning;
      default:
        return theme.colors.primary.main;
    }
  }};
`;

const Body = styled.div`
  flex: 1;
  min-width: 0;
`;

const NotifTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const NotifMessage = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
  line-height: 1.4;
  margin-top: 2px;
`;

const Meta = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: 4px;
`;

const EmptyText = styled.div`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xxl};
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 14px;
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ALL_LEVELS: NotificationLevel[] = ["error", "warning", "info"];

export function NotificationsPage() {
  const { notifications, dismissAll } = useNotifications();
  const [activeFilter, setActiveFilter] = useState<NotificationLevel | "all">("all");

  const filtered =
    activeFilter === "all"
      ? notifications
      : notifications.filter((n) => n.level === activeFilter);

  // Most recent first
  const sorted = [...filtered].reverse();

  return (
    <Page>
      <Header>
        <Title>Notifications</Title>
        {notifications.length > 0 && (
          <ClearButton onClick={dismissAll}>Dismiss All</ClearButton>
        )}
      </Header>

      <Filters>
        <FilterChip $active={activeFilter === "all"} onClick={() => setActiveFilter("all")}>
          All ({notifications.length})
        </FilterChip>
        {ALL_LEVELS.map((level) => {
          const count = notifications.filter((n) => n.level === level).length;
          return (
            <FilterChip
              key={level}
              $active={activeFilter === level}
              onClick={() => setActiveFilter(level)}
            >
              {level} ({count})
            </FilterChip>
          );
        })}
      </Filters>

      {sorted.length === 0 ? (
        <EmptyText>No notifications yet.</EmptyText>
      ) : (
        <List>
          {sorted.map((n) => (
            <Row key={n.id} $level={n.level} $dismissed={n.dismissed}>
              <Badge $level={n.level}>{n.level}</Badge>
              <Body>
                <NotifTitle>{n.title}</NotifTitle>
                <NotifMessage>{n.message}</NotifMessage>
                <Meta>
                  <span>{timeAgo(n.timestamp)}</span>
                  <span>{n.source}</span>
                </Meta>
              </Body>
            </Row>
          ))}
        </List>
      )}
    </Page>
  );
}
