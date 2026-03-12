import { useState } from "react";
import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import type { TribeData, TribeCapData, TreasuryProposalData } from "../../lib/types";
import { formatAmount, truncateAddress, formatDeadline } from "../../lib/format";
import { buildDepositToTreasury, buildProposeTreasurySpend, buildVoteOnProposal, buildExecuteProposal } from "../../lib/sui";

/* ------------------------------------------------------------------ */
/* Styled                                                              */
/* ------------------------------------------------------------------ */

const Panel = styled.section`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.lg};
`;

const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const Balance = styled.div`
  font-size: 28px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary.muted};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const Row = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Input = styled.input`
  flex: 1;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const Button = styled.button`
  background: ${({ theme }) => theme.colors.primary.main};
  color: #fff;
  border: none;
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.primary.hover};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SecondaryButton = styled(Button)`
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.text.secondary};

  &:hover {
    background: ${({ theme }) => theme.colors.surface.borderHover};
  }
`;

const Divider = styled.hr`
  border: none;
  border-top: 1px solid ${({ theme }) => theme.colors.surface.border};
  margin: ${({ theme }) => theme.spacing.lg} 0;
`;

const ProposalCard = styled.div`
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const ProposalMeta = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const ProposalAmount = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary.muted};
`;

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface Props {
  tribe: TribeData;
  cap: TribeCapData | null;
  proposals: TreasuryProposalData[];
}

export function TreasuryPanel({ tribe, cap, proposals }: Props) {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  /* Deposit */
  const [depositAmount, setDepositAmount] = useState("");

  async function handleDeposit() {
    const amount = Math.round(Number(depositAmount) * 1e9);
    if (!amount) return;
    const tx = buildDepositToTreasury({ tribeId: tribe.id, amount });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
    await signAndExecute({ transaction: tx as any });
    setDepositAmount("");
  }

  /* Propose */
  const [proposing, setProposing] = useState(false);
  const [propAmount, setPropAmount] = useState("");
  const [propRecipient, setPropRecipient] = useState("");
  const [propDeadlineHours, setPropDeadlineHours] = useState("24");

  async function handlePropose() {
    if (!cap) return;
    const amount = Math.round(Number(propAmount) * 1e9);
    const deadlineMs = Date.now() + Number(propDeadlineHours) * 3600 * 1000;
    const tx = buildProposeTreasurySpend({
      tribeId: tribe.id,
      capId: cap.id,
      amount,
      recipient: propRecipient,
      deadlineMs,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
    await signAndExecute({ transaction: tx as any });
    setProposing(false);
    setPropAmount("");
    setPropRecipient("");
  }

  /* Vote / Execute */
  async function handleVote(proposalId: string) {
    if (!cap) return;
    const tx = buildVoteOnProposal({ tribeId: tribe.id, proposalId, capId: cap.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
  }

  async function handleExecute(proposalId: string) {
    const tx = buildExecuteProposal({ tribeId: tribe.id, proposalId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
  }

  return (
    <Panel>
      <SectionTitle>Treasury</SectionTitle>
      <Balance>{formatAmount(tribe.treasuryBalance)} SUI</Balance>

      {/* Deposit */}
      <Row>
        <Input
          type="number"
          placeholder="Amount (SUI)"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
        />
        <Button onClick={handleDeposit} disabled={!depositAmount}>
          Deposit
        </Button>
      </Row>

      {cap && (
        <>
          {proposing ? (
            <>
              <Input
                type="number"
                placeholder="Amount (SUI)"
                value={propAmount}
                onChange={(e) => setPropAmount(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <Input
                placeholder="Recipient address"
                value={propRecipient}
                onChange={(e) => setPropRecipient(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <Row>
                <Input
                  type="number"
                  placeholder="Deadline (hours)"
                  value={propDeadlineHours}
                  onChange={(e) => setPropDeadlineHours(e.target.value)}
                  style={{ flex: "0 0 120px" }}
                />
                <Button onClick={handlePropose} disabled={!propAmount || !propRecipient}>
                  Submit Proposal
                </Button>
                <SecondaryButton onClick={() => setProposing(false)}>Cancel</SecondaryButton>
              </Row>
            </>
          ) : (
            <SecondaryButton onClick={() => setProposing(true)}>
              + Propose Spend
            </SecondaryButton>
          )}
        </>
      )}

      {/* Proposals */}
      {proposals.length > 0 && (
        <>
          <Divider />
          <SectionTitle>Active Proposals</SectionTitle>
          {proposals
            .filter((p) => !p.executed)
            .map((p) => (
              <ProposalCard key={p.id}>
                <ProposalMeta>
                  To {truncateAddress(p.recipient)} · {formatDeadline(p.deadlineMs)} ·{" "}
                  {p.voteCount} vote{p.voteCount !== 1 && "s"}
                </ProposalMeta>
                <ProposalAmount>{formatAmount(p.amount)} SUI</ProposalAmount>
                {cap && (
                  <Row style={{ marginTop: 8, marginBottom: 0 }}>
                    <SecondaryButton onClick={() => handleVote(p.id)}>Vote</SecondaryButton>
                    <SecondaryButton onClick={() => handleExecute(p.id)}>Execute</SecondaryButton>
                  </Row>
                )}
              </ProposalCard>
            ))}
        </>
      )}
    </Panel>
  );
}
