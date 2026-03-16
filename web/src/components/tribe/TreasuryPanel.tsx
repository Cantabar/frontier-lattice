import { useState } from "react";
import styled from "styled-components";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import type { TribeData, TribeCapData, TreasuryProposalData } from "../../lib/types";
import { formatAmount, formatDeadline } from "../../lib/format";
import { CopyableId } from "../shared/CopyableId";
import { isNativeSui, toBaseUnits } from "../../lib/coinUtils";
import { useCoinDecimals } from "../../hooks/useCoinDecimals";
import { useCoinObjectIds } from "../../hooks/useCoinTypes";
import { buildDepositToTreasury, buildWithdrawFromTreasury, buildProposeTreasurySpend, buildVoteOnProposal, buildExecuteProposal } from "../../lib/sui";
import { PrimaryButton, SecondaryButton as SharedSecondary } from "../shared/Button";

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
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { decimals, symbol: coinSymbol } = useCoinDecimals(tribe.coinType);
  const { objectIds: coinObjectIds } = useCoinObjectIds(tribe.coinType);

  /* Deposit */
  const [depositAmount, setDepositAmount] = useState("");

  async function handleDeposit() {
    const amount = toBaseUnits(depositAmount, decimals);
    if (!amount) return;
    const tx = buildDepositToTreasury({
      tribeId: tribe.id,
      amount,
      coinType: tribe.coinType,
      coinObjectIds: isNativeSui(tribe.coinType) ? undefined : coinObjectIds,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
    await signAndExecute({ transaction: tx as any });
    setDepositAmount("");
  }

  /* Withdraw */
  const [withdrawAmount, setWithdrawAmount] = useState("");

  async function handleWithdraw() {
    if (!cap) return;
    const amount = toBaseUnits(withdrawAmount, decimals);
    if (!amount) return;
    const tx = buildWithdrawFromTreasury({ tribeId: tribe.id, capId: cap.id, amount, recipient: account!.address, coinType: tribe.coinType });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
    await signAndExecute({ transaction: tx as any });
    setWithdrawAmount("");
  }

  /* Propose */
  const [proposing, setProposing] = useState(false);
  const [propAmount, setPropAmount] = useState("");
  const [propRecipient, setPropRecipient] = useState("");
  const [propDeadlineHours, setPropDeadlineHours] = useState("24");

  async function handlePropose() {
    if (!cap) return;
    const amount = toBaseUnits(propAmount, decimals);
    const deadlineMs = Date.now() + Number(propDeadlineHours) * 3600 * 1000;
    const tx = buildProposeTreasurySpend({
      tribeId: tribe.id,
      capId: cap.id,
      amount,
      recipient: propRecipient,
      deadlineMs,
      coinType: tribe.coinType,
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
    const tx = buildVoteOnProposal({ tribeId: tribe.id, proposalId, capId: cap.id, coinType: tribe.coinType });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
  }

  async function handleExecute(proposalId: string) {
    const tx = buildExecuteProposal({ tribeId: tribe.id, proposalId, coinType: tribe.coinType });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
  }

  return (
    <Panel>
      <SectionTitle>Treasury</SectionTitle>
      <Balance>{formatAmount(tribe.treasuryBalance, decimals)} {coinSymbol}</Balance>

      {/* Deposit */}
      <Row>
        <Input
          type="number"
          placeholder={`Amount (${coinSymbol})`}
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
        />
        <PrimaryButton onClick={handleDeposit} disabled={!depositAmount}>
          Deposit
        </PrimaryButton>
      </Row>

      {/* Withdraw (Leader/Officer only) */}
      {cap && (cap.role === "Leader" || cap.role === "Officer") && (
        <Row>
          <Input
            type="number"
            placeholder={`Withdraw (${coinSymbol})`}
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
          />
          <SharedSecondary onClick={handleWithdraw} disabled={!withdrawAmount}>
            Withdraw
          </SharedSecondary>
        </Row>
      )}

      {cap && (
        <>
          {proposing ? (
            <>
              <Input
                type="number"
                placeholder={`Amount (${coinSymbol})`}
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
                <PrimaryButton onClick={handlePropose} disabled={!propAmount || !propRecipient}>
                  Submit Proposal
                </PrimaryButton>
                <SharedSecondary onClick={() => setProposing(false)}>Cancel</SharedSecondary>
              </Row>
            </>
          ) : (
            <SharedSecondary onClick={() => setProposing(true)}>
              + Propose Spend
            </SharedSecondary>
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
                  To <CopyableId id={p.recipient} /> · {formatDeadline(p.deadlineMs)} ·{" "}
                  {p.voteCount} vote{p.voteCount !== 1 && "s"}
                </ProposalMeta>
                <ProposalAmount>{formatAmount(p.amount, decimals)} {coinSymbol}</ProposalAmount>
                {cap && (
                  <Row style={{ marginTop: 8, marginBottom: 0 }}>
                    <SharedSecondary onClick={() => handleVote(p.id)}>Vote</SharedSecondary>
                    <SharedSecondary onClick={() => handleExecute(p.id)}>Execute</SharedSecondary>
                  </Row>
                )}
              </ProposalCard>
            ))}
        </>
      )}
    </Panel>
  );
}
