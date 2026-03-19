/**
 * Modal for registering a structure's location as an encrypted POD.
 *
 * Flow:
 *   1. Select one of the player's owned structures
 *   2. Pick a solar system (required) + optional xyz coordinates
 *   3. Confirm → sign, encrypt, submit
 */

import { useState } from "react";
import styled from "styled-components";
import { Modal } from "../shared/Modal";
import { PrimaryButton, SecondaryButton } from "../shared/Button";
import { SolarSystemPicker } from "../shared/SolarSystemPicker";
import { useMyStructures } from "../../hooks/useStructures";
import { useLocationPods } from "../../hooks/useLocationPods";
import { ASSEMBLY_TYPES } from "../../lib/types";
import { truncateAddress } from "../../lib/format";
import { solarSystemName } from "../../lib/solarSystems";
import type { SolarSystemEntry } from "../../lib/solarSystems";
import type { LocationData } from "../../lib/locationCrypto";

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

const Select = styled.select`
  width: 100%;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;
  margin-bottom: ${({ theme }) => theme.spacing.md};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const CoordToggle = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.primary.main};
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  margin-bottom: ${({ theme }) => theme.spacing.sm};

  &:hover {
    text-decoration: underline;
  }
`;

const CoordRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const CoordInput = styled.input`
  width: 100%;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;
  font-family: ${({ theme }) => theme.fonts.mono};

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

const Hint = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: -${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

// ============================================================
// Component
// ============================================================

interface Props {
  tribeId: string;
  tlkBytes: Uint8Array;
  tlkVersion: number;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = "select" | "confirm";

export function RegisterLocationModal({
  tribeId,
  tlkBytes,
  tlkVersion,
  onClose,
  onSuccess,
}: Props) {
  const { structures, isLoading: structuresLoading } = useMyStructures();
  const { submitPod } = useLocationPods();

  const [step, setStep] = useState<Step>("select");
  const [structureId, setStructureId] = useState("");
  const [solarSystem, setSolarSystem] = useState<SolarSystemEntry | null>(null);
  const [showCoords, setShowCoords] = useState(false);
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedStructure = structures.find((s) => s.id === structureId);
  const canProceed = !!structureId && !!solarSystem;

  async function handleSubmit() {
    if (!solarSystem || !structureId) return;
    setSubmitting(true);
    setError(null);

    const location: LocationData = {
      solarSystemId: solarSystem.id,
      x: Number(x) || 0,
      y: Number(y) || 0,
      z: Number(z) || 0,
    };

    try {
      await submitPod({
        structureId,
        tribeId,
        location,
        tlkBytes,
        tlkVersion,
      });
      onSuccess();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to submit location";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Register Structure Location" onClose={onClose} disableClose={submitting}>
      {step === "select" && (
        <>
          {/* Structure picker */}
          <Label>Structure</Label>
          {structuresLoading ? (
            <Select disabled>
              <option>Loading…</option>
            </Select>
          ) : (
            <Select
              value={structureId}
              onChange={(e) => setStructureId(e.target.value)}
            >
              <option value="">Select a structure…</option>
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || ASSEMBLY_TYPES[s.typeId]?.label || "Structure"} —{" "}
                  {truncateAddress(s.id, 8, 6)}
                </option>
              ))}
            </Select>
          )}

          {/* Solar system picker */}
          <Label>Solar System</Label>
          <SolarSystemPicker
            value={solarSystem?.id ?? null}
            onChange={(entry) => setSolarSystem(entry)}
          />
          <Hint>
            Start typing a system name. Coordinates default to (0, 0, 0) — the
            solar system alone is sufficient for most use cases.
          </Hint>

          {/* Optional coordinates */}
          <CoordToggle
            type="button"
            onClick={() => setShowCoords((v) => !v)}
          >
            {showCoords ? "▾ Hide exact coordinates" : "▸ Advanced: exact coordinates"}
          </CoordToggle>
          {showCoords && (
            <CoordRow>
              <div>
                <Label>X</Label>
                <CoordInput
                  type="number"
                  value={x}
                  onChange={(e) => setX(e.target.value)}
                />
              </div>
              <div>
                <Label>Y</Label>
                <CoordInput
                  type="number"
                  value={y}
                  onChange={(e) => setY(e.target.value)}
                />
              </div>
              <div>
                <Label>Z</Label>
                <CoordInput
                  type="number"
                  value={z}
                  onChange={(e) => setZ(e.target.value)}
                />
              </div>
            </CoordRow>
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

      {step === "confirm" && solarSystem && (
        <>
          <Summary>
            <div>
              <SummaryLabel>Structure</SummaryLabel>
              <SummaryValue>
                {selectedStructure?.name || truncateAddress(structureId, 10, 6)}
              </SummaryValue>
            </div>
            <div>
              <SummaryLabel>Solar System</SummaryLabel>
              <SummaryValue>
                {solarSystemName(solarSystem.id)}
              </SummaryValue>
            </div>
            <div>
              <SummaryLabel>Coordinates</SummaryLabel>
              <SummaryValue>
                ({Number(x) || 0}, {Number(y) || 0}, {Number(z) || 0})
              </SummaryValue>
            </div>
            <div>
              <SummaryLabel>TLK Version</SummaryLabel>
              <SummaryValue>v{tlkVersion}</SummaryValue>
            </div>
          </Summary>

          <Hint>
            Your wallet will be prompted to sign the POD. The location will be
            encrypted with the Tribe Location Key before being sent to the server.
          </Hint>

          {error && <ErrorText>{error}</ErrorText>}

          <ButtonRow>
            <SecondaryButton onClick={() => setStep("select")} disabled={submitting}>
              Back
            </SecondaryButton>
            <PrimaryButton onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Signing & Encrypting…" : "Register Location"}
            </PrimaryButton>
          </ButtonRow>
        </>
      )}
    </Modal>
  );
}
