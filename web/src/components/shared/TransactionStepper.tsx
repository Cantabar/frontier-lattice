import styled, { keyframes } from "styled-components";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransactionStep {
  key: string;
  label: string;
}

export interface TransactionStepperProps {
  /** Ordered list of steps to display. */
  steps: TransactionStep[];
  /** Key of the currently active step, or `null` to hide the stepper. */
  currentStep: string | null;
}

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`;

const StepperWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.xs};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const StepDot = styled.div<{ $state: "done" | "active" | "pending" }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${({ $state, theme }) =>
    $state === "done"
      ? theme.colors.primary.main
      : $state === "active"
        ? theme.colors.primary.main
        : theme.colors.surface.border};
  animation: ${({ $state }) => ($state === "active" ? pulse : "none")} 1.2s ease-in-out infinite;
`;

const StepConnector = styled.div<{ $done: boolean }>`
  width: 24px;
  height: 2px;
  background: ${({ $done, theme }) =>
    $done ? theme.colors.primary.main : theme.colors.surface.border};
`;

const StepLabel = styled.span<{ $active: boolean }>`
  font-size: 11px;
  font-weight: ${({ $active }) => ($active ? 600 : 400)};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.text.primary : theme.colors.text.muted};
  white-space: nowrap;
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A generic multi-step progress indicator for SUI transactions.
 *
 * Renders nothing when `currentStep` is `null`.
 */
export function TransactionStepper({ steps, currentStep }: TransactionStepperProps) {
  if (currentStep === null) return null;

  const activeIdx = steps.findIndex((s) => s.key === currentStep);

  return (
    <StepperWrapper>
      {steps.map((step, i) => {
        const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
        return (
          <span key={step.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <StepConnector $done={i <= activeIdx} />}
            <StepDot $state={state} />
            <StepLabel $active={state === "active"}>{step.label}</StepLabel>
          </span>
        );
      })}
    </StepperWrapper>
  );
}
