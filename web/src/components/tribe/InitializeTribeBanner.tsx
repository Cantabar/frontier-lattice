import { useState, useEffect } from "react";
import styled from "styled-components";
import { useInitializeTribe } from "../../hooks/useInitializeTribe";

const Banner = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  background: ${({ theme }) => theme.colors.warning}11;
  border-bottom: 1px solid ${({ theme }) => theme.colors.warning};
`;

const Message = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const TribeId = styled.strong`
  color: ${({ theme }) => theme.colors.warning};
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  flex-shrink: 0;
`;

const NameInput = styled.input`
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 13px;
  width: 180px;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const InitButton = styled.button`
  background: ${({ theme }) => theme.colors.warning};
  color: ${({ theme }) => theme.colors.surface.bg};
  border: none;
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const DismissButton = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;

  &:hover {
    color: ${({ theme }) => theme.colors.text.secondary};
  }
`;

/**
 * Banner rendered at the top of the app when the user's in-game Character
 * belongs to a tribe that has NOT been initialized on-chain yet.
 * Complements AutoJoinBanner (which handles existing on-chain tribes).
 */
export function InitializeTribeBanner() {
  const {
    needsInit,
    inGameTribeId,
    suggestedName,
    isInitializing,
    isLoading,
    initialize,
  } = useInitializeTribe();
  const [dismissed, setDismissed] = useState(false);
  const [name, setName] = useState("");

  // Pre-fill name when suggestedName becomes available
  useEffect(() => {
    if (suggestedName && !name) {
      setName(suggestedName);
    }
  }, [suggestedName, name]);

  if (!needsInit || dismissed || isLoading) return null;

  return (
    <Banner>
      <Message>
        Your tribe (<TribeId>#{inGameTribeId}</TribeId>) hasn't been
        initialized on-chain yet. Create it to unlock tribe features.
      </Message>
      <Actions>
        <NameInput
          type="text"
          placeholder="Tribe name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && initialize(name)}
          disabled={isInitializing}
        />
        <InitButton
          onClick={() => initialize(name)}
          disabled={isInitializing || !name.trim()}
        >
          {isInitializing ? "Initializing…" : "Initialize Tribe"}
        </InitButton>
        <DismissButton onClick={() => setDismissed(true)} title="Dismiss">
          ×
        </DismissButton>
      </Actions>
    </Banner>
  );
}
