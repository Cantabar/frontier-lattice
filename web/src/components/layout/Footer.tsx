import styled from "styled-components";

const FooterBar = styled.footer`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  background: ${({ theme }) => theme.colors.surface.raised};
  border-top: 1px solid ${({ theme }) => theme.colors.surface.border};
  flex-shrink: 0;
`;

const Disclaimer = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
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
