/**
 * Modal for generating a mutual proximity ZK proof between two structures.
 *
 * A tribe member selects two decrypted PODs and a distance threshold,
 * then the browser generates a Groth16 proof that both Poseidon-committed
 * locations are within the specified distance — without revealing either
 * location. Used to fulfill proximity-gated witnessed contracts.
 */

import { useState, useMemo } from "react";
import styled from "styled-components";
import { Modal } from "../shared/Modal";
import { PrimaryButton, SecondaryButton } from "../shared/Button";
import { useZkLocationFilter } from "../../hooks/useZkLocationFilter";
import type { DecryptedPod } from "../../hooks/useLocationPods";
import { truncateAddress } from "../../lib/format";
import { solarSystemName } from "../../lib/solarSystems";
import { CustomSelect } from "../shared/CustomSelect";

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

const SelectWrapper = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
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
  margin-top: -${({ theme }) => theme.spacing.sm};
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
// Component
// ============================================================

interface Props {
  tribeId: string;
  pods: DecryptedPod[];
  onClose: () => void;
  onSuccess: () => void;
}

type Step = "select" | "confirm" | "done";

function podLabel(pod: DecryptedPod): string {
  const sys = solarSystemName(pod.location.solarSystemId);
  const addr = truncateAddress(pod.structureId, 8, 6);
  return sys ? `${sys} — ${addr}` : addr;
}

/** Compute Euclidean distance between two 3D points. */
function euclideanDistance(a: DecryptedPod, b: DecryptedPod): number {
  const dx = a.location.x - b.location.x;
  const dy = a.location.y - b.location.y;
  const dz = a.location.z - b.location.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function MutualProximityProofModal({
  tribeId,
  pods,
  onClose,
  onSuccess,
}: Props) {
  const { proveMutualProximity, isProving } = useZkLocationFilter();

  const [step, setStep] = useState<Step>("select");
  const [structureIdA, setStructureIdA] = useState("");
  const [structureIdB, setStructureIdB] = useState("");
  const [maxDistance, setMaxDistance] = useState("10");
  const [error, setError] = useState<string | null>(null);

  const podA = useMemo(
    () => pods.find((p) => p.structureId === structureIdA),
    [pods, structureIdA],
  );
  const podB = useMemo(
    () => pods.find((p) => p.structureId === structureIdB),
    [pods, structureIdB],
  );

  const actualDistance = useMemo(
    () => (podA && podB ? euclideanDistance(podA, podB) : null),
    [podA, podB],
  );

  const maxDistNum = Number(maxDistance) || 0;
  const withinRange = actualDistance != null && actualDistance <= maxDistNum;
  const canProceed = !!podA && !!podB && maxDistNum > 0;

  async function handleSubmit() {
    if (!podA || !podB) return;
    setError(null);

    try {
      await proveMutualProximity(podA, podB, tribeId, maxDistNum);
      setStep("done");
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Proof generation failed";
      setError(msg);
    }
  }

  return (
    <Modal title="Prove Proximity" onClose={onClose} disableClose={isProving}>
      {step === "select" && (
        <>
          <Label>Structure A</Label>
          <SelectWrapper>
            <CustomSelect
              value={structureIdA}
              onChange={setStructureIdA}
              placeholder="Select a structure…"
              options={[
                { value: "", label: "Select a structure…" },
                ...pods.map((pod) => ({
                  value: pod.structureId,
                  label: podLabel(pod),
                  disabled: pod.structureId === structureIdB,
                })),
              ]}
            />
          </SelectWrapper>

          <Label>Structure B</Label>
          <SelectWrapper>
            <CustomSelect
              value={structureIdB}
              onChange={setStructureIdB}
              placeholder="Select a structure…"
              options={[
                { value: "", label: "Select a structure…" },
                ...pods.map((pod) => ({
                  value: pod.structureId,
                  label: podLabel(pod),
                  disabled: pod.structureId === structureIdA,
                })),
              ]}
            />
          </SelectWrapper>

          <Label>Max Distance (ly)</Label>
          <Input
            type="number"
            min="1"
            step="1"
            value={maxDistance}
            onChange={(e) => setMaxDistance(e.target.value)}
          />
          <Hint>
            The proof will attest that both structures are within this distance.
            The actual coordinates remain private.
          </Hint>

          {actualDistance != null && (
            <Hint>
              Actual distance: {actualDistance.toFixed(2)} ly
              {withinRange ? " ✓ within range" : " ✗ exceeds threshold"}
            </Hint>
          )}

          <ButtonRow>
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton
              disabled={!canProceed}
              onClick={() => setStep("confirm")}
            >
              Review
            </PrimaryButton>
          </ButtonRow>
        </>
      )}

      {step === "confirm" && podA && podB && (
        <>
          <Summary>
            <div>
              <SummaryLabel>Structure A</SummaryLabel>
              <SummaryValue>{podLabel(podA)}</SummaryValue>
            </div>
            <div>
              <SummaryLabel>Coordinates A</SummaryLabel>
              <SummaryValue>
                ({podA.location.x}, {podA.location.y}, {podA.location.z})
              </SummaryValue>
            </div>
            <div>
              <SummaryLabel>Structure B</SummaryLabel>
              <SummaryValue>{podLabel(podB)}</SummaryValue>
            </div>
            <div>
              <SummaryLabel>Coordinates B</SummaryLabel>
              <SummaryValue>
                ({podB.location.x}, {podB.location.y}, {podB.location.z})
              </SummaryValue>
            </div>
            <div>
              <SummaryLabel>Actual Distance</SummaryLabel>
              <SummaryValue>
                {actualDistance?.toFixed(2)} ly
              </SummaryValue>
            </div>
            <div>
              <SummaryLabel>Max Distance</SummaryLabel>
              <SummaryValue>{maxDistNum} ly</SummaryValue>
            </div>
          </Summary>

          {!withinRange && (
            <ErrorText>
              The actual distance exceeds the threshold — the proof will fail.
            </ErrorText>
          )}

          <Hint>
            A Groth16 proof will be generated in your browser. This may take a
            few seconds. Neither location will be sent to the server.
          </Hint>

          {error && <ErrorText>{error}</ErrorText>}

          <ButtonRow>
            <SecondaryButton onClick={() => setStep("select")} disabled={isProving}>
              Back
            </SecondaryButton>
            <PrimaryButton onClick={handleSubmit} disabled={isProving}>
              {isProving ? "Generating Proof…" : "Generate & Submit"}
            </PrimaryButton>
          </ButtonRow>
        </>
      )}

      {step === "done" && (
        <>
          <SuccessText>
            Mutual proximity proof submitted and verified.
          </SuccessText>
          <Hint>
            The indexer has stored the proof. The witness service can now use it
            to fulfill proximity-gated contracts involving these structures.
          </Hint>
          <ButtonRow>
            <PrimaryButton onClick={onClose}>Done</PrimaryButton>
          </ButtonRow>
        </>
      )}
    </Modal>
  );
}
