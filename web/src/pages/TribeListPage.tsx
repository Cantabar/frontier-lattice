import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useSuiClient } from "@mysten/dapp-kit";
import { useIdentity } from "../hooks/useIdentity";
import { useAllTribes } from "../hooks/useAllTribes";
import { useTribe } from "../hooks/useTribe";
import { CreateTribeModal } from "../components/tribe/CreateTribeModal";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import { buildLookupTribeByGameId } from "../lib/sui";
import { CopyableId } from "../components/shared/CopyableId";
import { config } from "../config";
import { PrimaryButton } from "../components/shared/Button";
import type { TribeListItem } from "../lib/types";

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

const SectionLabel = styled.h2`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin: ${({ theme }) => theme.spacing.lg} 0 ${({ theme }) => theme.spacing.md};
`;

/* Your Tribe card */
const YourTribeCard = styled(Link)`
  display: block;
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.primary.main};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.lg};
  text-decoration: none;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  transition: border-color 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.hover};
  }
`;

const TribeCardName = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const TribeCardMeta = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const RoleBadge = styled.span`
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.colors.primary.subtle};
  color: ${({ theme }) => theme.colors.primary.main};
  margin-left: ${({ theme }) => theme.spacing.sm};
`;

/* Lookup section */
const LookupRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const Input = styled.input`
  flex: 1;
  max-width: 280px;
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 14px;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const LookupError = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

/* Tribe table */
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

const TribeLink = styled(Link)`
  color: ${({ theme }) => theme.colors.primary.muted};
  text-decoration: none;
  font-weight: 600;

  &:hover {
    text-decoration: underline;
  }
`;

const MutedRow = styled.tr`
  opacity: 0.6;
`;

const Ticker = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-left: ${({ theme }) => theme.spacing.xs};
`;

const StatusDot = styled.span<{ $active: boolean }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
`;

const StatusLabel = styled.span<{ $active: boolean }>`
  font-size: 12px;
  font-weight: 600;
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary.main : theme.colors.text.muted};
`;

const SmallButton = styled.button`
  background: ${({ theme }) => theme.colors.surface.overlay};
  color: ${({ theme }) => theme.colors.text.secondary};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.surface.borderHover};
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

/** How long (ms) to poll the indexer after creating a tribe. */
const POLL_DURATION_MS = 15_000;
const POLL_INTERVAL_MS = 3_000;

