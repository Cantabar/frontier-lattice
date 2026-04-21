import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "styled-components";
import { theme } from "../../styles/theme";
import { CollapsibleSummary } from "./CollapsibleSummary";

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUMMARY_KEY = "frontier-corm:structures-summary-collapsed";

const DEFAULT_PROPS = {
  totalCount: 10,
  onlineCount: 7,
  offlineCount: 3,
  nodeCount: 2,
  energyReserved: 400,
  energyMax: 2000,
  cormEnabledCount: 4,
  totalSsuCount: 5,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CollapsibleSummary", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the summary body visible by default when no localStorage key is present", () => {
    renderWithTheme(<CollapsibleSummary {...DEFAULT_PROPS} />);

    expect(screen.getByTestId("summary-body")).toBeVisible();
  });

  it("hides the summary body after the toggle button is clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(<CollapsibleSummary {...DEFAULT_PROPS} />);

    await user.click(screen.getByRole("button", { name: /collapse|toggle/i }));

    expect(screen.getByTestId("summary-body")).not.toBeVisible();
  });

  it("renders the summary body hidden when localStorage key is pre-set to collapsed", () => {
    localStorage.setItem(SUMMARY_KEY, "true");

    renderWithTheme(<CollapsibleSummary {...DEFAULT_PROPS} />);

    expect(screen.getByTestId("summary-body")).not.toBeVisible();
  });
});
