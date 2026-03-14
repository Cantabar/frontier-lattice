/**
 * Toast notification overlay.
 *
 * Renders a fixed-position container in the bottom-right corner that
 * auto-shows new (undismissed) notifications. Info/warning toasts
 * auto-dismiss after 8 seconds; errors persist until manually closed.
 */

import { useEffect, useRef, useState } from "react";
import styled, { keyframes, css } from "styled-components";
import { useNotifications, type SessionNotification } from "../../hooks/useNotifications";

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

const slideIn = keyframes`
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
`;

const fadeOut = keyframes`
  from { opacity: 1; }
  to   { opacity: 0; }
`;

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Container = styled.div`
  position: fixed;
  bottom: ${({ theme }) => theme.spacing.lg};
  right: ${({ theme }) => theme.spacing.lg};
  display: flex;
  flex-direction: column-reverse;
  gap: ${({ theme }) => theme.spacing.sm};
  z-index: 200;
  max-height: 60vh;
  overflow: hidden;
  pointer-events: none;
`;

const levelColor = (level: string, theme: { colors: { danger: string; warning: string; primary: { main: string } } }) => {
  switch (level) {
    case "error":
      return theme.colors.danger;
    case "warning":
      return theme.colors.warning;
    default:
      return theme.colors.primary.main;
  }
};

const ToastItem = styled.div<{ $level: string; $exiting: boolean }>`
  pointer-events: auto;
  min-width: 320px;
  max-width: 420px;
  background: ${({ theme }) => theme.colors.surface.overlay};
  border: 1px solid ${({ $level, theme }) => levelColor($level, theme)};
  border-left: 4px solid ${({ $level, theme }) => levelColor($level, theme)};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  cursor: pointer;
  animation: ${({ $exiting }) =>
    $exiting
      ? css`${fadeOut} 0.25s ease forwards`
      : css`${slideIn} 0.3s ease`};
`;

const ToastHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
`;

const ToastTitle = styled.span<{ $level: string }>`
  font-size: 13px;
  font-weight: 600;
  color: ${({ $level, theme }) => levelColor($level, theme)};
`;

const CloseBtn = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const ToastMessage = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
  line-height: 1.4;
`;

// ---------------------------------------------------------------------------
// Auto-dismiss tracking per toast
// ---------------------------------------------------------------------------

const AUTO_DISMISS_MS = 8_000;

function ToastEntry({ notification }: { notification: SessionNotification }) {
  const { dismiss } = useNotifications();
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (notification.level === "error") return; // errors stay until clicked
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => dismiss(notification.id), 250);
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notification.id, notification.level, dismiss]);

  function handleClick() {
    setExiting(true);
    setTimeout(() => dismiss(notification.id), 250);
  }

  return (
    <ToastItem $level={notification.level} $exiting={exiting} onClick={handleClick}>
      <ToastHeader>
        <ToastTitle $level={notification.level}>
          {notification.level === "error" ? "Error" : notification.level === "warning" ? "Warning" : "Info"}
          {" — "}
          {notification.title}
        </ToastTitle>
        <CloseBtn onClick={handleClick}>&times;</CloseBtn>
      </ToastHeader>
      <ToastMessage>{notification.message}</ToastMessage>
    </ToastItem>
  );
}

// ---------------------------------------------------------------------------
// Container — only shows the 5 most recent undismissed notifications
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 5;

export function ToastContainer() {
  const { notifications } = useNotifications();
  const seenRef = useRef(new Set<string>());

  // Only show notifications that appeared *after* mount (avoid replaying old ones).
  const [visibleIds, setVisibleIds] = useState<string[]>([]);

  useEffect(() => {
    const newIds: string[] = [];
    for (const n of notifications) {
      if (!n.dismissed && !seenRef.current.has(n.id)) {
        seenRef.current.add(n.id);
        newIds.push(n.id);
      }
    }
    if (newIds.length > 0) {
      setVisibleIds((prev) => [...prev, ...newIds]);
    }
  }, [notifications]);

  // Build list of undismissed notifications that are in our visible set
  const active = notifications.filter(
    (n) => !n.dismissed && visibleIds.includes(n.id),
  );
  const shown = active.slice(-MAX_VISIBLE);

  if (shown.length === 0) return null;

  return (
    <Container>
      {shown.map((n) => (
        <ToastEntry key={n.id} notification={n} />
      ))}
    </Container>
  );
}
