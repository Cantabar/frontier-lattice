import styled from "styled-components";
import type { TribeMember } from "../../lib/types";
import { truncateAddress } from "../../lib/format";

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

export function MemberList({ members }: { members: TribeMember[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Character</Th>
          <Th>Role</Th>
          <Th>Reputation</Th>
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
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
