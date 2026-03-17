import styled from "styled-components";
import { ConnectButton } from "@mysten/dapp-kit";

/**
 * ConnectButton wrapped in a styled div that overrides dapp-kit's default button
 * styles so the wallet button matches the app's "Rooted Trust" palette.
 *
 * The dapp-kit CSS import is kept in main.tsx because it also controls the
 * wallet-selection modal and connected-account dropdown — only the trigger
 * button visuals are overridden here.
 */
const Wrapper = styled.div`
  /* ── Disconnected / "Connect Wallet" button ─────────────────────────── */
  button[data-dapp-kit] {
    background: ${({ theme }) => theme.colors.primary.main};
    color: ${({ theme }) => theme.colors.button.primaryText};
    border: none;
    border-radius: ${({ theme }) => theme.radii.sm};
    font-family: ${({ theme }) => theme.fonts.body};
    font-size: 13px;
    font-weight: 600;
    padding: 6px 14px;
    cursor: pointer;
    transition: background 0.15s;

    &:hover {
      background: ${({ theme }) => theme.colors.primary.hover};
    }
  }

  /* ── Connected / account button ─────────────────────────────────────── */
  button[data-dapp-kit="connected-button"] {
    background: ${({ theme }) => theme.colors.surface.raised};
    color: ${({ theme }) => theme.colors.text.primary};
    border: 1px solid ${({ theme }) => theme.colors.surface.border};
    border-radius: ${({ theme }) => theme.radii.sm};
    font-family: ${({ theme }) => theme.fonts.body};
    font-size: 13px;
    font-weight: 500;
    padding: 5px 12px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;

    &:hover {
      border-color: ${({ theme }) => theme.colors.primary.main};
      background: ${({ theme }) => theme.colors.surface.overlay};
    }
  }
`;

export function WalletButton() {
  return (
    <Wrapper>
      <ConnectButton />
    </Wrapper>
  );
}
