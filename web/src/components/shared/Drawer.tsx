import { useEffect, useState, type ReactNode } from "react";
import styled, { keyframes } from "styled-components";

const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 100;
  animation: ${fadeIn} 0.15s ease;
`;

const Panel = styled.div<{ $open: boolean }>`
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: 420px;
  max-width: 100vw;
  background: ${({ theme }) => theme.colors.surface.overlay};
  border-left: 1px solid ${({ theme }) => theme.colors.surface.border};
  display: flex;
  flex-direction: column;
  z-index: 101;
  transform: translateX(${({ $open }) => ($open ? "0" : "100%")});
  transition: transform 0.25s ease;
`;

const DrawerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surface.border};
  flex-shrink: 0;
`;

const DrawerTitle = styled.h2`
  font-size: 18px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 20px;
  line-height: 1;
  padding: ${({ theme }) => theme.spacing.xs};
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const DrawerBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.lg};
`;

export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Trigger slide-in on mount
  useEffect(() => {
    // requestAnimationFrame ensures the initial translateX(100%) is painted first
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <>
      <Overlay onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} />
      <Panel $open={open}>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <CloseButton onClick={onClose}>&times;</CloseButton>
        </DrawerHeader>
        <DrawerBody>{children}</DrawerBody>
      </Panel>
    </>
  );
}
