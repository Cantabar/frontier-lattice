/**
 * EVE Frontier design tokens.
 *
 * Colors extracted from docs.evefrontier.com CSS custom properties.
 * Dark-mode-first, warm-gray industrial palette with burnt orange accents.
 */

export const theme = {
  colors: {
    primary: {
      main: "#FF4700", // rgb(255, 71, 0)  — buttons, active states
      hover: "#FC4400", // rgb(252, 68, 0)  — hover
      muted: "#F5AB98", // rgb(245, 171, 152) — secondary text
      subtle: "#633529", // rgb(99, 53, 41)  — subtle borders / card accents
    },
    surface: {
      bg: "#1D1D1D", // rgb(29, 29, 29)  — page background
      raised: "#232222", // rgb(35, 34, 34)  — cards, panels
      overlay: "#2D2B2B", // rgb(45, 43, 43)  — modals, dropdowns
      border: "#3C3837", // rgb(60, 56, 55)  — borders
      borderHover: "#474241", // rgb(71, 66, 65) — border hover
      muted: "#524C4B", // rgb(82, 76, 75)  — disabled elements
    },
    text: {
      primary: "#FFFFFE", // rgb(255, 255, 254) — headings
      secondary: "#C6BEBC", // rgb(198, 190, 188) — body text
      muted: "#9E8C87", // rgb(158, 140, 135) — timestamps
      disabled: "#9E7B72", // rgb(158, 123, 114) — placeholders
    },
    danger: "#FB2C36", // rgb(251, 44, 54)
    warning: "#FFB651", // rgb(255, 182, 81)
    success: "#FAFAE5", // rgb(250, 250, 229)
    /** Module badge colors for event-type coding */
    module: {
      tribe: "#FF4700",
      contractBoard: "#4FC3F7",
      forgePlanner: "#81C784",
      trustlessContracts: "#FFB651",
    },
  },
  fonts: {
    body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  radii: {
    sm: "4px",
    md: "8px",
    lg: "12px",
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "32px",
    xxl: "48px",
  },
} as const;

export type AppTheme = typeof theme;
