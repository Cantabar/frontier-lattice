/**
 * Modal for generating region ZK proofs for location PODs.
 *
 * Supports three modes:
 *   - Named Region: pick a game region by name → canonical bounding box
 *   - Named Constellation: pick a constellation by name → canonical bounding box
 *   - Custom Bounding Box: enter arbitrary 3D bounds
 *
 * Generates Groth16 proofs in-browser for all owned, non-derived PODs and
 * submits them to the indexer. PODs whose coordinates fall outside the
 * selected bounds are silently skipped (expected behavior).
 */

import { useState, useMemo } from "react";
import styled from "styled-components";
import { Modal } from "../shared/Modal";
import { PrimaryButton, SecondaryButton } from "../shared/Button";
import { CustomSelect } from "../shared/CustomSelect";
import { useZkLocationFilter } from "../../hooks/useZkLocationFilter";
import type { DecryptedPod } from "../../hooks/useLocationPods";
import {
  searchRegions,
  searchConstellations,
  regionName,
  constellationName,
  type RegionEntry,
  type ConstellationEntry,
} from "../../lib/regions";

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
  margin-bottom: ${({ theme }) => theme.spacing.sm};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const InputRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
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

type ProofMode = "region" | "constellation" | "custom";
type Step = "select" | "confirm" | "done";

interface Props {
  tribeId: string;
  pods: DecryptedPod[];
  onClose: () => void;
  onSuccess: () => void;
}

// ============================================================
// Component
// ============================================================

