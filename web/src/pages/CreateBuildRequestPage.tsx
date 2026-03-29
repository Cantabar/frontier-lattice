import { useState, useMemo } from "react";
import styled from "styled-components";
import { useNavigate } from "react-router-dom";
import { useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { useIdentity } from "../hooks/useIdentity";
import { useActiveBuildRequests } from "../hooks/useBuildRequests";
import { ASSEMBLY_TYPES } from "../lib/types";
import type { AssemblyGroup } from "../lib/types";
import { buildCreateBuildRequest } from "../lib/sui";
import { toBaseUnits } from "../lib/coinUtils";
import { useEscrowCoinDecimals } from "../hooks/useCoinDecimals";
import { CharacterPickerField } from "../components/shared/CharacterPickerField";
import { TribePickerField } from "../components/shared/TribePickerField";
import { PrimaryButton, SecondaryButton } from "../components/shared/Button";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const Page = styled.div`
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: ${({ theme }) => theme.spacing.lg};
  align-items: start;

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }
`;

const FormColumn = styled.div`
  min-width: 0;
`;

const SidebarColumn = styled.div`
  position: sticky;
  top: ${({ theme }) => theme.spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};

  @media (max-width: 960px) {
    position: static;
  }
`;

const PageHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  grid-column: 1 / -1;
`;

const BackButton = styled(SecondaryButton)`
  flex-shrink: 0;
`;

const PageTitle = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const FormCard = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.lg};
`;

const Section = styled.section`
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Label = styled.label`
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const Input = styled.input`
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

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.md};
`;

const CheckboxRow = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  cursor: pointer;
`;

const Hint = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Separator = styled.hr`
  border: none;
  border-top: 1px solid ${({ theme }) => theme.colors.surface.border};
  margin: ${({ theme }) => theme.spacing.md} 0;
`;

const SubmitButton = styled(PrimaryButton)`
  font-size: 14px;
`;

const ErrorBanner = styled.div`
  background: ${({ theme }) => theme.colors.danger}22;
  border: 1px solid ${({ theme }) => theme.colors.danger};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.danger};
  font-size: 13px;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const FieldError = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.danger};
  margin-top: -${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  justify-content: flex-end;
  margin-top: ${({ theme }) => theme.spacing.md};
`;

const SidebarPanel = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.md};
`;

const SidebarTitle = styled.h3`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const DescriptionText = styled.p`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  line-height: 1.5;
  margin: 0;
`;

const ChecklistList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const ChecklistItem = styled.li<{ $done: boolean }>`
  font-size: 13px;
  color: ${({ $done, theme }) =>
    $done ? theme.colors.text.muted : theme.colors.text.primary};
  text-decoration: ${({ $done }) => ($done ? "line-through" : "none")};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};

  &::before {
    content: ${({ $done }) => ($done ? "'✓'" : "'○'")};
    color: ${({ $done, theme }) =>
      $done ? theme.colors.primary.main : theme.colors.text.muted};
    font-size: 14px;
    flex-shrink: 0;
  }
