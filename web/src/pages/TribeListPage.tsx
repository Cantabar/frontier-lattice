import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useSuiClient } from "@mysten/dapp-kit";
import { useIdentity } from "../hooks/useIdentity";
import { useAllTribes } from "../hooks/useAllTribes";
import { useTribe } from "../hooks/useTribe";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import { buildLookupTribeByGameId } from "../lib/sui";
import { CopyableId } from "../components/shared/CopyableId";
import { config } from "../config";
import { PrimaryButton } from "../components/shared/Button";
import { useInitializeTribe } from "../hooks/useInitializeTribe";

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

const InitRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: center;
  margin-top: ${({ theme }) => theme.spacing.md};
`;

export function TribeListPage() {
  const navigate = useNavigate();
  const client = useSuiClient();
  const { tribeCaps, inGameTribeId } = useIdentity();
  const { needsInit, suggestedName, isInitializing, initialize } = useInitializeTribe();

  const { allTribes, isLoading } = useAllTribes();

  // Lookup state
  const [lookupId, setLookupId] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [lookupPending, setLookupPending] = useState(false);
  const [initName, setInitName] = useState("");

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
          {needsInit && (
            <InitRow>
              <Input
                type="text"
                placeholder="Tribe name"
                value={initName || suggestedName || ""}
                onChange={(e) => setInitName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = initName || suggestedName || "";
                    if (val.trim()) initialize(val);
                  }
                }}
                disabled={isInitializing}
              />
              <PrimaryButton
                onClick={() => {
                  const val = initName || suggestedName || "";
                  if (val.trim()) initialize(val);
                }}
                disabled={isInitializing || !(initName || suggestedName || "").trim()}
              >
                {isInitializing ? "Initializing…" : "Initialize Tribe"}
              </PrimaryButton>
            </InitRow>
          )}
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
      ) : allTribes.length === 0 ? (
        <EmptyState title="No tribes found" description="No tribes have been initialized yet." />
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

    </Page>
  );
}
