/**
 * Verify Proof — public page for independent ZK proof verification.
 *
 * Any user can paste a proof JSON (single proof or full PodProofBundle
 * exported from the Locations page) and verify it cryptographically
 * without a wallet connection.
 */

import { useState } from "react";
import styled from "styled-components";
import { verifyZkProof, type VerifyProofResult, type PodProofBundle } from "../lib/api";
import { truncateAddress } from "../lib/format";

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Page = styled.div`
  max-width: 720px;
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const Subtitle = styled.p`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  line-height: 1.5;
`;

const TextArea = styled.textarea`
  width: 100%;
  min-height: 200px;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  color: ${({ theme }) => theme.colors.text.secondary};
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 12px;
  padding: ${({ theme }) => theme.spacing.md};
  resize: vertical;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }

  &::placeholder {
    color: ${({ theme }) => theme.colors.text.muted};
  }
`;

const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const ActionButton = styled.button<{ $busy?: boolean }>`
  background: ${({ theme }) => theme.colors.primary.subtle};
  border: 1px solid ${({ theme }) => theme.colors.primary.main};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.colors.primary.main};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  opacity: ${({ $busy }) => ($busy ? 0.6 : 1)};
  pointer-events: ${({ $busy }) => ($busy ? "none" : "auto")};
  transition: background 0.15s, border-color 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.primary.main};
    color: ${({ theme }) => theme.colors.surface.bg};
  }
`;

const SecondaryBtn = styled(ActionButton)`
  background: transparent;
  border-color: ${({ theme }) => theme.colors.surface.borderHover};
  color: ${({ theme }) => theme.colors.text.secondary};

  &:hover {
    background: ${({ theme }) => theme.colors.surface.overlay};
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const ResultCard = styled.div<{ $valid: boolean }>`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid
    ${({ theme, $valid }) => ($valid ? theme.colors.success ?? "#4caf50" : theme.colors.danger)};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ResultHeader = styled.div<{ $valid: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: 16px;
  font-weight: 700;
  color: ${({ $valid }) => ($valid ? "#4caf50" : "#ef5350")};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const Badge = styled.span<{ $valid: boolean }>`
  display: inline-block;
  background: ${({ $valid }) => ($valid ? "#4caf5022" : "#ef535022")};
  border: 1px solid ${({ $valid }) => ($valid ? "#4caf50" : "#ef5350")};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: ${({ $valid }) => ($valid ? "#4caf50" : "#ef5350")};
  text-transform: uppercase;
`;

const SectionTitle = styled.h3`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  margin-top: ${({ theme }) => theme.spacing.md};
`;

const FieldRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 3px 0;
  font-size: 13px;
`;

const FieldLabel = styled.span`
  color: ${({ theme }) => theme.colors.text.muted};
  flex-shrink: 0;
  margin-right: ${({ theme }) => theme.spacing.sm};
`;

const FieldValue = styled.span`
  color: ${({ theme }) => theme.colors.text.primary};
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 12px;
  text-align: right;
  word-break: break-all;
`;

const ProofRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.xs} 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.surface.border};
  font-size: 13px;

  &:last-child {
    border-bottom: none;
  }
`;

const ProofType = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const ErrorText = styled.div`
  color: ${({ theme }) => theme.colors.danger};
  font-size: 12px;
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const HintText = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  font-style: italic;
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedInput {
  type: "bundle" | "single";
  payload: PodProofBundle | { filterType: string; publicSignals: string[]; proof: Record<string, unknown> };
}

