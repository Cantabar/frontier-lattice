import styled from "styled-components";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import type { JobPostingData, TribeCapData } from "../../lib/types";
import { formatAmount, formatDeadline } from "../../lib/format";
import { CharacterDisplay } from "../shared/CharacterDisplay";
import { StatusBadge } from "../shared/StatusBadge";
import { useIdentity } from "../../hooks/useIdentity";
import { buildAcceptJob, buildConfirmCompletion, buildCancelJob, buildExpireJob } from "../../lib/sui";
import { PrimaryButton, SecondaryButton as SharedSecondary, DangerButton as SharedDanger } from "../shared/Button";

const Wrapper = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.lg};
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Title = styled.h3`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const Description = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  line-height: 1.5;
`;

const DetailGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const Label = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const Value = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.primary};
  font-weight: 500;
`;

const ActionRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  border-top: 1px solid ${({ theme }) => theme.colors.surface.border};
  padding-top: ${({ theme }) => theme.spacing.md};
`;

interface Props {
  job: JobPostingData;
  cap: TribeCapData | null;
}

export function JobDetail({ job, cap }: Props) {
  const { characterId } = useIdentity();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const isPoster = characterId === job.posterId;
  const isAssignee = characterId === job.assigneeId;

  async function handleAccept() {
    if (!cap || !characterId) return;
    const tx = buildAcceptJob({
      jobId: job.id,
      tribeId: job.posterTribeId,
      capId: cap.id,
      characterId,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
  }

  async function handleConfirm() {
    if (!cap) return;
    const tx = buildConfirmCompletion({ jobId: job.id, capId: cap.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
  }

  async function handleCancel() {
    if (!cap) return;
    const tx = buildCancelJob({ jobId: job.id, capId: cap.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
  }

  async function handleExpire() {
    const tx = buildExpireJob({ jobId: job.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await signAndExecute({ transaction: tx as any });
  }

  return (
    <Wrapper>
      <Header>
        <Title>Job Details</Title>
        <StatusBadge status={job.status.toLowerCase() as "open" | "assigned" | "disputed"} />
      </Header>

      <Description>{job.description}</Description>

      <DetailGrid>
        <div>
          <Label>Reward</Label>
          <Value>{formatAmount(job.rewardAmount)} SUI</Value>
        </div>
        <div>
          <Label>Deadline</Label>
          <Value>{formatDeadline(job.deadlineMs)}</Value>
        </div>
        <div>
          <Label>Poster</Label>
          <Value><CharacterDisplay characterId={job.posterId} /></Value>
        </div>
        <div>
          <Label>Assignee</Label>
          <Value>{job.assigneeId ? <CharacterDisplay characterId={job.assigneeId} /> : "—"}</Value>
        </div>
        <div>
          <Label>Completion</Label>
          <Value>{job.completionType.variant}</Value>
        </div>
        <div>
          <Label>Min Reputation</Label>
          <Value>{job.minReputation}</Value>
        </div>
      </DetailGrid>

      <ActionRow>
        {job.status === "Open" && !isPoster && cap && (
          <PrimaryButton onClick={handleAccept}>Accept Job</PrimaryButton>
        )}
        {job.status === "Assigned" && isPoster && cap && (
          <PrimaryButton onClick={handleConfirm}>Confirm Completion</PrimaryButton>
        )}
        {(isPoster || isAssignee) && cap && job.status !== "Open" && (
          <SharedDanger onClick={handleCancel}>Cancel</SharedDanger>
        )}
        <SharedSecondary onClick={handleExpire}>Expire</SharedSecondary>
      </ActionRow>
    </Wrapper>
  );
}
