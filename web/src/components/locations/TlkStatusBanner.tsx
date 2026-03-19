/**
 * Banner shown at the top of the Locations page indicating TLK status.
 *
 * States:
 *   - Not initialized → prompt officers to set up encryption
 *   - Active → shows version, green indicator
 *   - Key unlocked → shows that decryption is available this session
 */

import styled from "styled-components";
import { PrimaryButton } from "../shared/Button";

// ============================================================
// Styled primitives
// ============================================================

const Banner = styled.div<{ $variant: "info" | "success" | "warning" }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  border-radius: ${({ theme }) => theme.radii.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  font-size: 13px;
  border: 1px solid
    ${({ $variant, theme }) => {
      if ($variant === "success") return theme.colors.success;
      if ($variant === "warning") return theme.colors.warning;
      return theme.colors.primary.main;
    }}44;
  background: ${({ $variant, theme }) => {
    if ($variant === "success") return `${theme.colors.success}11`;
    if ($variant === "warning") return `${theme.colors.warning}11`;
    return `${theme.colors.primary.main}11`;
  }};
`;

const Dot = styled.span<{ $color: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${({ $color }) => $color};
`;

const Text = styled.span`
  flex: 1;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const VersionLabel = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  font-family: ${({ theme }) => theme.fonts.mono};
`;

// ============================================================
// Component
// ============================================================

interface Props {
  isInitialized: boolean;
  hasWrappedKey: boolean;
  tlkVersion: number | null;
  isUnlocked: boolean;
  isOfficer: boolean;
  isLoading: boolean;
  onInitialize: () => void;
  onUnlock: () => void;
  unlockLoading: boolean;
}

export function TlkStatusBanner({
  isInitialized,
  hasWrappedKey,
  tlkVersion,
  isUnlocked,
  isOfficer,
  isLoading,
  onInitialize,
  onUnlock,
  unlockLoading,
}: Props) {
  if (!isInitialized) {
    return (
      <Banner $variant="warning">
        <Dot $color="var(--color-warning, #f0ad4e)" />
        <Text>
          Location encryption has not been set up for this Tribe.
          {isOfficer
            ? " Initialize the Tribe Location Key to enable encrypted location sharing."
            : " Ask an officer to initialize the Tribe Location Key."}
        </Text>
        {isOfficer && (
          <PrimaryButton onClick={onInitialize} disabled={isLoading}>
            {isLoading ? "Initializing…" : "Initialize TLK"}
          </PrimaryButton>
        )}
      </Banner>
    );
  }

  if (isUnlocked) {
    return (
      <Banner $variant="success">
        <Dot $color="var(--color-success, #5cb85c)" />
        <Text>Encryption key unlocked — locations are decrypted for this session.</Text>
        {tlkVersion != null && <VersionLabel>TLK v{tlkVersion}</VersionLabel>}
      </Banner>
    );
  }

  if (!hasWrappedKey) {
    return (
      <Banner $variant="info">
        <Dot $color="var(--color-primary, #00d4ff)" />
        <Text>
          Tribe Location Key is active. Unlock to register your key and request access from an
          existing member.
        </Text>
        {tlkVersion != null && <VersionLabel>TLK v{tlkVersion}</VersionLabel>}
        <PrimaryButton onClick={onUnlock} disabled={unlockLoading}>
          {unlockLoading ? "Unlocking…" : "Unlock TLK"}
        </PrimaryButton>
      </Banner>
    );
  }

  return (
    <Banner $variant="info">
      <Dot $color="var(--color-primary, #00d4ff)" />
      <Text>
        Tribe Location Key is initialized. Unlock to view and register encrypted locations.
      </Text>
      {tlkVersion != null && <VersionLabel>TLK v{tlkVersion}</VersionLabel>}
      <PrimaryButton onClick={onUnlock} disabled={unlockLoading}>
        {unlockLoading ? "Unlocking…" : "Unlock TLK"}
      </PrimaryButton>
    </Banner>
  );
}
