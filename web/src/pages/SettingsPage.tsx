/**
 * Settings & Diagnostics page.
 *
 * Groups troubleshooting tools and environment info that don't need to be
 * visible day-to-day. New sections can be appended as the UI grows.
 */

import { useState } from "react";
import styled from "styled-components";
import { useQueryClient } from "@tanstack/react-query";
import { config } from "../config";
import { clearWorldTribeInfoCache } from "../hooks/useWorldTribeInfo";
import { useNotifications } from "../hooks/useNotifications";

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
  const { push } = useNotifications();
  const [stats, setStats] = useState(tribeCacheStats);
  const [reloading, setReloading] = useState(false);

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

      {/* ---- Config Overview ---- */}
      <SectionHeading>Environment</SectionHeading>

      <Card>
        <CardTitle>Config Overview</CardTitle>
        <CardDescription>
          Current runtime configuration values. These are set via environment
          variables at build time.
        </CardDescription>
        <ConfigGrid>
          <ConfigLabel>Network</ConfigLabel>
          <ConfigValue>{config.network}</ConfigValue>

          <ConfigLabel>Tribe Package</ConfigLabel>
          <ConfigValue>{config.packages.tribe}</ConfigValue>

          <ConfigLabel>Contract Board Package</ConfigLabel>
          <ConfigValue>{config.packages.contractBoard}</ConfigValue>

          <ConfigLabel>Forge Planner Package</ConfigLabel>
          <ConfigValue>{config.packages.forgePlanner}</ConfigValue>

          <ConfigLabel>Trustless Contracts Package</ConfigLabel>
          <ConfigValue>{config.packages.trustlessContracts}</ConfigValue>

          <ConfigLabel>World Package</ConfigLabel>
          <ConfigValue>{config.packages.world}</ConfigValue>

          <ConfigLabel>Tribe Registry ID</ConfigLabel>
          <ConfigValue>{config.tribeRegistryId}</ConfigValue>

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
