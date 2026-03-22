import { useState } from "react";
import { useParams } from "react-router-dom";
import styled from "styled-components";
import { useIdentity } from "../hooks/useIdentity";
import { useTribe } from "../hooks/useTribe";
import { TribeOverview } from "../components/tribe/TribeOverview";
import { MemberList } from "../components/tribe/MemberList";
import { ChangeRoleModal } from "../components/tribe/ChangeRoleModal";
import { TransferLeadershipModal } from "../components/tribe/TransferLeadershipModal";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import type { Role } from "../lib/types";

const Page = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 100%;
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const Subtitle = styled.span`
  font-size: 14px;
  font-weight: 400;
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
  const { tribeCaps } = useIdentity();
  const { tribe, isLoading } = useTribe(tribeId);

  const [roleTarget, setRoleTarget] = useState<{ characterId: string; currentRole: Role } | null>(null);
  const [transferTarget, setTransferTarget] = useState<string | null>(null);

  // Find TribeCap for this tribe (enables write actions)
  const cap = tribeCaps.find((c) => c.tribeId === tribeId) ?? null;

  if (!tribeId) {
    return (
      <Page>
        <Title>Tribe</Title>
        <EmptyState title="No tribe selected" description="Select a tribe from the sidebar." />
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
      <Title>
        {tribe.name}
        {tribe.inGameTribeId > 0 && (
          <Subtitle>Game Tribe #{tribe.inGameTribeId}</Subtitle>
        )}
      </Title>

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
