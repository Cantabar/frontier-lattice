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
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";

const Page = styled.div`
  max-width: 960px;
`;

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

  const [showCreate, setShowCreate] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);

  // Find TribeCap for this tribe (enables write actions)
  const cap = tribeCaps.find((c) => c.tribeId === tribeId) ?? null;
  const isLeaderOrOfficer = cap && (cap.role === "Leader" || cap.role === "Officer");

  if (!tribeId) {
    return (
      <Page>
        <Header>
          <Title>Tribe</Title>
          <Button onClick={() => setShowCreate(true)}>+ Create Tribe</Button>
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
        <Title>{tribe.name}</Title>
        <ActionRow>
          {isLeaderOrOfficer && (
            <Button onClick={() => setShowAddMember(true)}>+ Add Member</Button>
          )}
          <SecondaryButton onClick={() => setShowCreate(true)}>+ New Tribe</SecondaryButton>
        </ActionRow>
      </Header>

      <TribeOverview tribe={tribe} />

      <Grid>
        <div>
          <SectionLabel>Members</SectionLabel>
          <MemberList members={tribe.members} />

          <SectionLabel>Reputation</SectionLabel>
          <ReputationLeaderboard tribeId={tribe.id} />
        </div>

        <div>
          <TreasuryPanel tribe={tribe} cap={cap} proposals={[]} />
        </div>
      </Grid>

      {showCreate && <CreateTribeModal onClose={() => setShowCreate(false)} />}
      {showAddMember && cap && (
        <AddMemberModal tribeId={tribe.id} cap={cap} onClose={() => setShowAddMember(false)} />
      )}
    </Page>
  );
}