`;

// ---------------------------------------------------------------------------
// Structure type options: non-Construction group entries
// ---------------------------------------------------------------------------

const ELIGIBLE_GROUPS: AssemblyGroup[] = [
  "Core", "Industry", "Storage", "Gate", "Defense", "Hangar", "Misc",
];

interface StructureOption {
  typeId: number;
  label: string;
  group: string;
}

const STRUCTURE_OPTIONS: StructureOption[] = Object.entries(ASSEMBLY_TYPES)
  .filter(([, info]) => ELIGIBLE_GROUPS.includes(info.group))
  .map(([id, info]) => ({
    typeId: Number(id),
    label: info.label,
    group: info.short,
  }))
  .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function CreateBuildRequestPage() {
  const navigate = useNavigate();
  const { characterId } = useIdentity();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();
  const { refetch: refetchBuildRequests } = useActiveBuildRequests();
  const { decimals: ceDecimals, symbol: ceSymbol } = useEscrowCoinDecimals();

  // Form state
  const [requestedTypeId, setRequestedTypeId] = useState("");
  const [bountyAmount, setBountyAmount] = useState("");
  const [requireCormAuth, setRequireCormAuth] = useState(true);
  const [deadlineHours, setDeadlineHours] = useState("48");
  const [allowedCharacters, setAllowedCharacters] = useState<string[]>([]);
  const [allowedTribes, setAllowedTribes] = useState<number[]>([]);

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const isValidAmount = bountyAmount !== "" && !isNaN(Number(bountyAmount)) && Number(bountyAmount) > 0;

  const isValid = !!characterId && !!requestedTypeId && isValidAmount;

  const selectedType = ASSEMBLY_TYPES[Number(requestedTypeId)];

  const checklist = useMemo(() => [
    { label: "Select structure type", done: !!requestedTypeId },
    { label: "Set bounty amount", done: isValidAmount },
    { label: "Set deadline", done: Number(deadlineHours) > 0 },
  ], [requestedTypeId, isValidAmount, deadlineHours]);

  async function handleCreate() {
    setSubmitted(true);
    if (!characterId || !isValid) return;
    setError(null);
    setIsBusy(true);

    const deadlineMs = Date.now() + Number(deadlineHours) * 3600 * 1000;

    try {
      const tx = buildCreateBuildRequest({
        characterId,
        bountyAmount: Number(toBaseUnits(bountyAmount, ceDecimals)),
        requestedTypeId: Number(requestedTypeId),
        requireCormAuth,
        deadlineMs,
        allowedCharacters,
        allowedTribes,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await signAndExecute({ transaction: tx as any });
      await suiClient.waitForTransaction({ digest: result.digest });
      await refetchBuildRequests();
      navigate("/contracts");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setError(msg);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader>
        <BackButton onClick={() => navigate("/contracts")} disabled={isBusy}>← Back</BackButton>
        <PageTitle>Create Build Request</PageTitle>
      </PageHeader>

      <FormColumn>
        <FormCard>
          <Section>
            <SectionTitle>Structure</SectionTitle>
            <Label>Requested Structure Type</Label>
            <Select
              value={requestedTypeId}
              onChange={(e) => setRequestedTypeId(e.target.value)}
            >
              <option value="">Select a structure type…</option>
              {STRUCTURE_OPTIONS.map((opt) => (
                <option key={opt.typeId} value={opt.typeId}>
                  {opt.label} ({opt.group})
                </option>
              ))}
            </Select>
            {submitted && !requestedTypeId && <FieldError>Required</FieldError>}
            <Hint>
              The witness service will automatically fulfill this contract when someone anchors a
              matching structure{requireCormAuth ? " and enables CormAuth" : ""}.
            </Hint>
          </Section>

          <Separator />

          <Section>
            <SectionTitle>Bounty</SectionTitle>
            <Label>Bounty Amount ({ceSymbol})</Label>
            <Input
              type="number"
              placeholder="0.0"
              value={bountyAmount}
              onChange={(e) => setBountyAmount(e.target.value)}
            />
            {submitted && !isValidAmount && <FieldError>Enter a valid amount greater than 0</FieldError>}
            <Hint>This amount is held in escrow and paid to the builder when the structure is verified.</Hint>
          </Section>

          <Separator />

          <Section>
            <SectionTitle>Options</SectionTitle>
            <CheckboxRow>
              <input
                type="checkbox"
                checked={requireCormAuth}
                onChange={(e) => setRequireCormAuth(e.target.checked)}
              />
              Require CormAuth extension
            </CheckboxRow>
            <Hint>
              When enabled, the builder must also authorize the CormAuth extension on the structure
              before the contract is fulfilled.
            </Hint>

            <Row>
              <div>
                <Label>Deadline (hours)</Label>
                <Input
                  type="number"
                  value={deadlineHours}
                  onChange={(e) => setDeadlineHours(e.target.value)}
                />
              </div>
              <div />
            </Row>

            <Label>Allowed Characters (optional)</Label>
            <CharacterPickerField value={allowedCharacters} onChange={setAllowedCharacters} />

            <Label>Allowed Tribes (optional)</Label>
            <TribePickerField value={allowedTribes} onChange={setAllowedTribes} />
          </Section>

          {error && <ErrorBanner>{error}</ErrorBanner>}

          <ButtonRow>
            <SecondaryButton onClick={() => navigate("/contracts")} disabled={isBusy}>
              Cancel
            </SecondaryButton>
            <SubmitButton onClick={handleCreate} disabled={isBusy}>
              {isBusy ? "Creating…" : "Create Build Request"}
            </SubmitButton>
          </ButtonRow>
        </FormCard>
      </FormColumn>

      <SidebarColumn>
        <SidebarPanel>
          <SidebarTitle>About Build Requests</SidebarTitle>
          <DescriptionText>
            Build requests are witnessed contracts — you post a bounty for someone to build a specific
            structure type. The CORM witness service monitors the chain for matching anchor events and
            automatically fulfills the contract when conditions are met.
          </DescriptionText>
        </SidebarPanel>

        {selectedType && (
          <SidebarPanel>
            <SidebarTitle>Selected Structure</SidebarTitle>
            <DescriptionText>
              <strong>{selectedType.label}</strong> — {selectedType.short} category
            </DescriptionText>
          </SidebarPanel>
        )}

        <SidebarPanel>
          <SidebarTitle>Checklist</SidebarTitle>
          <ChecklistList>
            {checklist.map((item) => (
              <ChecklistItem key={item.label} $done={item.done}>
                {item.label}
              </ChecklistItem>
            ))}
          </ChecklistList>
        </SidebarPanel>
      </SidebarColumn>
    </Page>
  );
}
