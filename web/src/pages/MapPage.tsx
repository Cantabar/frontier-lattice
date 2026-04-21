import { useState, useMemo } from "react";
import styled from "styled-components";
import { GalaxyMap } from "../components/map/GalaxyMap";
import { SystemInfoPanel } from "../components/map/SystemInfoPanel";
import { OverlayPanel } from "../components/map/OverlayPanel";
import { GlowLayer } from "../components/map/GlowLayer";
import { DensityGradientLayer } from "../components/map/DensityGradientLayer";
import { buildGalaxyBuffer } from "../lib/galaxyMap";
import { SOLAR_SYSTEMS } from "../lib/solarSystems";
import { ACCENT_COLOR } from "../lib/overlayPalette";
import { useOverlayColors } from "../hooks/useOverlayColors";
import { useLocationPods } from "../hooks/useLocationPods";
import type { OverlayConfig } from "../lib/overlayTypes";

type SidebarTab = "system" | "overlays";

const PageContainer = styled.div`
  display: flex;
  height: 100%;
  background: #000;
`;

const CanvasArea = styled.div`
  flex: 1;
  min-height: 0;
  position: relative;
`;

const InfoSidebar = styled.div`
  width: 280px;
  overflow-y: auto;
  background: rgba(8, 12, 20, 0.95);
  border-left: 1px solid rgba(100, 160, 220, 0.2);
  display: flex;
  flex-direction: column;
`;

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid rgba(100, 160, 220, 0.2);
  flex-shrink: 0;
`;

const Tab = styled.button<{ $active: boolean }>`
  flex: 1;
  background: ${(p) => (p.$active ? "rgba(100, 160, 220, 0.1)" : "transparent")};
  border: none;
  border-bottom: 2px solid ${(p) => (p.$active ? "rgba(100, 160, 220, 0.7)" : "transparent")};
  color: ${(p) => (p.$active ? "#e8f2ff" : "#6080a0")};
  cursor: pointer;
  font-size: 12px;
  font-weight: ${(p) => (p.$active ? "600" : "400")};
  letter-spacing: 0.04em;
  padding: 10px 0;
  text-transform: uppercase;
  transition: color 0.15s;

  &:hover {
    color: #c8d8e8;
  }
`;

const TabContent = styled.div`
  padding: 16px;
  overflow-y: auto;
  flex: 1;
`;

export function MapPage() {
  const [selectedSystemId, setSelectedSystemId] = useState<number | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("system");
  const [overlayConfig, setOverlayConfig] = useState<OverlayConfig | null>(null);

  const { positions, ids, idToIndex } = useMemo(
    () => buildGalaxyBuffer(Array.from(SOLAR_SYSTEMS.values())),
    [],
  );

  const { pods } = useLocationPods();

  const { colors, glowMask, densityMask } = useOverlayColors({
    overlayConfig,
    ids,
    pods,
  });

  const sceneOverlays = (() => {
    if (!overlayConfig) return undefined;
    if (overlayConfig.mode === "glow" && glowMask) {
      return (
        <GlowLayer positions={positions} glowMask={glowMask} glowColor={ACCENT_COLOR} />
      );
    }
    if (overlayConfig.mode === "densityGradient" && densityMask) {
      return (
        <DensityGradientLayer positions={positions} densityMask={densityMask} color={ACCENT_COLOR} />
      );
    }
    return undefined;
  })();

  return (
    <PageContainer>
      <CanvasArea>
        <GalaxyMap
          positions={positions}
          ids={ids}
          idToIndex={idToIndex}
          selectedId={selectedSystemId}
          onSelect={setSelectedSystemId}
          overlayColors={colors}
          sceneOverlays={sceneOverlays}
        />
      </CanvasArea>
      <InfoSidebar>
        <TabBar>
          <Tab $active={sidebarTab === "system"} onClick={() => setSidebarTab("system")}>
            System
          </Tab>
          <Tab $active={sidebarTab === "overlays"} onClick={() => setSidebarTab("overlays")}>
            Overlays
          </Tab>
        </TabBar>
        <TabContent>
          {sidebarTab === "system" && (
            <SystemInfoPanel selectedSystemId={selectedSystemId} />
          )}
          {sidebarTab === "overlays" && (
            <OverlayPanel
              overlayConfig={overlayConfig}
              onChange={setOverlayConfig}
              pods={pods}
            />
          )}
        </TabContent>
      </InfoSidebar>
    </PageContainer>
  );
}
