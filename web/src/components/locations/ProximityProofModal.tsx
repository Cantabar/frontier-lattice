/**
 * Modal for generating proximity ZK proofs for location PODs.
 *
 * The user specifies a reference point (x, y, z) and a maximum distance.
 * Groth16 proofs are generated in-browser for all owned, non-derived PODs,
 * attesting that each structure is within the specified distance of the
 * reference point — without revealing the structure's coordinates.
 *
 * This is for single-structure proximity proofs. For two-structure mutual
 * proximity proofs, see MutualProximityProofModal.
 */

import { useState, useMemo } from "react";
import styled from "styled-components";
import { Modal } from "../shared/Modal";
import { PrimaryButton, SecondaryButton } from "../shared/Button";
import { useZkLocationFilter } from "../../hooks/useZkLocationFilter";
import type { DecryptedPod } from "../../hooks/useLocationPods";

// ============================================================
// Styled primitives
// ============================================================

const Label = styled.label`
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const Input = styled.input`
  width: 100%;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;
  font-family: ${({ theme }) => theme.fonts.mono};
  margin-bottom: ${({ theme }) => theme.spacing.md};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const InputRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const InputLabel = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: 2px;
  display: block;
`;

const Summary = styled.div`
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};

  & > div {
    display: flex;
    justify-content: space-between;
    padding: 2px 0;
  }
`;

const SummaryLabel = styled.span`
  color: ${({ theme }) => theme.colors.text.muted};
`;

const SummaryValue = styled.span`
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const Hint = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  justify-content: flex-end;
`;

const ErrorText = styled.div`
  color: ${({ theme }) => theme.colors.danger};
  font-size: 12px;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const SuccessText = styled.div`
  color: ${({ theme }) => theme.colors.success};
  font-size: 13px;
  font-weight: 500;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

// ============================================================
// Types
// ============================================================

type Step = "select" | "confirm" | "done";

interface Props {
  tribeId: string;
  pods: DecryptedPod[];
  onClose: () => void;
  onSuccess: () => void;
}

// ============================================================
// Helpers
// ============================================================

/** Euclidean distance from a pod to a reference point. */
function distanceTo(
  pod: DecryptedPod,
  refX: number,
  refY: number,
  refZ: number,
): number {
  const dx = pod.location.x - refX;
  const dy = pod.location.y - refY;
  const dz = pod.location.z - refZ;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ============================================================
// Component
// ============================================================

export function ProximityProofModal({
  tribeId,
  pods,
  onClose,
  onSuccess,
}: Props) {
  const { proveProximity, isProving } = useZkLocationFilter();

  const [step, setStep] = useState<Step>("select");
  const [refX, setRefX] = useState("");
  const [refY, setRefY] = useState("");
  const [refZ, setRefZ] = useState("");
  const [maxDistance, setMaxDistance] = useState("10");
  const [result, setResult] = useState<{ submitted: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refXNum = Number(refX);
  const refYNum = Number(refY);
  const refZNum = Number(refZ);
  const maxDistNum = Number(maxDistance) || 0;

  const coordsValid =
    refX !== "" && refY !== "" && refZ !== "" &&
    !isNaN(refXNum) && !isNaN(refYNum) && !isNaN(refZNum);

  // Non-derived PODs eligible for proving
  const provablePods = useMemo(
    () => pods.filter((p) => !p.networkNodeId),
    [pods],
  );

  // Client-side preview: how many are within range
  const inRangeCount = useMemo(() => {
    if (!coordsValid || maxDistNum <= 0) return 0;
    return provablePods.filter(
      (p) => distanceTo(p, refXNum, refYNum, refZNum) <= maxDistNum,
    ).length;
  }, [provablePods, coordsValid, refXNum, refYNum, refZNum, maxDistNum]);

  const canProceed = coordsValid && maxDistNum > 0 && provablePods.length > 0;

  async function handleSubmit() {
    setError(null);

    try {
      const res = await proveProximity(provablePods, tribeId, {
        refX: refXNum,
        refY: refYNum,
        refZ: refZNum,
        maxDistance: maxDistNum,
      });

      setResult(res);
      setStep("done");
      onSuccess();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Proximity proof generation failed";
      setError(msg);
    }
  }

  return (
    <Modal title="Prove Proximity" onClose={onClose} disableClose={isProving}>
      {step === "select" && (
        <>
          <Label>Reference Point (game coordinates)</Label>
          <InputRow>
            <div>
              <InputLabel>X</InputLabel>
              <Input
                type="number"
                value={refX}
                onChange={(e) => setRefX(e.target.value)}
              />
            </div>
            <div>
              <InputLabel>Y</InputLabel>
              <Input
                type="number"
                value={refY}
                onChange={(e) => setRefY(e.target.value)}
              />
            </div>
            <div>
              <InputLabel>Z</InputLabel>
              <Input
                type="number"
                value={refZ}
                onChange={(e) => setRefZ(e.target.value)}
              />
            </div>
          </InputRow>

          <Label>Max Distance (ly)</Label>
          <Input
            type="number"
            min="1"
            step="1"
            value={maxDistance}
            onChange={(e) => setMaxDistance(e.target.value)}
          />

          <Hint>
            {provablePods.length} POD{provablePods.length !== 1 ? "s" : ""} eligible.
            {coordsValid && maxDistNum > 0 && (
              <> {inRangeCount} within range, {provablePods.length - inRangeCount} outside.</>
            )}
            {" "}PODs outside the distance threshold are silently skipped.
          </Hint>

          <ButtonRow>
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton disabled={!canProceed} onClick={() => setStep("confirm")}>
              Review
            </PrimaryButton>
          </ButtonRow>
        </>
      )}

      {step === "confirm" && (
        <>
          <Summary>
            <div>
              <SummaryLabel>Reference Point</SummaryLabel>
              <SummaryValue>
                ({refXNum}, {refYNum}, {refZNum})
              </SummaryValue>
            </div>
            <div>
              <SummaryLabel>Max Distance</SummaryLabel>
              <SummaryValue>{maxDistNum} ly</SummaryValue>
            </div>
            <div>
              <SummaryLabel>PODs to prove</SummaryLabel>
              <SummaryValue>{provablePods.length}</SummaryValue>
            </div>
            <div>
              <SummaryLabel>Estimated in range</SummaryLabel>
              <SummaryValue>{inRangeCount}</SummaryValue>
            </div>
          </Summary>

          <Hint>
            A Groth16 proof will be generated in your browser for each POD. This
            may take several seconds per structure. Coordinates remain private.
          </Hint>

          {error && <ErrorText>{error}</ErrorText>}

          <ButtonRow>
            <SecondaryButton onClick={() => setStep("select")} disabled={isProving}>
              Back
            </SecondaryButton>
            <PrimaryButton onClick={handleSubmit} disabled={isProving}>
              {isProving ? "Generating Proofs…" : "Generate & Submit"}
            </PrimaryButton>
          </ButtonRow>
        </>
      )}

      {step === "done" && result && (
        <>
          <SuccessText>
            Proximity proof batch complete: {result.submitted} submitted
            {result.failed > 0 && `, ${result.failed} outside range`}.
          </SuccessText>
          <Hint>
            Proofs have been verified and stored by the indexer.
          </Hint>
          <ButtonRow>
            <PrimaryButton onClick={onClose}>Done</PrimaryButton>
          </ButtonRow>
        </>
      )}
    </Modal>
  );
}
