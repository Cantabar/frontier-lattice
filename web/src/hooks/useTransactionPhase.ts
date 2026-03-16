import { useState, useMemo } from "react";
import type { TransactionStep } from "../components/shared/TransactionStepper";

export interface UseTransactionPhaseResult {
  /** Current phase key, or `null` when idle. */
  phase: string | null;
  /** Set the active phase (pass `null` to reset to idle). */
  setPhase: (phase: string | null) => void;
  /** `true` when a phase is active (i.e. phase !== null). */
  isBusy: boolean;
  /** Human-readable label for the current phase, or `""` when idle. */
  phaseLabel: string;
}

/**
 * Tiny state helper for driving a `TransactionStepper`.
 *
 * @param steps — the same step definitions passed to `<TransactionStepper>`.
 */
export function useTransactionPhase(steps: TransactionStep[]): UseTransactionPhaseResult {
  const [phase, setPhase] = useState<string | null>(null);

  const labelMap = useMemo(
    () => new Map(steps.map((s) => [s.key, s.label])),
    [steps],
  );

  return {
    phase,
    setPhase,
    isBusy: phase !== null,
    phaseLabel: phase ? labelMap.get(phase) ?? "" : "",
  };
}
