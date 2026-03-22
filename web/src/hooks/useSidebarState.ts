import { useState, useEffect, useCallback } from "react";
import { theme } from "../styles/theme";

export type SidebarMode = "expanded" | "icons" | "hidden";

function modeFromWidth(width: number): SidebarMode {
  if (width < theme.breakpoints.sm) return "hidden";
  if (width < theme.breakpoints.md) return "icons";
  return "expanded";
}

export function useSidebarState() {
  const [mode, setMode] = useState<SidebarMode>(() =>
    modeFromWidth(window.innerWidth),
  );

  // Track whether user has manually overridden
  const [userOverride, setUserOverride] = useState(false);

  useEffect(() => {
    const onResize = () => {
      if (!userOverride) {
        setMode(modeFromWidth(window.innerWidth));
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [userOverride]);

  // Reset user override when the breakpoint band changes
  useEffect(() => {
    let prev = modeFromWidth(window.innerWidth);
    const onResize = () => {
      const next = modeFromWidth(window.innerWidth);
      if (next !== prev) {
        prev = next;
        setUserOverride(false);
        setMode(next);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggle = useCallback(() => {
    setUserOverride(true);
    setMode((m) => (m === "expanded" ? "icons" : "expanded"));
  }, []);

  return { mode, toggle } as const;
}
