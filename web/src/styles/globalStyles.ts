import { createGlobalStyle } from "styled-components";

export const GlobalStyles = createGlobalStyle`
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Share+Tech+Mono&display=swap');

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html, body, #root {
    height: 100%;
  }

  body {
    font-family: ${({ theme }) => theme.fonts.body};
    background:
      /* circuit-like grid lines using border token */
      linear-gradient(${({ theme }) => theme.colors.surface.border}40 1px, transparent 1px),
      linear-gradient(90deg, ${({ theme }) => theme.colors.surface.border}40 1px, transparent 1px),
      /* base void */
      ${({ theme }) => theme.colors.surface.bg};
    background-size: 40px 40px, 40px 40px;
    color: ${({ theme }) => theme.colors.text.secondary};
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    position: relative;
  }

  /* ── Noise grain overlay ── */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 9999;
    pointer-events: none;
    opacity: 0.03;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-repeat: repeat;
  }

  /* ── CRT scanline overlay ── */
  body::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 9998;
    pointer-events: none;
    opacity: 0.018;
    background: repeating-linear-gradient(
      to bottom,
      transparent 0px,
      transparent 2px,
      rgba(255, 255, 255, 0.04) 2px,
      rgba(255, 255, 255, 0.04) 3px
    );
  }

  /* ── Edge vignette ── */
  #root {
    box-shadow: inset 0 0 120px rgba(0, 0, 0, 0.5);
  }

  /* ── Ghost presence: breathing glow ── */
  #root::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: radial-gradient(
      ellipse at 50% 30%,
      rgba(0, 229, 255, 0.06) 0%,
      transparent 70%
    );
    animation: ghostBreathe 8s ease-in-out infinite;
  }

  /* ── Ghost presence: phantom scan ── */
  #root::after {
    content: "";
    position: fixed;
    left: 0;
    right: 0;
    height: 120px;
    top: -120px;
    z-index: 9997;
    pointer-events: none;
    background: linear-gradient(
      to bottom,
      transparent,
      rgba(0, 229, 255, 0.03) 50%,
      transparent
    );
    animation: phantomScan 14s linear infinite;
  }

  /* ── Headings use industrial font ── */
  h1, h2, h3, h4, h5, h6 {
    font-family: ${({ theme }) => theme.fonts.heading};
    letter-spacing: 0.02em;
  }

  a {
    color: ${({ theme }) => theme.colors.primary.main};
    text-decoration: none;

    &:hover {
      color: ${({ theme }) => theme.colors.primary.hover};
    }
  }

  button {
    cursor: pointer;
    font-family: inherit;
  }

  code, pre {
    font-family: ${({ theme }) => theme.fonts.mono};
  }

  ::selection {
    background: ${({ theme }) => theme.colors.rust.muted};
    color: ${({ theme }) => theme.colors.text.primary};
  }

  /* ── Industrial scrollbars ── */
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: ${({ theme }) => theme.colors.surface.bg};
  }
  ::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.surface.border};
    border-radius: 0;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: ${({ theme }) => theme.colors.surface.borderHover};
  }

  /* ── Reusable glitch flicker ── */
  @keyframes glitch {
    0%, 90%, 100% { opacity: 1; transform: translate(0); }
    92% { opacity: 0.8; transform: translate(-1px, 0); }
    94% { opacity: 1; transform: translate(1px, 0); }
    96% { opacity: 0.9; transform: translate(0, 1px); }
  }

  /* ── Power flicker for logo / key elements ── */
  @keyframes powerFlicker {
    0%, 88%, 92%, 96%, 100% { opacity: 1; }
    90% { opacity: 0.94; }
    94% { opacity: 0.97; }
  }

  /* ── Terminal pulse for loading states ── */
  @keyframes terminalPulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }

  /* ── Ghost presence: breathing glow ── */
  @keyframes ghostBreathe {
    0%, 100% { opacity: 0.3; transform: scale(1); }
    50%       { opacity: 1;   transform: scale(1.15); }
  }

  /* ── Ghost presence: phantom scan sweep ── */
  @keyframes phantomScan {
    0%   { top: -120px; }
    100% { top: calc(100vh + 120px); }
  }
`;
