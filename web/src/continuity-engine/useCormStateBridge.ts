/**
 * useCormStateBridge — bridges on-chain CormState to the puzzle-service iframe.
 *
 * Watches values from `useCormState` and posts `corm-state-sync` messages
 * to the iframe whenever phase, stability, or corruption change.
 */

import { useEffect, useRef, type RefObject } from "react";
import { useCormState, type CormStateData } from "./useCormState";
import { config } from "../config";

export function useCormStateBridge(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  objectId?: string,
) {
  const { cormState } = useCormState(objectId);
  const prevRef = useRef<CormStateData | null>(null);

  useEffect(() => {
    if (!cormState) return;

    const prev = prevRef.current;
    const changed =
      !prev ||
      prev.phase !== cormState.phase ||
      prev.stability !== cormState.stability ||
      prev.corruption !== cormState.corruption;

    if (!changed) return;

    prevRef.current = cormState;

    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    // Derive the target origin from the puzzle-service URL
    let targetOrigin: string;
    try {
      targetOrigin = new URL(config.puzzleServiceUrl).origin;
    } catch {
      targetOrigin = "*";
    }

    iframe.contentWindow.postMessage(
      {
        type: "corm-state-sync",
        phase: cormState.phase,
        stability: cormState.stability,
        corruption: cormState.corruption,
      },
      targetOrigin,
    );
  }, [cormState, iframeRef]);
}