export function RegionProofModal({
  tribeId,
  pods,
  onClose,
  onSuccess,
}: Props) {
  const { proveRegion, proveRegionById, proveConstellationById, isProving } =
    useZkLocationFilter();

  const [step, setStep] = useState<Step>("select");
  const [mode, setMode] = useState<ProofMode>("region");
  const [regionId, setRegionId] = useState("");
  const [constellationId, setConstellationId] = useState("");
  const [customBounds, setCustomBounds] = useState({
    xMin: "",
    xMax: "",
    yMin: "",
    yMax: "",
    zMin: "",
    zMax: "",
  });
  const [result, setResult] = useState<{ submitted: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Build dropdown options for regions and constellations
  const regionOptions = useMemo(() => {
    const entries: RegionEntry[] = searchRegions("", 200);
    return [
      { value: "", label: "Select a region…" },
      ...entries.map((r) => ({
        value: String(r.id),
        label: `${r.name} (#${r.id})`,
      })),
    ];
  }, []);

  const constellationOptions = useMemo(() => {
    const entries: ConstellationEntry[] = searchConstellations("", 200);
    return [
      { value: "", label: "Select a constellation…" },
      ...entries.map((c) => ({
        value: String(c.id),
        label: `${c.name} (#${c.id})`,
      })),
    ];
  }, []);

  // Count of provable PODs (owned, non-derived)
  const provablePods = useMemo(
    () => pods.filter((p) => !p.networkNodeId),
    [pods],
  );

  const customBoundsValid =
    mode === "custom" &&
    Object.values(customBounds).every((v) => v !== "" && !isNaN(Number(v)));

  const canProceed =
    provablePods.length > 0 &&
    ((mode === "region" && regionId !== "") ||
      (mode === "constellation" && constellationId !== "") ||
      (mode === "custom" && customBoundsValid));

  function summaryLabel(): string {
    if (mode === "region") return regionName(Number(regionId));
    if (mode === "constellation") return constellationName(Number(constellationId));
    return "Custom Bounding Box";
  }

  async function handleSubmit() {
    setError(null);

    try {
      let res: { submitted: number; failed: number };

      if (mode === "region") {
        res = await proveRegionById(provablePods, tribeId, Number(regionId));
      } else if (mode === "constellation") {
        res = await proveConstellationById(
          provablePods,
          tribeId,
          Number(constellationId),
        );
      } else {
        res = await proveRegion(provablePods, tribeId, {
          xMin: Number(customBounds.xMin),
          xMax: Number(customBounds.xMax),
          yMin: Number(customBounds.yMin),
          yMax: Number(customBounds.yMax),
          zMin: Number(customBounds.zMin),
          zMax: Number(customBounds.zMax),
        });
      }

      setResult(res);
      setStep("done");
      onSuccess();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Region proof generation failed";
      setError(msg);
    }
  }

  return (
    <Modal title="Prove Region" onClose={onClose} disableClose={isProving}>
      {step === "select" && (
        <>
          <Label>Proof Mode</Label>
          <SelectWrapper>
            <CustomSelect
              value={mode}
              onChange={(v) => setMode(v as ProofMode)}
              options={[
                { value: "region", label: "Named Region" },
                { value: "constellation", label: "Named Constellation" },
                { value: "custom", label: "Custom Bounding Box" },
              ]}
            />
          </SelectWrapper>

          {mode === "region" && (
            <>
              <Label>Region</Label>
              <SelectWrapper>
                <CustomSelect
                  value={regionId}
                  onChange={setRegionId}
                  placeholder="Select a region…"
                  options={regionOptions}
                />
              </SelectWrapper>
            </>
          )}

          {mode === "constellation" && (
            <>
              <Label>Constellation</Label>
              <SelectWrapper>
                <CustomSelect
                  value={constellationId}
                  onChange={setConstellationId}
                  placeholder="Select a constellation…"
                  options={constellationOptions}
                />
              </SelectWrapper>
            </>
          )}

          {mode === "custom" && (
            <>
              <Label>Bounding Box (game coordinates)</Label>
              <InputRow>
                <div>
                  <InputLabel>X Min</InputLabel>
                  <Input
                    type="number"
                    value={customBounds.xMin}
                    onChange={(e) =>
                      setCustomBounds((b) => ({ ...b, xMin: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <InputLabel>X Max</InputLabel>
                  <Input
                    type="number"
                    value={customBounds.xMax}
                    onChange={(e) =>
                      setCustomBounds((b) => ({ ...b, xMax: e.target.value }))
                    }
                  />
                </div>
              </InputRow>
              <InputRow>
                <div>
                  <InputLabel>Y Min</InputLabel>
                  <Input
                    type="number"
                    value={customBounds.yMin}
                    onChange={(e) =>
                      setCustomBounds((b) => ({ ...b, yMin: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <InputLabel>Y Max</InputLabel>
                  <Input
                    type="number"
                    value={customBounds.yMax}
                    onChange={(e) =>
                      setCustomBounds((b) => ({ ...b, yMax: e.target.value }))
                    }
                  />
                </div>
              </InputRow>
              <InputRow>
                <div>
                  <InputLabel>Z Min</InputLabel>
                  <Input
                    type="number"
                    value={customBounds.zMin}
                    onChange={(e) =>
                      setCustomBounds((b) => ({ ...b, zMin: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <InputLabel>Z Max</InputLabel>
                  <Input
                    type="number"
                    value={customBounds.zMax}
                    onChange={(e) =>
                      setCustomBounds((b) => ({ ...b, zMax: e.target.value }))
                    }
                  />
                </div>
              </InputRow>
            </>
          )}

          <Hint>
            {provablePods.length} POD{provablePods.length !== 1 ? "s" : ""} will
            be proven. PODs outside the selected bounds are silently skipped.
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
              <SummaryLabel>Mode</SummaryLabel>
              <SummaryValue>
                {mode === "region"
                  ? "Named Region"
                  : mode === "constellation"
                    ? "Named Constellation"
                    : "Custom Bounding Box"}
              </SummaryValue>
            </div>
            <div>
              <SummaryLabel>Target</SummaryLabel>
              <SummaryValue>{summaryLabel()}</SummaryValue>
            </div>
            <div>
              <SummaryLabel>PODs to prove</SummaryLabel>
              <SummaryValue>{provablePods.length}</SummaryValue>
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
            Region proof batch complete: {result.submitted} submitted
            {result.failed > 0 && `, ${result.failed} outside bounds`}.
          </SuccessText>
          <Hint>
            Proofs have been verified and stored by the indexer. Structures with
            successful proofs now have public location tags.
          </Hint>
          <ButtonRow>
            <PrimaryButton onClick={onClose}>Done</PrimaryButton>
          </ButtonRow>
        </>
      )}
    </Modal>
  );
}