export function TribeListPage() {
  const navigate = useNavigate();
  const client = useSuiClient();
  const { tribeCaps, inGameTribeId } = useIdentity();
  const hasTribeCap = tribeCaps.length > 0;

  // Optimistic tribe entry + polling
  const [optimistic, setOptimistic] = useState<TribeListItem | null>(null);
  const [refetchInterval, setRefetchInterval] = useState<number | false>(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const { allTribes, isLoading } = useAllTribes({ refetchInterval });
  const [showCreate, setShowCreate] = useState(false);

  // Clear optimistic entry once the merged list contains the real tribe
  useEffect(() => {
    if (
      optimistic &&
      allTribes.some(
        (t) => t.onChainTribe?.id === optimistic.id || t.onChainTribe?.name === optimistic.name,
      )
    ) {
      setOptimistic(null);
      setRefetchInterval(false);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    }
  }, [allTribes, optimistic]);

  // Stop polling after the duration elapses
  useEffect(() => {
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
  }, []);

  const handleTribeCreated = useCallback((tribe: TribeListItem) => {
    setOptimistic(tribe);
    setRefetchInterval(POLL_INTERVAL_MS);
    // Auto-stop polling after the duration
    pollTimerRef.current = setTimeout(() => {
      setRefetchInterval(false);
    }, POLL_DURATION_MS);
  }, []);

  // Lookup state
  const [lookupId, setLookupId] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [lookupPending, setLookupPending] = useState(false);

  // User's first tribe
  const userCap = tribeCaps[0] ?? null;
  const { tribe: userTribe } = useTribe(userCap?.tribeId);

  async function handleLookup() {
    const gameId = Number(lookupId);
    if (!gameId || gameId <= 0) {
      setLookupError("Enter a valid game tribe ID.");
      return;
    }
    setLookupError("");
    setLookupPending(true);
    try {
      const tx = buildLookupTribeByGameId({
        registryId: config.tribeRegistryId,
        gameId,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate @mysten/sui in dep tree
      const result = await client.devInspectTransactionBlock({
        transactionBlock: tx as any,
        sender: "0x0000000000000000000000000000000000000000000000000000000000000000",
      });

      // Parse the Option<ID> return value
      const returnValues = result.results?.[0]?.returnValues;
      if (returnValues && returnValues.length > 0) {
        const bytes = returnValues[0][0];
        // Option<ID>: first byte 1 = Some, 0 = None
        if (bytes instanceof Uint8Array ? bytes[0] === 1 : Number(bytes[0]) === 1) {
          // Extract the 32-byte ID after the option tag
          const idBytes = bytes instanceof Uint8Array ? bytes.slice(1) : bytes.slice(1);
          const hex = "0x" + Array.from(idBytes).map((b: number) => b.toString(16).padStart(2, "0")).join("");
          navigate(`/tribe/${hex}`);
          return;
        }
      }
      setLookupError(`No tribe found for in-game tribe #${gameId}.`);
    } catch {
      setLookupError("Lookup failed. Check network connection.");
    } finally {
      setLookupPending(false);
    }
  }

  return (
    <Page>
      <Header>
        <Title>Tribes</Title>
        <div>
          <PrimaryButton
            onClick={() => setShowCreate(true)}
            disabled={hasTribeCap || optimistic !== null}
          >
            + Initialize Tribe
          </PrimaryButton>
          {(hasTribeCap || optimistic !== null) && (
            <DisabledHint>A character can only belong to 1 tribe</DisabledHint>
          )}
        </div>
      </Header>

      {/* Your Tribe */}
      {userCap && userTribe && (
        <>
          <SectionLabel>Your Tribe</SectionLabel>
          <YourTribeCard to={`/tribe/${userCap.tribeId}`}>
            <TribeCardName>
              {userTribe.name}
              <RoleBadge>{userCap.role}</RoleBadge>
            </TribeCardName>
            <TribeCardMeta>
              Game Tribe #{userTribe.inGameTribeId} · {userTribe.memberCount} member
              {userTribe.memberCount !== 1 && "s"}
            </TribeCardMeta>
          </YourTribeCard>
        </>
      )}

      {!userCap && inGameTribeId != null && inGameTribeId > 0 && (
        <>
          <SectionLabel>Your Tribe</SectionLabel>
          <EmptyState
            title={`Game tribe #${inGameTribeId} has no on-chain tribe yet`}
            description="Initialize your tribe on-chain to unlock tribe features."
          />
        </>
      )}

      {/* Find by Game ID */}
      <SectionLabel>Find Tribe by Game ID</SectionLabel>
      <LookupRow>
        <Input
          type="number"
          placeholder="Enter in-game tribe ID"
          value={lookupId}
          onChange={(e) => { setLookupId(e.target.value); setLookupError(""); }}
          onKeyDown={(e) => e.key === "Enter" && handleLookup()}
        />
        <PrimaryButton onClick={handleLookup} disabled={lookupPending || !lookupId}>
          {lookupPending ? "Looking up…" : "Lookup"}
        </PrimaryButton>
        {lookupError && <LookupError>{lookupError}</LookupError>}
      </LookupRow>

      {/* All Tribes */}
      <SectionLabel>All Tribes</SectionLabel>
      {isLoading ? (
        <LoadingSpinner />
      ) : allTribes.length === 0 && !optimistic ? (
        <EmptyState title="No tribes found" description="Initialize the first tribe to get started." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Tribe</Th>
              <Th>Status</Th>
              <Th>Members</Th>
              <Th>Leader</Th>
              <Th>Object ID</Th>
            </tr>
          </thead>
          <tbody>
            {/* Optimistic entry (if not yet merged) */}
            {optimistic && !allTribes.some((t) => t.onChainTribe?.id === optimistic.id) && (
              <tr key={optimistic.id}>
                <Td>
                  <TribeLink to={`/tribe/${optimistic.id}`}>{optimistic.name}</TribeLink>
                  <Ticker>#{optimistic.inGameTribeId}</Ticker>
                </Td>
                <Td>
                  <StatusDot $active />
                  <StatusLabel $active>On-Chain</StatusLabel>
                </Td>
                <Td>—</Td>
                <Td>
                  {optimistic.leaderCharacterId ? <CopyableId id={optimistic.leaderCharacterId} asCode /> : "—"}
                </Td>
                <Td>
                  <CopyableId id={optimistic.id} asCode />
                </Td>
              </tr>
            )}
            {allTribes.map((t) => {
              const oc = t.onChainTribe;
              const name = oc?.name ?? t.worldInfo?.name ?? `Tribe #${t.inGameTribeId}`;
              const ticker = t.worldInfo?.nameShort ?? null;
              const Row = oc ? "tr" : MutedRow;
              const key = oc?.id ?? `game-${t.inGameTribeId}`;

              return (
                <Row key={key}>
                  <Td>
                    {oc ? (
                      <TribeLink to={`/tribe/${oc.id}`}>{name}</TribeLink>
                    ) : (
                      <span>{name}</span>
                    )}
                    {ticker && <Ticker>[{ticker}]</Ticker>}
                    {t.inGameTribeId > 0 && <Ticker>#{t.inGameTribeId}</Ticker>}
                  </Td>
                  <Td>
                    <StatusDot $active={oc !== null} />
                    <StatusLabel $active={oc !== null}>
                      {oc ? "On-Chain" : "Unclaimed"}
                    </StatusLabel>
                  </Td>
                  <Td>{t.characterCount > 0 ? t.characterCount : "—"}</Td>
                  <Td>
                    {oc?.leaderCharacterId ? (
                      <CopyableId id={oc.leaderCharacterId} asCode />
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    {oc ? (
                      <CopyableId id={oc.id} asCode />
                    ) : inGameTribeId === t.inGameTribeId ? (
                      <SmallButton
                        onClick={() => setShowCreate(true)}
                        disabled={hasTribeCap || optimistic !== null}
                        title={hasTribeCap || optimistic !== null ? "A character can only belong to 1 tribe" : undefined}
                      >
                        Initialize
                      </SmallButton>
                    ) : (
                      "—"
                    )}
                  </Td>
                </Row>
              );
            })}
          </tbody>
        </Table>
      )}

      {showCreate && (
        <CreateTribeModal
          onClose={() => setShowCreate(false)}
          onCreated={handleTribeCreated}
        />
      )}
    </Page>
  );
}
