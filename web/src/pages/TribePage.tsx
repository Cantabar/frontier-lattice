import { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useIdentity } from "../hooks/useIdentity";
import { useTribe } from "../hooks/useTribe";
import { TribeOverview } from "../components/tribe/TribeOverview";
import { MemberList } from "../components/tribe/MemberList";
import { CreateTribeModal } from "../components/tribe/CreateTribeModal";
import { AddMemberModal } from "../components/tribe/AddMemberModal";
import { ChangeRoleModal } from "../components/tribe/ChangeRoleModal";
import { TransferLeadershipModal } from "../components/tribe/TransferLeadershipModal";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import { PrimaryButton, SecondaryButton as SecondaryBtn } from "../components/shared/Button";
import type { Role } from "../lib/types";

const Page = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 100%;
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

const DisabledHint = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-left: ${({ theme }) => theme.spacing.sm};
`;

const SectionLabel = styled.h2`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin: ${({ theme }) => theme.spacing.lg} 0 ${({ theme }) => theme.spacing.md};
`;


export function TribePage() {
  const { tribeId } = useParams<{ tribeId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { tribeCaps } = useIdentity();
  const { tribe, isLoading, isPending } = useTribe(tribeId);
  const hasTribeCap = tribeCaps.length > 0;

  const justCreated = (location.state as { justCreated?: boolean })?.justCreated ?? false;
  const createdName = (location.state as { tribeName?: string })?.tribeName;

  // Clear navigation state once the tribe has loaded to avoid stale state on back-nav
  useEffect(() => {
    if (justCreated && tribe) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [justCreated, tribe, navigate, location.pathname]);

  const [showCreate, setShowCreate] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [roleTarget, setRoleTarget] = useState<{ characterId: string; currentRole: Role } | null>(null);
  const [transferTarget, setTransferTarget] = useState<string | null>(null);

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
            <PrimaryButton
              onClick={() => setShowCreate(true)}
              disabled={hasTribeCap}
            >
              + Create Tribe
            </PrimaryButton>
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

  if (!tribe && (justCreated || isPending)) {
    return (
      <Page>
        <Title>{createdName ?? "Tribe"}</Title>
        <LoadingSpinner />
        <EmptyState
          title="Confirming tribe on chain…"
          description="Waiting for the network to index your new tribe. This usually takes a few seconds."
        />
      </Page>
    );
  }

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
            <PrimaryButton onClick={() => setShowAddMember(true)}>+ Add Member</PrimaryButton>
          )}
          <SecondaryBtn
            onClick={() => setShowCreate(true)}
            disabled={hasTribeCap}
            title={hasTribeCap ? "A character can only belong to 1 tribe" : undefined}
          >
            + New Tribe
          </SecondaryBtn>
        </ActionRow>
      </Header>

      <TribeOverview tribe={tribe} />

      <SectionLabel>Members</SectionLabel>
      <MemberList
        members={tribe.members}
        tribeId={tribe.id}
        leaderCharacterId={tribe.leaderCharacterId}
        cap={cap}
        onChangeRole={(characterId, currentRole) =>
          setRoleTarget({ characterId, currentRole })
        }
        onTransferLeadership={(characterId) =>
          setTransferTarget(characterId)
        }
      />

      {showCreate && <CreateTribeModal onClose={() => setShowCreate(false)} />}
      {showAddMember && cap && (
        <AddMemberModal tribeId={tribe.id} cap={cap} onClose={() => setShowAddMember(false)} />
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
      {transferTarget && cap && (
        <TransferLeadershipModal
          tribeId={tribe.id}
          capId={cap.id}
          members={tribe.members}
          leaderCharacterId={tribe.leaderCharacterId}
          preselectedCharacterId={transferTarget}
          onClose={() => setTransferTarget(null)}
        />
      )}
    </Page>
  );
}
