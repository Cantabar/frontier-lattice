/**
 * Settings & Diagnostics page.
 *
 * Groups troubleshooting tools and environment info that don't need to be
 * visible day-to-day. New sections can be appended as the UI grows.
 */

import { useState } from "react";
import styled from "styled-components";
import { useQueryClient } from "@tanstack/react-query";
import { useDisconnectWallet } from "@mysten/dapp-kit";
import { config } from "../config";
import { clearWorldTribeInfoCache } from "../hooks/useWorldTribeInfo";
import { clearLocationSession } from "../hooks/useLocationPods";
import { useNotifications } from "../hooks/useNotifications";
import { useInstalledCorms, type InstalledCorm } from "../hooks/useInstalledCorms";
import { resetCormPhase } from "../continuity-engine/resetCormPhase";

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Page = styled.div`
  max-width: 720px;
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const SectionHeading = styled.h2`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${({ theme }) => theme.colors.text.muted};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const CardTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const CardDescription = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  line-height: 1.5;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const StatRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.lg};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Stat = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.muted};

  & > strong {
    color: ${({ theme }) => theme.colors.text.primary};
    font-weight: 600;
    margin-right: 4px;
  }
`;

const ActionButton = styled.button<{ $busy?: boolean }>`
  background: ${({ theme }) => theme.colors.primary.subtle};
  border: 1px solid ${({ theme }) => theme.colors.primary.main};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.colors.primary.main};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  opacity: ${({ $busy }) => ($busy ? 0.6 : 1)};
  pointer-events: ${({ $busy }) => ($busy ? "none" : "auto")};
  transition: background 0.15s, border-color 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.primary.main};
    color: ${({ theme }) => theme.colors.surface.bg};
  }
`;

const ConfigGrid = styled.div`
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-size: 12px;
`;

const ConfigLabel = styled.span`
  color: ${({ theme }) => theme.colors.text.muted};
  font-weight: 500;
`;

const ConfigValue = styled.span`
  color: ${({ theme }) => theme.colors.text.secondary};
  font-family: ${({ theme }) => theme.fonts.mono};
  word-break: break-all;
`;

const DangerButton = styled(ActionButton)`
  background: ${({ theme }) => theme.colors.surface.raised};
  border-color: ${({ theme }) => theme.colors.text.muted};
  color: ${({ theme }) => theme.colors.text.secondary};

  &:hover {
    background: #d32f2f;
    border-color: #d32f2f;
    color: #fff;
  }
