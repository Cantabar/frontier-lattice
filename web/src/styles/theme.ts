/**
 * Frontier Corm design tokens.
 *
 * "Rooted Trust" palette — cyan primary, violet accents, cold-gray surfaces.
 * Scuffed with post-apocalyptic grit: harsh corners, industrial fonts,
 * rust accents, and weathered surface tones.
 */

export const theme = {
  colors: {
    primary: {
      main: "#00E5FF", // electric cyan — buttons, active states
      hover: "#00B8D4", // deeper cyan — hover
      muted: "#80F0FF", // soft cyan — secondary text, tags
      subtle: "#0D3B4A", // dark teal — borders, card accents, selection
    },
    secondary: {
      accent: "#7C4DFF", // electric violet — special badges, zkProof indicators
      accentMuted: "#4A2D99", // subdued violet — section highlights
    },
    rust: {
      main: "#BF5B3F", // corroded orange — hazard accents
      muted: "#7A3D2A", // subdued rust — subtle marks
    },
    surface: {
      bg: "#0B0E11", // deep void — page background
      raised: "#13171D", // dark slate with faint warmth — cards, panels
      overlay: "#1C2330", // modal / dropdown background
      border: "#2D3038", // warm steel — borders
      borderHover: "#3B4556", // lighter steel — border hover
      muted: "#4A5568", // disabled elements
      scratched: "#1A1E25", // alternate panel striping
    },
    text: {
      primary: "#F0F4F8", // cool white — headings
      secondary: "#B0BEC5", // blue-gray — body text
      muted: "#78909C", // subdued blue-gray — timestamps
      disabled: "#546E7A", // placeholder text
    },
    danger: "#FF5252",
    warning: "#FFD740",
    success: "#69F0AE",
    /** Module badge colors — cooler palette coding */
    module: {
      tribe: "#00E5FF",
      forge: "#69F0AE",
      trustlessContracts: "#7C4DFF",
    },
    /** Item tier / meta-group badge colors */
    tier: {
      basic: "#666666",
      standard: "#b0b0b0",
      enhanced: "#4caf50",
      prototype: "#42a5f5",
      experimental: "#ab47bc",
      exotic: "#ffd740",
    },
    button: {
      primaryText: "#0F1318", // dark near-black — readable on cyan (10.8:1 contrast)
    },
  },
  fonts: {
    heading: '"Rajdhani", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    body: '"Share Tech Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  radii: {
    sm: "0px",
    md: "2px",
    lg: "3px",
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "32px",
    xxl: "48px",
  },
  breakpoints: {
    /** Below sm: sidebar hidden */
    sm: 768,
    /** Between sm and md: sidebar icons only; above md: fully expanded */
    md: 1024,
    /** Below lg: structure rows wrap to two lines */
    lg: 1200,
  },
  sidebar: {
    expandedWidth: 200,
    iconWidth: 56,
  },
} as const;

export type AppTheme = typeof theme;
