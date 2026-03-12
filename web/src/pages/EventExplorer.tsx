import { useState } from "react";
import styled from "styled-components";
import { useQuery } from "@tanstack/react-query";
import { getEvents } from "../lib/indexer";
import { timeAgo, truncateAddress } from "../lib/format";
import { ProofViewer } from "../components/events/ProofViewer";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import type { EventTypeName, ArchivedEvent } from "../lib/types";

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

const FilterRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  flex-wrap: wrap;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const FilterChip = styled.button<{ $active: boolean; $color: string }>`
  background: ${({ $active, $color }) => ($active ? $color + "22" : "transparent")};
  color: ${({ $active, $color, theme }) => ($active ? $color : theme.colors.text.muted)};
  border: 1px solid ${({ $active, $color, theme }) =>
    $active ? $color : theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: 2px ${({ theme }) => theme.spacing.sm};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
`;

const EventList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const EventRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.surface.borderHover};
  }
`;

const ModuleBadge = styled.span<{ $color: string }>`
  font-size: 11px;
  font-weight: 700;
  color: ${({ $color }) => $color};
  text-transform: uppercase;
  min-width: 80px;
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

const PageNav = styled.div`
  display: flex;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.lg};
`;

const NavButton = styled.button`
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.text.secondary};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  cursor: pointer;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

type ModuleFilter = "all" | "tribe" | "contractBoard" | "forgePlanner";

const MODULE_COLORS: Record<string, string> = {
  tribe: "#FF4700",
  contractBoard: "#4FC3F7",
  forgePlanner: "#81C784",
};

function moduleOf(eventName: string): string {
  if (eventName.includes("Job") || eventName.includes("Bounty")) return "contractBoard";
  if (eventName.includes("Recipe") || eventName.includes("Order") || eventName.includes("Manufacturing")) return "forgePlanner";
  return "tribe";
}

const PAGE_SIZE = 30;

export function EventExplorer() {
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>("all");
  const [offset, setOffset] = useState(0);
  const [proofEventId, setProofEventId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["events", offset],
    queryFn: () => getEvents({ limit: PAGE_SIZE, offset, order: "desc" }),
  });

  const events: ArchivedEvent[] = data?.events ?? [];
  const filtered =
    moduleFilter === "all"
      ? events
      : events.filter((ev) => moduleOf(ev.event_name) === moduleFilter);

  return (
    <Page>
      <Header>
        <Title>Event Explorer</Title>
        <Meta>{events.length > 0 && `Showing ${offset + 1}–${offset + events.length}`}</Meta>
      </Header>

      <FilterRow>
        {(["all", "tribe", "contractBoard", "forgePlanner"] as ModuleFilter[]).map((m) => (
          <FilterChip
            key={m}
            $active={moduleFilter === m}
            $color={m === "all" ? "#FFFFFE" : MODULE_COLORS[m]}
            onClick={() => setModuleFilter(m)}
          >
            {m === "all" ? "All" : m === "contractBoard" ? "Contracts" : m === "forgePlanner" ? "Forge" : "Tribe"}
          </FilterChip>
        ))}
      </FilterRow>

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="Events will appear here once the indexer is running and contracts are deployed."
        />
      ) : (
        <EventList>
          {filtered.map((ev) => {
            const mod = moduleOf(ev.event_name);
            return (
              <EventRow key={ev.id} onClick={() => setProofEventId(ev.id)}>
                <ModuleBadge $color={MODULE_COLORS[mod] ?? "#9E8C87"}>
                  {mod === "contractBoard" ? "BOARD" : mod === "forgePlanner" ? "FORGE" : "TRIBE"}
                </ModuleBadge>
                <EventName>{ev.event_name.replace("Event", "")}</EventName>
                {ev.character_id && <Meta>{truncateAddress(ev.character_id)}</Meta>}
                <Meta>{timeAgo(ev.timestamp_ms)}</Meta>
              </EventRow>
            );
          })}
        </EventList>
      )}

      <PageNav>
        <NavButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          ← Prev
        </NavButton>
        <NavButton disabled={events.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>
          Next →
        </NavButton>
      </PageNav>

      {proofEventId !== null && (
        <ProofViewer eventId={proofEventId} onClose={() => setProofEventId(null)} />
      )}
    </Page>
  );
}
