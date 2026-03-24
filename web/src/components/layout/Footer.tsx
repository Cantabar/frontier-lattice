import styled from "styled-components";

const FooterBar = styled.footer`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  background: ${({ theme }) => theme.colors.surface.raised};
  border-top: 2px solid transparent;
  border-image: linear-gradient(
    90deg,
    transparent 0%,
    ${({ theme }) => theme.colors.rust.muted} 60%,
    ${({ theme }) => theme.colors.rust.main} 100%
  ) 1;
  flex-shrink: 0;
`;

const Disclaimer = styled.span`
  font-size: 11px;
  font-family: ${({ theme }) => theme.fonts.mono};
  color: ${({ theme }) => theme.colors.text.muted};
  opacity: 0.7;
`;

export function Footer() {
  return (
    <FooterBar>
      <Disclaimer>
        This is an independent player-made project. Not affiliated with or
        endorsed by CCP Games.
      </Disclaimer>
    </FooterBar>
  );
}
