import { useState } from "react";
import styled from "styled-components";
import { useIdentity } from "../hooks/useIdentity";
import { useActiveJobs } from "../hooks/useJobs";
import { JobCard } from "../components/jobs/JobCard";
import { JobDetail } from "../components/jobs/JobDetail";
import { CreateJobModal } from "../components/jobs/CreateJobModal";
import { JobHistory } from "../components/jobs/JobHistory";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import type { JobPostingData } from "../lib/types";

const Page = styled.div``;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const TabRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const Tab = styled.button<{ $active: boolean }>`
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary.subtle : theme.colors.surface.raised};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
  border: 1px solid ${({ $active, theme }) =>
    $active ? theme.colors.primary.subtle : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
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
`;

const Grid = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const SectionLabel = styled.h2`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin: ${({ theme }) => theme.spacing.lg} 0 ${({ theme }) => theme.spacing.md};
`;

type StatusTab = "all" | "Open" | "Assigned" | "Disputed";

export function ContractBoard() {
  const { tribeCaps } = useIdentity();
  const { events, isLoading } = useActiveJobs();

  const [tab, setTab] = useState<StatusTab>("all");
  const [selectedJob, setSelectedJob] = useState<JobPostingData | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // First tribe cap for posting jobs
  const cap = tribeCaps[0] ?? null;
  const tribeId = cap?.tribeId;

  // Parse job events into JobPostingData (simplified — real impl would query objects)
  const jobs: JobPostingData[] = events.map((ev) => {
    const d = ev.parsedJson as Record<string, unknown> | undefined;
    return {
      id: (d?.job_id as string) ?? ev.id.txDigest,
      posterId: (d?.poster_character_id as string) ?? "",
      posterAddress: (d?.poster_address as string) ?? "",
      posterTribeId: (d?.tribe_id as string) ?? "",
      description: (d?.description as string) ?? "Job",
      completionType: { variant: "Custom" as const, commitmentHash: [] },
      rewardAmount: String(d?.reward_amount ?? "0"),
      deadlineMs: String(d?.deadline_ms ?? "0"),
      status: "Open" as const,
      minReputation: Number(d?.min_reputation ?? 0),
    };
  });

  const filtered = tab === "all" ? jobs : jobs.filter((j) => j.status === tab);

  if (isLoading) return <LoadingSpinner />;

  return (
    <Page>
      <Header>
        <Title>Contract Board</Title>
        {cap && <Button onClick={() => setShowCreate(true)}>+ Post Job</Button>}
      </Header>

      <TabRow>
        {(["all", "Open", "Assigned", "Disputed"] as StatusTab[]).map((t) => (
          <Tab key={t} $active={tab === t} onClick={() => setTab(t)}>
            {t === "all" ? "All" : t}
          </Tab>
        ))}
      </TabRow>

      {selectedJob ? (
        <>
          <Button onClick={() => setSelectedJob(null)} style={{ marginBottom: 16, background: "#2D2B2B" }}>
            ← Back to list
          </Button>
          <JobDetail job={selectedJob} cap={cap} />
        </>
      ) : (
        <>
          {filtered.length === 0 ? (
            <EmptyState
              title="No active jobs"
              description="Post a job or connect your wallet to browse contracts."
            />
          ) : (
            <Grid>
              {filtered.map((job) => (
                <JobCard key={job.id} job={job} onClick={() => setSelectedJob(job)} />
              ))}
            </Grid>
          )}
        </>
      )}

      {tribeId && (
        <>
          <SectionLabel>Job History</SectionLabel>
          <JobHistory tribeId={tribeId} />
        </>
      )}

      {showCreate && cap && tribeId && (
        <CreateJobModal tribeId={tribeId} cap={cap} onClose={() => setShowCreate(false)} />
      )}
    </Page>
  );
}
