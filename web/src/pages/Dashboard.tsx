import styled from "styled-components";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useIdentity } from "../hooks/useIdentity";
import { useTribe } from "../hooks/useTribe";
import { getStats, getEvents } from "../lib/indexer";
import { timeAgo, formatAmount } from "../lib/format";
import { useCoinDecimals } from "../hooks/useCoinDecimals";
import { CopyableId } from "../components/shared/CopyableId";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { useNotifications } from "../hooks/useNotifications";
import type { ArchivedEvent } from "../lib/types";

const Page = styled.div``;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const ConnectPrompt = styled.div`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xxl};
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 16px;
`;

const OverviewGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const OverviewCard = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
`;

const CardLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const CardValue = styled.div`
  font-size: 20px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const SectionLabel = styled.h2`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const QuickActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.xl};
`;

const ActionLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.colors.primary.muted};
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: border-color 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const ActivityList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const ActivityRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: 13px;
`;

const EventName = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  flex: 1;
`;

const Meta = styled.span`
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 12px;
`;

const WarningBanner = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.warning}11;
  border: 1px solid ${({ theme }) => theme.colors.warning};
  border-left: 4px solid ${({ theme }) => theme.colors.warning};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const WarningTitle = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.warning};
`;

export function Dashboard() {
  const account = useCurrentAccount();
  const { tribeCaps, characterId, isLoading: identityLoading } = useIdentity();
  const { unreadCount } = useNotifications();
  const tribeId = tribeCaps[0]?.tribeId;
  const { tribe } = useTribe(tribeId);
  const { decimals: treasuryDecimals, symbol: treasurySymbol } = useCoinDecimals(tribe?.coinType ?? "");

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
  });

  const { data: recentEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ["recentEvents"],
    queryFn: () => getEvents({ limit: 10, order: "desc" }),
  });

  if (!account) {
    return (
      <Page>
        <Title>Dashboard</Title>
        <ConnectPrompt>Connect your wallet to get started.</ConnectPrompt>
      </Page>
    );
  }

  const events: ArchivedEvent[] = recentEvents?.events ?? [];

  return (
    <Page>
      <Title>Dashboard</Title>

      {!identityLoading && !characterId && (
        <WarningBanner>
          <div>
            <WarningTitle>No Character Found</WarningTitle>
            <div style={{ marginTop: 4 }}>
              No on-chain Character object was found for this wallet. Most actions (creating tribes,
              posting jobs, creating contracts) require a Character.{" "}
              {unreadCount > 0 && (
                <a href="/notifications" style={{ color: "inherit", textDecoration: "underline" }}>
                  View {unreadCount} notification{unreadCount !== 1 ? "s" : ""}
                </a>
              )}
            </div>
          </div>
        </WarningBanner>
      )}

      <OverviewGrid>
        <OverviewCard>
          <CardLabel>Wallet</CardLabel>
          <CardValue style={{ fontSize: 14 }}><CopyableId id={account.address} startLen={8} endLen={6} /></CardValue>
        </OverviewCard>
        <OverviewCard>
          <CardLabel>Character</CardLabel>
          <CardValue style={{ fontSize: 14 }}>
            {characterId ? <CopyableId id={characterId} /> : "—"}
          </CardValue>
        </OverviewCard>
        <OverviewCard>
          <CardLabel>Tribe</CardLabel>
          <CardValue style={{ fontSize: 14 }}>
            {tribe ? `${tribe.name} (#${tribe.inGameTribeId})` : "—"}
          </CardValue>
        </OverviewCard>
        <OverviewCard>
          <CardLabel>Treasury</CardLabel>
          <CardValue>{tribe ? `${formatAmount(tribe.treasuryBalance, treasuryDecimals)} ${treasurySymbol}` : "—"}</CardValue>
        </OverviewCard>
        <OverviewCard>
          <CardLabel>Total Events</CardLabel>
          <CardValue>{stats?.total_events?.toLocaleString() ?? "—"}</CardValue>
        </OverviewCard>
        <OverviewCard>
          <CardLabel>Tribe Caps</CardLabel>
          <CardValue>{tribeCaps.length}</CardValue>
        </OverviewCard>
      </OverviewGrid>

      <SectionLabel>Quick Actions</SectionLabel>
      <QuickActions>
        {tribeId && <ActionLink to={`/tribe/${tribeId}`}>→ Tribe</ActionLink>}
        <ActionLink to="/contracts">→ Contracts</ActionLink>
        <ActionLink to="/forge">→ Forge Planner</ActionLink>
        <ActionLink to="/events">→ Events</ActionLink>
      </QuickActions>

      <SectionLabel>Recent Activity</SectionLabel>
      {eventsLoading ? (
        <LoadingSpinner />
      ) : events.length === 0 ? (
        <Meta>No events yet.</Meta>
      ) : (
        <ActivityList>
          {events.map((ev) => (
            <ActivityRow key={ev.id}>
              <EventName>{ev.event_name.replace("Event", "")}</EventName>
              {ev.character_id && <Meta><CopyableId id={ev.character_id} /></Meta>}
              <Meta>{timeAgo(ev.timestamp_ms)}</Meta>
            </ActivityRow>
          ))}
        </ActivityList>
      )}
    </Page>
  );
}
