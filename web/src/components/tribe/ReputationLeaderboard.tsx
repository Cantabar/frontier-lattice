import styled from "styled-components";
import { useLeaderboard } from "../../hooks/useReputation";
import { truncateAddress } from "../../lib/format";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { EmptyState } from "../shared/EmptyState";

const List = styled.ol`
  list-style: none;
  padding: 0;
`;

const Entry = styled.li`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surface.border};

  &:last-child {
    border-bottom: none;
  }
`;

const Rank = styled.span`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.muted};
  width: 28px;
  text-align: right;
`;

const Character = styled.code`
  flex: 1;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const Score = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary.muted};
`;

export function ReputationLeaderboard({ tribeId }: { tribeId: string }) {
  const { data, isLoading } = useLeaderboard(tribeId);

  if (isLoading) return <LoadingSpinner />;
  if (!data?.leaderboard?.length) {
    return <EmptyState title="No reputation data" />;
  }

  return (
    <List>
      {data.leaderboard.map((entry, i) => (
        <Entry key={entry.character_id}>
          <Rank>{i + 1}</Rank>
          <Character>{truncateAddress(entry.character_id)}</Character>
          <Score>{entry.score}</Score>
        </Entry>
      ))}
    </List>
  );
}
