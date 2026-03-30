import { useState, useRef } from "react";
import styled from "styled-components";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useIdentity } from "../hooks/useIdentity";
import { useTribe } from "../hooks/useTribe";
import { getStats } from "../lib/api";
import { PortalTooltip } from "../components/shared/PortalTooltip";
import { useNotifications } from "../hooks/useNotifications";
import { useQuickActions } from "../hooks/useQuickActions";
import { useInitializeTribe } from "../hooks/useInitializeTribe";
import { useInstallCorm } from "../hooks/useInstallCorm";
import { truncateAddress } from "../lib/format";

const Page = styled.div``;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  font-family: ${({ theme }) => theme.fonts.heading};
  letter-spacing: 0.04em;
  text-transform: uppercase;
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
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  padding: ${({ theme }) => theme.spacing.md};
  box-shadow: inset 0 1px 0 ${({ theme }) => theme.colors.rust.muted}26;
`;

const CardLabel = styled.div`
  font-size: 12px;
  font-family: ${({ theme }) => theme.fonts.heading};
  color: ${({ theme }) => theme.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.08em;
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
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.xl};
`;

const ActionLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
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

const ClickableCard = styled(Link)`
  background: ${({ theme }) => theme.colors.surface.raised};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  padding: ${({ theme }) => theme.spacing.md};
  text-decoration: none;
  transition: border-color 0.15s;
  box-shadow: inset 0 1px 0 ${({ theme }) => theme.colors.rust.muted}26;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const CustomizeToggle = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.text.muted};
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  margin-left: ${({ theme }) => theme.spacing.sm};

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const CustomizePanel = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const CustomizeCheckbox = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
  cursor: pointer;
`;

const ActionDescription = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.muted};
  font-weight: 400;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: baseline;
  margin-bottom: ${({ theme }) => theme.spacing.md};
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

const InitInput = styled.input`
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 13px;
  width: 100%;
  margin-top: ${({ theme }) => theme.spacing.sm};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

const InitButton = styled.button`
  background: ${({ theme }) => theme.colors.primary.main};
  color: ${({ theme }) => theme.colors.surface.bg};
  border: none;
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
  margin-top: ${({ theme }) => theme.spacing.sm};
  width: 100%;

  &:hover {
    background: ${({ theme }) => theme.colors.primary.hover};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const NodeSelect = styled.select`
  background: ${({ theme }) => theme.colors.surface.bg};
  border: 1px solid ${({ theme }) => theme.colors.surface.border};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 13px;
  width: 100%;
  margin-top: ${({ theme }) => theme.spacing.sm};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.main};
  }
