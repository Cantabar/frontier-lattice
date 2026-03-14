import { useState } from "react";
import { useParams } from "react-router-dom";
import styled from "styled-components";
import { useIdentity } from "../hooks/useIdentity";
import { useTribe } from "../hooks/useTribe";
import { TribeOverview } from "../components/tribe/TribeOverview";
import { MemberList } from "../components/tribe/MemberList";
import { ReputationLeaderboard } from "../components/tribe/ReputationLeaderboard";
import { TreasuryPanel } from "../components/tribe/TreasuryPanel";
import { CreateTribeModal } from "../components/tribe/CreateTribeModal";
import { AddMemberModal } from "../components/tribe/AddMemberModal";
import { UpdateReputationModal } from "../components/tribe/UpdateReputationModal";
import { ChangeRoleModal } from "../components/tribe/ChangeRoleModal";
import { IssueRepCapModal } from "../components/tribe/IssueRepCapModal";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import type { Role } from "../lib/types";

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

const Subtitle = styled.span`
  font-size: 14px;
  font-weight: 400;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-left: ${({ theme }) => theme.spacing.sm};
`;

const ActionRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
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

const DisabledHint = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-left: ${({ theme }) => theme.spacing.sm};
`;

const SecondaryButton = styled(Button)`
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.text.secondary};

  &:hover {
    background: ${({ theme }) => theme.colors.surface.borderHover};
  }
`;

const SectionLabel = styled.h2`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin: ${({ theme }) => theme.spacing.lg} 0 ${({ theme }) => theme.spacing.md};
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.lg};
  align-items: start;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

export function TribePage() {
  const { tribeId } = useParams<{ tribeId: string }>();
  const { tribeCaps } = useIdentity();
  const { tribe, isLoading } = useTribe(tribeId);
  const hasTribeCap = tribeCaps.length > 0;

  const [showCreate, setShowCreate] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [repTarget, setRepTarget] = useState<{ characterId: string; reputation: number } | null>(null);
  const [roleTarget, setRoleTarget] = useState<{ characterId: string; currentRole: Role } | null>(null);
  const [showIssueRepCap, setShowIssueRepCap] = useState(false);

  // Find TribeCap for this tribe (enables write actions)
  const cap = tribeCaps.find((c) => c.tribeId === tribeId) ?? null;
  const isLeader = cap?.role === "Leader";
  const isLeaderOrOfficer = cap && (cap.role === "Leader" || cap.role === "Officer");

  if (!tribeId) {
    return (
      <Page>
        <Header>
          <Title>Tribe</Title>
          <div>
            <Button
              onClick={() => setShowCreate(true)}
              disabled={hasTribeCap}
            >
              + Create Tribe
            </Button>
            {hasTribeCap && (
              <DisabledHint>A character can only belong to 1 tribe</DisabledHint>
            )}
          </div>
        </Header>
        <EmptyState title="No tribe selected" description="Create a new tribe or select one from the sidebar." />
        {showCreate && <CreateTribeModal onClose={() => setShowCreate(false)} />}
      </Page>
    );
  }

  if (isLoading) return <LoadingSpinner />;

  if (!tribe) {
    return (
      <Page>
        <Title>Tribe</Title>
        <EmptyState title="Tribe not found" description={`No tribe found with ID ${tribeId}`} />
      </Page>
    );
  }

  return (
    <Page>
      <Header>
        <Title>
          {tribe.name}
          {tribe.inGameTribeId > 0 && (
            <Subtitle>Game Tribe #{tribe.inGameTribeId}</Subtitle>
          )}
        </Title>
        <ActionRow>
          {isLeaderOrOfficer && (
            <Button onClick={() => setShowAddMember(true)}>+ Add Member</Button>
          )}
          <SecondaryButton
            onClick={() => setShowCreate(true)}
            disabled={hasTribeCap}
            title={hasTribeCap ? "A character can only belong to 1 tribe" : undefined}
          >
            + New Tribe
          </SecondaryButton>
        </ActionRow>
      </Header>

      <TribeOverview tribe={tribe} />

      <Grid>
        <div>
          <SectionLabel>Members</SectionLabel>
          <MemberList
            members={tribe.members}
            tribeId={tribe.id}
            leaderCharacterId={tribe.leaderCharacterId}
            cap={cap}
            onUpdateReputation={(characterId, reputation) =>
              setRepTarget({ characterId, reputation })
            }
            onChangeRole={(characterId, currentRole) =>
              setRoleTarget({ characterId, currentRole })
            }
          />

          <SectionLabel>Reputation</SectionLabel>
          <ReputationLeaderboard tribeId={tribe.id} />
        </div>

        <div>
          <TreasuryPanel tribe={tribe} cap={cap} proposals={[]} />
        </div>
      </Grid>

      {/* Tribe Admin (Leader only) */}
      {isLeader && cap && (
        <>
          <SectionLabel>Tribe Admin</SectionLabel>
          <ActionRow>
            <SecondaryButton onClick={() => setShowIssueRepCap(true)}>
              Issue RepUpdateCap
            </SecondaryButton>
          </ActionRow>
        </>
      )}

      {showCreate && <CreateTribeModal onClose={() => setShowCreate(false)} />}
      {showAddMember && cap && (
        <AddMemberModal tribeId={tribe.id} cap={cap} onClose={() => setShowAddMember(false)} />
      )}
      {repTarget && cap && (
        <UpdateReputationModal
          tribeId={tribe.id}
          capId={cap.id}
          characterId={repTarget.characterId}
          currentReputation={repTarget.reputation}
          onClose={() => setRepTarget(null)}
        />
      )}
      {roleTarget && cap && (
        <ChangeRoleModal
          tribeId={tribe.id}
          capId={cap.id}
          characterId={roleTarget.characterId}
          currentRole={roleTarget.currentRole}
          onClose={() => setRoleTarget(null)}
        />
      )}
      {showIssueRepCap && cap && (
        <IssueRepCapModal
          tribeId={tribe.id}
          capId={cap.id}
          onClose={() => setShowIssueRepCap(false)}
        />
      )}
    </Page>
  );
}
