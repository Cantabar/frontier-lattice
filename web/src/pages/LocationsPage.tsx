/**
 * Tribe Locations page — manages shadow location PODs.
 *
 * Shows TLK status, lists decrypted tribe PODs grouped by solar system,
 * and provides register / revoke actions.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import styled, { keyframes } from "styled-components";
import { useSearchParams } from "react-router-dom";
import { useCurrentAccount, useSignPersonalMessage } from "@mysten/dapp-kit";
import { useIdentity } from "../hooks/useIdentity";
import { useLocationPods, type DecryptedPod } from "../hooks/useLocationPods";
import { useTlkStatus } from "../hooks/useTlkStatus";
import { useTlkDistribution } from "../hooks/useTlkDistribution";
import { useMyStructures } from "../hooks/useStructures";
import { TlkStatusBanner } from "../components/locations/TlkStatusBanner";
import { RegisterNetworkNodeLocationModal } from "../components/locations/RegisterNetworkNodeLocationModal";
import { PodProofModal } from "../components/locations/PodProofModal";
import { MutualProximityProofModal } from "../components/locations/MutualProximityProofModal";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { EmptyState } from "../components/shared/EmptyState";
import { PrimaryButton, SecondaryButton, DangerButton } from "../components/shared/Button";
import { CopyableId } from "../components/shared/CopyableId";
import { solarSystemName } from "../lib/solarSystems";
import { truncateAddress, timeAgo } from "../lib/format";
import { ASSEMBLY_TYPES } from "../lib/types";
import { registerPublicKey, buildSoloTribeId } from "../lib/api";
import {
  bytesToBase64,
  getKeygenMessageBytes,
  deriveX25519Keypair,
  unwrapTlk,
} from "../lib/locationCrypto";

// ============================================================
// Styled primitives
// ============================================================

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

const ActionBar = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const ConnectPrompt = styled.div`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xxl};
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 16px;
`;

const SummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const SummaryCard = styled.div`
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

const GroupHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm} 0;
  margin-top: ${({ theme }) => theme.spacing.md};
`;

const GroupName = styled.span`
  font-size: 15px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const GroupId = styled.span`
  font-size: 12px;
  font-family: ${({ theme }) => theme.fonts.mono};
  color: ${({ theme }) => theme.colors.text.muted};
`;

const GroupCount = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-left: auto;
`;

const PodList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const highlightFade = keyframes`
  0% { background: ${"rgba(99, 179, 237, 0.25)"}; }
  100% { background: transparent; }
`;

const PodRow = styled.div<{ $highlight?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: 13px;
  ${({ $highlight }) => $highlight && `animation: ${highlightFade} 2s ease-out forwards;`}
`;

const PodInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const PodName = styled.div`
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PodMeta = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-top: 2px;
`;

const CoordBadge = styled.span`
  font-size: 11px;
  font-family: ${({ theme }) => theme.fonts.mono};
  color: ${({ theme }) => theme.colors.text.muted};
  white-space: nowrap;
`;

const OwnerBadge = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  white-space: nowrap;
`;

const ErrorText = styled.div`
  color: ${({ theme }) => theme.colors.danger};
  font-size: 12px;
  padding: ${({ theme }) => theme.spacing.sm} 0;
`;

const PendingSection = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const PendingSectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const PendingSectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const PendingRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: 13px;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const PendingAddress = styled.span`
  flex: 1;
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

// ============================================================
// Component
// ============================================================

export function LocationsPage() {
  const account = useCurrentAccount();
  const [searchParams] = useSearchParams();
  const highlightStructureId = searchParams.get("structure");
  const scrolledRef = useRef(false);
  const { tribeCaps, address } = useIdentity();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const rawTribeId = tribeCaps[0]?.tribeId ?? null;
  const isOfficer =
    tribeCaps[0]?.role === "Leader" || tribeCaps[0]?.role === "Officer";

  // Solo mode: player has no tribe — use a synthetic solo tribeId
  const isSoloMode = !rawTribeId && !!address;
  const tribeId = rawTribeId ?? (address ? buildSoloTribeId(address) : null);

  const { pods, isLoading: podsLoading, error: podsError, fetchPods, deletePod, refreshNetworkNodePod, initializeSoloPlk, getAuthHeader } =
    useLocationPods();
  const tlk = useTlkStatus();
  const distribution = useTlkDistribution(tribeId, tlk.tlkBytes);
  const { structures } = useMyStructures();

  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showProximityModal, setShowProximityModal] = useState(false);
  const [proofStructureId, setProofStructureId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshingNodeId, setRefreshingNodeId] = useState<string | null>(null);
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Fetch TLK status when tribe is known
  useEffect(() => {
    if (tribeId) {
      tlk.fetchStatus(tribeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tribeId]);

  // Fetch PODs when TLK is unlocked
  useEffect(() => {
    if (tribeId && tlk.tlkBytes) {
      fetchPods(tribeId, tlk.tlkBytes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tribeId, tlk.tlkBytes]);

  // Scroll to highlighted structure once pods are loaded
  useEffect(() => {
    if (!highlightStructureId || scrolledRef.current || pods.length === 0) return;
    const el = document.getElementById(`pod-${highlightStructureId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      scrolledRef.current = true;
    }
  }, [highlightStructureId, pods]);

  // Structure name lookup
  const structureMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of structures) {
      m.set(s.id, s.name || ASSEMBLY_TYPES[s.typeId]?.label || "Structure");
    }
    return m;
  }, [structures]);

  // Group pods by Network Node (primary grouping), with ungrouped pods in a separate bucket
  const grouped = useMemo(() => {
    const nodeMap = new Map<string, DecryptedPod[]>();
    const ungrouped: DecryptedPod[] = [];

    for (const pod of pods) {
      const nodeKey = pod.networkNodeId;
      if (nodeKey) {
        const arr = nodeMap.get(nodeKey);
        if (arr) arr.push(pod);
        else nodeMap.set(nodeKey, [pod]);
      } else {
        // Could be a primary Network Node POD or a legacy per-structure POD.
        // Check if this pod IS a Network Node (it has derived pods).
        const hasDerived = pods.some((p) => p.networkNodeId === pod.structureId);
        if (hasDerived) {
          // This is a Network Node primary POD — attach to its own group
          const existing = nodeMap.get(pod.structureId);
          if (existing) existing.unshift(pod);
          else nodeMap.set(pod.structureId, [pod]);
        } else {
          ungrouped.push(pod);
        }
      }
    }

    return { nodeGroups: Array.from(nodeMap.entries()), ungrouped };
  }, [pods]);

  // Unique solar systems count
  const systemCount = useMemo(() => {
    const systems = new Set<number>();
    for (const pod of pods) systems.add(pod.location.solarSystemId);
    return systems.size;
  }, [pods]);

  const handleRefresh = useCallback(() => {
    if (tribeId && tlk.tlkBytes) {
      fetchPods(tribeId, tlk.tlkBytes);
    }
  }, [tribeId, tlk.tlkBytes, fetchPods]);

  async function handleDelete(structureId: string) {
    setDeletingId(structureId);
    try {
      await deletePod(structureId);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRefreshNode(networkNodeId: string) {
    if (!tribeId) return;
    setRefreshingNodeId(networkNodeId);
    try {
      await refreshNetworkNodePod(networkNodeId, tribeId);
      handleRefresh();
    } finally {
      setRefreshingNodeId(null);
    }
  }

  /**
   * Sign the deterministic keygen message and derive an X25519 keypair.
   * Shared by both init and unlock flows.
   */
  async function deriveX25519() {
    const { signature } = await signPersonalMessage({
      message: getKeygenMessageBytes(),
    });
    return deriveX25519Keypair(signature);
  }

  async function handleInitializeTlk() {
    if (!tribeId) return;
    setUnlockLoading(true);
    setUnlockError(null);
    try {
      // 1. Derive X25519 keypair from wallet signature
      const { x25519Pub, x25519Priv } = await deriveX25519();

      if (isSoloMode) {
        // Solo flow: initialize PLK via dedicated endpoint
        await initializeSoloPlk(bytesToBase64(x25519Pub));
      } else {
        // Tribe flow: initialize TLK and wrap to our X25519 pub
        await tlk.initialize({
          tribeId,
          memberPublicKeys: [{ address, x25519Pub: bytesToBase64(x25519Pub) }],
        });
      }

      // 3. Fetch the wrapped TLK/PLK and auto-unlock
      await tlk.fetchStatus(tribeId);
      const authHeader = await getAuthHeader();
      const { getTlk: getTlkApi } = await import("../lib/indexer");
      const result = await getTlkApi(tribeId, authHeader);
      const tlkBytes = await unwrapTlk(result.wrapped_key, x25519Priv);
      tlk.setUnwrappedTlk(tlkBytes, result.tlk_version);
    } catch (err) {
      const msg = err instanceof Error ? err.message : isSoloMode ? "Failed to initialize PLK" : "Failed to initialize TLK";
      setUnlockError(msg);
    } finally {
      setUnlockLoading(false);
    }
  }

  async function handleUnlockTlk() {
    if (!tribeId) return;
    setUnlockLoading(true);
    setUnlockError(null);
    try {
      // 1. Derive X25519 keypair from wallet signature
      const { x25519Pub, x25519Priv } = await deriveX25519();

      // 2. Register derived public key (idempotent upsert)
      const authHeader = await getAuthHeader();
      await registerPublicKey(authHeader, {
        tribeId,
        x25519Pub: bytesToBase64(x25519Pub),
      });

      // 3. Attempt to unwrap if we have a wrapped key
      if (tlk.wrappedKey && tlk.tlkVersion != null) {
        const tlkBytes = await unwrapTlk(tlk.wrappedKey, x25519Priv);
        tlk.setUnwrappedTlk(tlkBytes, tlk.tlkVersion);
      } else {
        // No wrapped key yet — re-fetch in case it was just granted
        await tlk.fetchStatus(tribeId);
        // If still no key, the user needs to wait for an existing member to grant access
        if (!tlk.wrappedKey) {
          setUnlockError(
            "Your public key has been registered. An existing member with the TLK must grant you access.",
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to unlock TLK";
      setUnlockError(msg);
    } finally {
      setUnlockLoading(false);
    }
  }

  if (!account) {
    return (
      <Page>
        <Title>Locations</Title>
        <ConnectPrompt>Connect your wallet to manage locations.</ConnectPrompt>
      </Page>
    );
  }

  if (!tribeId) {
    return (
      <Page>
        <Title>Locations</Title>
        <ConnectPrompt>Connect your wallet to manage locations.</ConnectPrompt>
      </Page>
    );
  }

  return (
    <Page>
      <Header>
        <Title>{isSoloMode ? "Solo Locations" : "Tribe Locations"}</Title>
        <ActionBar>
          <SecondaryButton onClick={handleRefresh} disabled={podsLoading || !tlk.tlkBytes}>
            {podsLoading ? "Loading…" : "Refresh"}
          </SecondaryButton>
          <SecondaryButton
            onClick={() => setShowProximityModal(true)}
            disabled={!tlk.tlkBytes || pods.length < 2}
          >
            Prove Proximity
          </SecondaryButton>
          <PrimaryButton
            onClick={() => setShowRegisterModal(true)}
            disabled={!tlk.tlkBytes}
          >
            Register Network Node
          </PrimaryButton>
        </ActionBar>
      </Header>

      {/* TLK / PLK banner */}
      <TlkStatusBanner
        isInitialized={tlk.isInitialized}
        hasWrappedKey={tlk.hasWrappedKey}
        tlkVersion={tlk.tlkVersion}
        isUnlocked={!!tlk.tlkBytes}
        isOfficer={isOfficer}
        isLoading={tlk.isLoading}
        isSoloMode={isSoloMode}
        onInitialize={handleInitializeTlk}
        onUnlock={handleUnlockTlk}
        unlockLoading={unlockLoading}
      />
      {unlockError && <ErrorText>{unlockError}</ErrorText>}

      {/* Summary cards */}
      {tlk.tlkBytes && (
        <SummaryGrid>
          <SummaryCard>
            <CardLabel>Total PODs</CardLabel>
            <CardValue>{pods.length}</CardValue>
          </SummaryCard>
          <SummaryCard>
            <CardLabel>Systems</CardLabel>
            <CardValue>{systemCount}</CardValue>
          </SummaryCard>
          <SummaryCard>
            <CardLabel>{isSoloMode ? "PLK Version" : "TLK Version"}</CardLabel>
            <CardValue>v{tlk.tlkVersion ?? "—"}</CardValue>
          </SummaryCard>
        </SummaryGrid>
      )}

      {/* Pending members — key distribution (tribe mode only) */}
      {!isSoloMode && tlk.tlkBytes && distribution.pendingMembers.length > 0 && (
        <PendingSection>
          <PendingSectionHeader>
            <PendingSectionTitle>
              {distribution.pendingMembers.length} member{distribution.pendingMembers.length !== 1 ? "s" : ""} awaiting TLK access
            </PendingSectionTitle>
            <SecondaryButton
              onClick={() => tribeId && tlk.tlkBytes && distribution.grantAll(tribeId, tlk.tlkBytes)}
              disabled={distribution.isLoading}
            >
              {distribution.isLoading ? "Granting…" : "Grant All"}
            </SecondaryButton>
          </PendingSectionHeader>
          {distribution.pendingMembers.map((m) => (
            <PendingRow key={m.address}>
              <PendingAddress>{truncateAddress(m.address, 10, 6)}</PendingAddress>
              <PrimaryButton
                onClick={() => tribeId && tlk.tlkBytes && distribution.grantAccess(tribeId, m, tlk.tlkBytes)}
                disabled={distribution.isLoading}
              >
                Grant
              </PrimaryButton>
            </PendingRow>
          ))}
          {distribution.error && <ErrorText>{distribution.error}</ErrorText>}
        </PendingSection>
      )}

      {/* Error */}
      {podsError && <ErrorText>{podsError}</ErrorText>}

      {/* POD list */}
      {podsLoading ? (
        <LoadingSpinner />
      ) : !tlk.tlkBytes ? (
        <EmptyState
          title="Encryption key not unlocked"
          description="Unlock your Tribe Location Key to view and manage encrypted locations."
        />
      ) : pods.length === 0 ? (
        <EmptyState
          title="No locations registered"
          description={isSoloMode
            ? "Register your first Network Node location to track it privately."
            : "Register your first Network Node location to share it securely with your Tribe."
          }
        />
      ) : (
        <>
          {/* Network Node groups */}
          {grouped.nodeGroups.map(([nodeId, groupPods]) => {
            const nodePod = groupPods.find((p) => p.structureId === nodeId);
            const derivedPods = groupPods.filter((p) => p.structureId !== nodeId);
            const nodeName = structureMap.get(nodeId) ?? truncateAddress(nodeId, 10, 6);
            const sysName = nodePod ? solarSystemName(nodePod.location.solarSystemId) : "";

            return (
              <div key={nodeId}>
                <GroupHeader>
                  <GroupName>{nodeName}</GroupName>
                  {sysName && <GroupId>{sysName}</GroupId>}
                  <GroupCount>
                    {derivedPods.length} derived structure{derivedPods.length !== 1 ? "s" : ""}
                  </GroupCount>
                  <SecondaryButton
                    onClick={() => handleRefreshNode(nodeId)}
                    disabled={refreshingNodeId === nodeId}
                    style={{ marginLeft: "auto", padding: "2px 8px", fontSize: "11px" }}
                  >
                    {refreshingNodeId === nodeId ? "…" : "Refresh"}
                  </SecondaryButton>
                </GroupHeader>
                <PodList>
                  {groupPods.map((pod) => (
                    <PodRow
                      key={pod.structureId}
                      id={`pod-${pod.structureId}`}
                      $highlight={pod.structureId === highlightStructureId}
                    >
                      <PodInfo>
                        <PodName>
                          {pod.structureId === nodeId
                            ? `⚡ ${structureMap.get(pod.structureId) ?? truncateAddress(pod.structureId, 10, 6)}`
                            : structureMap.get(pod.structureId) ?? truncateAddress(pod.structureId, 10, 6)}
                        </PodName>
                        <PodMeta>
                          <CopyableId id={pod.structureId} asCode /> ·{" "}
                          {timeAgo(pod.updatedAt)}
                          {pod.networkNodeId && " · derived"}
                        </PodMeta>
                      </PodInfo>

                      <CoordBadge>
                        ({pod.location.x}, {pod.location.y}, {pod.location.z})
                      </CoordBadge>

                      <OwnerBadge>{truncateAddress(pod.ownerAddress, 6, 4)}</OwnerBadge>

                      {/* Proof + Revoke — only the primary Network Node POD owner, and only for non-derived */}
                      {!pod.networkNodeId &&
                        pod.ownerAddress.toLowerCase() === address.toLowerCase() && (
                          <>
                            <SecondaryButton
                              onClick={() => setProofStructureId(pod.structureId)}
                              style={{ padding: "2px 8px", fontSize: "11px" }}
                            >
                              Proof
                            </SecondaryButton>
                            <DangerButton
                              onClick={() => handleDelete(pod.structureId)}
                              disabled={deletingId === pod.structureId}
                            >
                              {deletingId === pod.structureId ? "…" : "Revoke"}
                            </DangerButton>
                          </>
                        )}
                    </PodRow>
                  ))}
                </PodList>
              </div>
            );
          })}

          {/* Ungrouped (legacy per-structure) PODs */}
          {grouped.ungrouped.length > 0 && (
            <div>
              <GroupHeader>
                <GroupName>Standalone</GroupName>
                <GroupCount>
                  {grouped.ungrouped.length} structure{grouped.ungrouped.length !== 1 ? "s" : ""}
                </GroupCount>
              </GroupHeader>
              <PodList>
                {grouped.ungrouped.map((pod) => (
                  <PodRow
                    key={pod.structureId}
                    id={`pod-${pod.structureId}`}
                    $highlight={pod.structureId === highlightStructureId}
                  >
                    <PodInfo>
                      <PodName>
                        {structureMap.get(pod.structureId) ??
                          truncateAddress(pod.structureId, 10, 6)}
                      </PodName>
                      <PodMeta>
                        <CopyableId id={pod.structureId} asCode /> ·{" "}
                        {timeAgo(pod.updatedAt)}
                      </PodMeta>
                    </PodInfo>

                    <CoordBadge>
                      ({pod.location.x}, {pod.location.y}, {pod.location.z})
                    </CoordBadge>

                    <OwnerBadge>{truncateAddress(pod.ownerAddress, 6, 4)}</OwnerBadge>

                    {pod.ownerAddress.toLowerCase() === address.toLowerCase() && (
                      <>
                        <SecondaryButton
                          onClick={() => setProofStructureId(pod.structureId)}
                          style={{ padding: "2px 8px", fontSize: "11px" }}
                        >
                          Proof
                        </SecondaryButton>
                        <DangerButton
                          onClick={() => handleDelete(pod.structureId)}
                          disabled={deletingId === pod.structureId}
                        >
                          {deletingId === pod.structureId ? "…" : "Revoke"}
                        </DangerButton>
                      </>
                    )}
                  </PodRow>
                ))}
              </PodList>
            </div>
          )}
        </>
      )}

      {/* Register modal */}
      {showRegisterModal && tlk.tlkBytes && tlk.tlkVersion != null && (
        <RegisterNetworkNodeLocationModal
          tribeId={tribeId}
          tlkBytes={tlk.tlkBytes}
          tlkVersion={tlk.tlkVersion}
          onClose={() => setShowRegisterModal(false)}
          onSuccess={handleRefresh}
        />
      )}

      {/* Mutual proximity proof modal */}
      {showProximityModal && tribeId && (
        <MutualProximityProofModal
          tribeId={tribeId}
          pods={pods}
          onClose={() => setShowProximityModal(false)}
          onSuccess={handleRefresh}
        />
      )}

      {/* Proof modal */}
      {proofStructureId && (
        <PodProofModal
          structureId={proofStructureId}
          tribeId={tribeId}
          getAuthHeader={getAuthHeader}
          onClose={() => setProofStructureId(null)}
        />
      )}
    </Page>
  );
}