function tryParse(raw: string): ParsedInput | null {
  try {
    const obj = JSON.parse(raw);

    // Bundle format: has zk_proofs array
    if (Array.isArray(obj.zk_proofs)) {
      return { type: "bundle", payload: obj as PodProofBundle };
    }

    // Single proof with camelCase keys (direct from zkProver)
    if (obj.filterType && Array.isArray(obj.publicSignals) && obj.proof) {
      return {
        type: "single",
        payload: obj as { filterType: string; publicSignals: string[]; proof: Record<string, unknown> },
      };
    }

    // Single proof with snake_case keys (from bundle's zk_proofs element)
    if (obj.filter_type && Array.isArray(obj.public_signals) && obj.proof_json) {
      return {
        type: "single",
        payload: {
          filterType: obj.filter_type,
          publicSignals: obj.public_signals,
          proof: obj.proof_json,
        },
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VerifyProofPage() {
  const [input, setInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyProofResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [bundleMeta, setBundleMeta] = useState<PodProofBundle | null>(null);

  async function handleVerify() {
    setResult(null);
    setParseError(null);
    setBundleMeta(null);

    const parsed = tryParse(input.trim());
    if (!parsed) {
      setParseError(
        "Could not parse input. Paste a proof bundle (from the Copy Proof button on the Locations page) or a single proof object with { filterType, publicSignals, proof }.",
      );
      return;
    }

    if (parsed.type === "bundle") {
      const bundle = parsed.payload as PodProofBundle;
      if (!bundle.zk_proofs.length) {
        setParseError("This proof bundle contains no ZK proofs to verify.");
        return;
      }
      setBundleMeta(bundle);
    }

    setVerifying(true);
    try {
      const res = await verifyZkProof(parsed.payload);
      setResult(res);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Verification request failed");
    } finally {
      setVerifying(false);
    }
  }

  function handleClear() {
    setInput("");
    setResult(null);
    setParseError(null);
    setBundleMeta(null);
  }

  return (
    <Page>
      <Title>Verify Proof</Title>
      <Subtitle>
        Paste a ZK proof JSON to independently verify it. Accepts a full proof bundle
        (exported from the Locations page) or a single proof object. No wallet connection required.
      </Subtitle>

      <TextArea
        placeholder={`Paste proof JSON here…\n\nAccepted formats:\n• Full proof bundle: { "structure_id": "…", "zk_proofs": [ … ], … }\n• Single proof: { "filterType": "region", "publicSignals": [ … ], "proof": { … } }`}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          if (result || parseError) {
            setResult(null);
            setParseError(null);
            setBundleMeta(null);
          }
        }}
      />

      <ButtonRow>
        <ActionButton onClick={handleVerify} $busy={verifying} disabled={!input.trim()}>
          {verifying ? "Verifying…" : "Verify"}
        </ActionButton>
        {input && (
          <SecondaryBtn onClick={handleClear}>Clear</SecondaryBtn>
        )}
      </ButtonRow>

      {parseError && <ErrorText>{parseError}</ErrorText>}

      {result && (
        <ResultCard $valid={result.valid}>
          <ResultHeader $valid={result.valid}>
            {result.valid ? "Valid" : "Invalid"}
            {result.format === "bundle" && result.proof_count != null && (
              <span style={{ fontSize: 13, fontWeight: 400, opacity: 0.7 }}>
                — {result.proof_count} proof{result.proof_count !== 1 ? "s" : ""} checked
              </span>
            )}
          </ResultHeader>

          {/* Bundle attestation metadata */}
          {bundleMeta && (
            <>
              <SectionTitle>Attestation</SectionTitle>
              <FieldRow>
                <FieldLabel>Structure</FieldLabel>
                <FieldValue>{truncateAddress(bundleMeta.structure_id, 10, 6)}</FieldValue>
              </FieldRow>
              <FieldRow>
                <FieldLabel>Owner</FieldLabel>
                <FieldValue>{truncateAddress(bundleMeta.owner_address, 10, 6)}</FieldValue>
              </FieldRow>
              <FieldRow>
                <FieldLabel>Location Hash</FieldLabel>
                <FieldValue>{truncateAddress(bundleMeta.location_hash, 10, 8)}</FieldValue>
              </FieldRow>
              <FieldRow>
                <FieldLabel>Version</FieldLabel>
                <FieldValue>POD v{bundleMeta.pod_version} / TLK v{bundleMeta.tlk_version}</FieldValue>
              </FieldRow>
              {bundleMeta.location_tags.length > 0 && (
                <FieldRow>
                  <FieldLabel>Tags</FieldLabel>
                  <FieldValue>
                    {bundleMeta.location_tags.map((t) => `${t.tag_type} #${t.tag_id}`).join(", ")}
                  </FieldValue>
                </FieldRow>
              )}
            </>
          )}

          {/* Per-proof results (bundle) */}
          {result.results && result.results.length > 0 && (
            <>
              <SectionTitle>Proofs</SectionTitle>
              {result.results.map((r, i) => (
                <ProofRow key={i}>
                  <Badge $valid={r.valid}>{r.valid ? "Pass" : "Fail"}</Badge>
                  <ProofType>{r.filter_type}</ProofType>
                  {r.error && (
                    <span style={{ fontSize: 12, color: "#ef5350" }}>{r.error}</span>
                  )}
                </ProofRow>
              ))}
            </>
          )}

          {/* Single proof details */}
          {result.format === "single" && (
            <>
              <FieldRow>
                <FieldLabel>Filter Type</FieldLabel>
                <FieldValue>{result.filter_type}</FieldValue>
              </FieldRow>
              {result.error && (
                <FieldRow>
                  <FieldLabel>Error</FieldLabel>
                  <FieldValue style={{ color: "#ef5350" }}>{result.error}</FieldValue>
                </FieldRow>
              )}
            </>
          )}

          <HintText>
            Verification is performed server-side using the Groth16 circuit verification keys.
            A valid proof confirms the prover knows secret inputs (coordinates + salt) that satisfy
            the circuit constraints without revealing those inputs.
          </HintText>
        </ResultCard>
      )}
    </Page>
  );
}