`;

const MutedText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.muted};
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tribeCacheStats(): { entries: number; bytes: number } {
  try {
    const raw = localStorage.getItem("frontier-corm:worldTribeInfo");
    if (!raw) return { entries: 0, bytes: 0 };
    const parsed = JSON.parse(raw) as unknown[];
    return { entries: parsed.length, bytes: new Blob([raw]).size };
  } catch {
    return { entries: 0, bytes: 0 };
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const { push } = useNotifications();
  const [stats, setStats] = useState(tribeCacheStats);
  const [reloading, setReloading] = useState(false);
  const { installedCorms, isLoading: cormsLoading } = useInstalledCorms();
  const [resettingCorm, setResettingCorm] = useState<string | null>(null);

  async function handleReloadTribes() {
    setReloading(true);
    const key = clearWorldTribeInfoCache();
    await queryClient.invalidateQueries({ queryKey: ["worldTribeInfo"] });
    setStats(tribeCacheStats());
    push({
      level: "info",
      title: "Tribe Cache Cleared",
      message: `Removed localStorage key "${key}" and triggered a fresh fetch.`,
      source: "Settings",
    });
    setReloading(false);
  }

  return (
    <Page>
      <Title>Settings</Title>

      {/* ---- Diagnostics ---- */}
      <SectionHeading>Diagnostics</SectionHeading>

      <Card>
        <CardTitle>Tribe Name Cache</CardTitle>
        <CardDescription>
          Tribe names fetched from the World API are cached in localStorage so
          they load instantly on repeat visits. Use the button below to clear the
          cache and re-fetch all tribe data from the network.
        </CardDescription>
        <StatRow>
          <Stat>
            <strong>{stats.entries}</strong>cached entries
          </Stat>
          <Stat>
            <strong>{formatBytes(stats.bytes)}</strong>storage used
          </Stat>
        </StatRow>
        <ActionButton $busy={reloading} onClick={handleReloadTribes}>
          {reloading ? "Reloading…" : "Reload Tribe Data"}
        </ActionButton>
      </Card>

      <Card>
        <CardTitle>Location Session</CardTitle>
        <CardDescription>
          The Location Network caches a session token after your first wallet
          signature. If you're seeing authentication errors (e.g. "Invalid
          signature"), clear the session and reconnect your wallet to force a
          fresh zkLogin proof.
        </CardDescription>
        <div style={{ display: "flex", gap: "8px" }}>
          <ActionButton
            onClick={() => {
              clearLocationSession();
              push({
                level: "info",
                title: "Session Cleared",
                message: "Location session token removed. Next API call will sign a fresh challenge.",
                source: "Settings",
              });
            }}
          >
            Clear Session
          </ActionButton>
          <ActionButton
            onClick={() => {
              clearLocationSession();
              disconnectWallet();
              push({
                level: "info",
                title: "Wallet Disconnected",
                message: "Session cleared and wallet disconnected. Reconnect to re-authenticate with a fresh zkLogin proof.",
                source: "Settings",
              });
            }}
          >
            Disconnect Wallet
          </ActionButton>
        </div>
      </Card>

      {/* ---- Corm Management ---- */}
      <SectionHeading>Corm Management</SectionHeading>

      {cormsLoading ? (
        <Card>
          <MutedText>Loading installed corms…</MutedText>
        </Card>
      ) : installedCorms.length === 0 ? (
        <Card>
          <MutedText>No corms installed.</MutedText>
        </Card>
      ) : (
        installedCorms.map((corm: InstalledCorm) => (
          <Card key={corm.cormStateId}>
            <CardTitle>{corm.nodeName}</CardTitle>
            <StatRow>
              <Stat>
                <strong>Phase {corm.phase}</strong>
              </Stat>
              <Stat>
                <strong>{corm.stability}</strong>stability
              </Stat>
              <Stat>
                <strong>{corm.corruption}</strong>corruption
              </Stat>
            </StatRow>
            <ConfigGrid>
              <ConfigLabel>State ID</ConfigLabel>
              <ConfigValue>{corm.cormStateId.slice(0, 18)}…</ConfigValue>
              <ConfigLabel>Node ID</ConfigLabel>
              <ConfigValue>{corm.networkNodeId.slice(0, 18)}…</ConfigValue>
            </ConfigGrid>
            <div style={{ marginTop: "12px" }}>
              <DangerButton
                $busy={resettingCorm === corm.networkNodeId}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Reset corm on "${corm.nodeName}" to Phase 0? This will clear stability and corruption.`,
                    )
                  )
                    return;
                  setResettingCorm(corm.networkNodeId);
                  try {
                    const result = await resetCormPhase(corm.networkNodeId, 0);
                    push({
                      level: "success",
                      title: "Corm Reset",
                      message: `Phase reset to ${result.phase}. Chain: ${result.chain}.`,
                      source: "Settings",
                    });
                    queryClient.invalidateQueries({ queryKey: ["queryEvents"] });
                    queryClient.invalidateQueries({ queryKey: ["getObject"] });
                  } catch (err) {
                    push({
                      level: "error",
                      title: "Reset Failed",
                      message: err instanceof Error ? err.message : "Unknown error",
                      source: "Settings",
                    });
                  } finally {
                    setResettingCorm(null);
                  }
                }}
              >
                {resettingCorm === corm.networkNodeId
                  ? "Resetting…"
                  : "Reset to Phase 0"}
              </DangerButton>
            </div>
          </Card>
        ))
      )}

      {/* ---- Config Overview ---- */}
      <SectionHeading>Environment</SectionHeading>

      <Card>
        <CardTitle>Config Overview</CardTitle>
        <CardDescription>
          Current runtime configuration values. These are set via environment
          variables at build time.
        </CardDescription>
        <ConfigGrid>
          <ConfigLabel>Environment</ConfigLabel>
          <ConfigValue>{config.appEnv}</ConfigValue>

          <ConfigLabel>Network</ConfigLabel>
          <ConfigValue>{config.network}</ConfigValue>

          <ConfigLabel>Tribe Package</ConfigLabel>
          <ConfigValue>{config.packages.tribe}</ConfigValue>

          <ConfigLabel>Trustless Contracts Package</ConfigLabel>
          <ConfigValue>{config.packages.trustlessContracts}</ConfigValue>

          <ConfigLabel>World Package</ConfigLabel>
          <ConfigValue>{config.packages.world}</ConfigValue>

          <ConfigLabel>Tribe Registry ID</ConfigLabel>
          <ConfigValue>{config.tribeRegistryId}</ConfigValue>

          <ConfigLabel>CORM Coin Type</ConfigLabel>
          <ConfigValue>{config.cormCoinType || "(not configured)"}</ConfigValue>

          <ConfigLabel>Coin Type</ConfigLabel>
          <ConfigValue>{config.coinType}</ConfigValue>

          <ConfigLabel>Fill Coin Type</ConfigLabel>
          <ConfigValue>{config.fillCoinType}</ConfigValue>

          <ConfigLabel>Indexer URL</ConfigLabel>
          <ConfigValue>{config.indexerUrl}</ConfigValue>

          <ConfigLabel>World API URL</ConfigLabel>
          <ConfigValue>{config.worldApiUrl}</ConfigValue>
        </ConfigGrid>
      </Card>
    </Page>
  );
}