`;

export function Dashboard() {
  const account = useCurrentAccount();
  const { tribeCaps, characterId, isLoading: identityLoading } = useIdentity();
  const { unreadCount } = useNotifications();
  const tribeId = tribeCaps[0]?.tribeId;
  const { tribe } = useTribe(tribeId);
  const { enabled: quickActions, toggle: toggleAction, reset: resetActions, allVariants, variantLabels, variantDescriptions } = useQuickActions();
  const { needsInit, inGameTribeId, suggestedName, isInitializing, initialize } = useInitializeTribe();
  const { networkNodes, canInstall, isConfigured, isInstalling, installCorm } = useInstallCorm();
  const [customizing, setCustomizing] = useState(false);
  const [initName, setInitName] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const installBtnRef = useRef<HTMLButtonElement>(null);
  const [installBtnHovered, setInstallBtnHovered] = useState(false);

  const installDisabled = isInstalling || !selectedNodeId || !canInstall || !isConfigured;
  const installDisabledReason = !canInstall
    ? "You need a Network Node to install a corm."
    : !isConfigured
      ? "Corm contracts are not yet deployed."
      : !selectedNodeId
        ? "Select a Network Node first."
        : null;

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
  });


  if (!account) {
    return (
      <Page>
        <Title>Dashboard</Title>
        <ConnectPrompt>Connect your wallet to get started.</ConnectPrompt>
      </Page>
    );
  }

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
        {tribeId ? (
          <ClickableCard to={`/tribe/${tribeId}`}>
            <CardLabel>Tribe</CardLabel>
            <CardValue style={{ fontSize: 14 }}>
              {tribe ? `${tribe.name} (#${tribe.inGameTribeId})` : "—"}
            </CardValue>
          </ClickableCard>
        ) : needsInit ? (
          <OverviewCard>
            <CardLabel>Tribe #{inGameTribeId}</CardLabel>
            <CardValue style={{ fontSize: 13 }}>Not initialized</CardValue>
            <InitInput
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
            <InitButton
              onClick={() => {
                const val = initName || suggestedName || "";
                if (val.trim()) initialize(val);
              }}
              disabled={isInitializing || !(initName || suggestedName || "").trim()}
            >
              {isInitializing ? "Initializing…" : "Initialize Tribe"}
            </InitButton>
          </OverviewCard>
        ) : (
          <OverviewCard>
            <CardLabel>Tribe</CardLabel>
            <CardValue style={{ fontSize: 14 }}>—</CardValue>
          </OverviewCard>
        )}
        <ClickableCard to="/events">
          <CardLabel>Total Events</CardLabel>
          <CardValue>{stats?.total_events?.toLocaleString() ?? "—"}</CardValue>
        </ClickableCard>
        <OverviewCard>
          <CardLabel>Install Corm</CardLabel>
          <NodeSelect
            value={selectedNodeId}
            onChange={(e) => setSelectedNodeId(e.target.value)}
            disabled={isInstalling || networkNodes.length === 0}
          >
            {networkNodes.length === 0 ? (
              <option value="">No Network Nodes found</option>
            ) : (
              <>
                <option value="">Select a Network Node…</option>
                {networkNodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name || "Unnamed Node"} ({truncateAddress(node.id)})
                  </option>
                ))}
              </>
            )}
          </NodeSelect>
          <span
            ref={installBtnRef}
            style={{ display: "inline-block", width: "100%" }}
            onMouseEnter={() => setInstallBtnHovered(true)}
            onMouseLeave={() => setInstallBtnHovered(false)}
          >
            <InitButton
              onClick={() => {
                if (selectedNodeId) installCorm(selectedNodeId);
              }}
              disabled={installDisabled}
            >
              {isInstalling ? "Installing…" : "Install Corm"}
            </InitButton>
          </span>
          <PortalTooltip
            targetRef={installBtnRef}
            visible={installBtnHovered && !!installDisabledReason}
          >
            <Meta>{installDisabledReason}</Meta>
          </PortalTooltip>
        </OverviewCard>
      </OverviewGrid>

      <SectionHeader>
        <SectionLabel style={{ marginBottom: 0 }}>Quick Contract</SectionLabel>
        <CustomizeToggle onClick={() => setCustomizing((p) => !p)}>
          {customizing ? "done" : "customize"}
        </CustomizeToggle>
      </SectionHeader>
      {customizing && (
        <CustomizePanel>
          {allVariants.map((v) => (
            <CustomizeCheckbox key={v}>
              <input
                type="checkbox"
                checked={quickActions.includes(v)}
                onChange={() => toggleAction(v)}
              />
              {variantLabels[v]}
            </CustomizeCheckbox>
          ))}
          <CustomizeToggle onClick={resetActions}>reset</CustomizeToggle>
        </CustomizePanel>
      )}
      <QuickActions>
        {allVariants
          .filter((v) => quickActions.includes(v))
          .map((v) => (
            <ActionLink key={v} to={`/contracts/create?type=${v}`}>
              + {variantLabels[v]}
              <ActionDescription>{variantDescriptions[v]}</ActionDescription>
            </ActionLink>
          ))}
      </QuickActions>

    </Page>
  );
}
