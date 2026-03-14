import styled from "styled-components";
import type { TribeMember, TribeCapData } from "../../lib/types";
import { truncateAddress } from "../../lib/format";
import { RemoveMemberButton } from "./RemoveMemberButton";

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const Th = styled.th`
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surface.border};
`;

const Td = styled.td`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surface.border};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const RoleBadge = styled.span<{ $role: string }>`
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ $role, theme }) =>
    $role === "Leader"
      ? theme.colors.primary.subtle
      : $role === "Officer"
        ? "#1a2a3a"
        : theme.colors.surface.overlay};
  color: ${({ $role, theme }) =>
    $role === "Leader"
      ? theme.colors.primary.main
      : $role === "Officer"
        ? "#4FC3F7"
        : theme.colors.text.muted};
`;

const ActionCell = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  align-items: center;
`;

const RepButton = styled.button`
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.muted};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
    color: ${({ theme }) => theme.colors.primary.main};
  }
`;

interface Props {
  members: TribeMember[];
  tribeId: string;
  leaderCharacterId: string;
  cap: TribeCapData | null;
  onUpdateReputation?: (characterId: string, currentReputation: number) => void;
}

export function MemberList({ members, tribeId, leaderCharacterId, cap, onUpdateReputation }: Props) {
  const isLeader = cap?.role === "Leader";
  const isLeaderOrOfficer = cap && (cap.role === "Leader" || cap.role === "Officer");

  return (
    <Table>
      <thead>
        <tr>
          <Th>Character</Th>
          <Th>Role</Th>
          <Th>Reputation</Th>
          {(isLeader || isLeaderOrOfficer) && <Th>Actions</Th>}
        </tr>
      </thead>
      <tbody>
        {members.map((m) => (
          <tr key={m.characterId}>
            <Td>
              <code>{truncateAddress(m.characterId)}</code>
            </Td>
            <Td>
              <RoleBadge $role={m.role}>{m.role}</RoleBadge>
            </Td>
            <Td>{m.reputation}</Td>
            {(isLeader || isLeaderOrOfficer) && (
              <Td>
                <ActionCell>
                  {isLeaderOrOfficer && onUpdateReputation && (
                    <RepButton onClick={() => onUpdateReputation(m.characterId, m.reputation)}>
                      Rep
                    </RepButton>
                  )}
                  {isLeader && m.characterId !== leaderCharacterId && cap && (
                    <RemoveMemberButton
                      tribeId={tribeId}
                      capId={cap.id}
                      characterId={m.characterId}
                    />
                  )}
                </ActionCell>
              </Td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
