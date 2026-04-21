import { useState, useMemo } from "react";
import styled from "styled-components";
import { GalaxyMap } from "../components/map/GalaxyMap";
import { SystemInfoPanel } from "../components/map/SystemInfoPanel";
import { buildGalaxyBuffer } from "../lib/galaxyMap";
import { SOLAR_SYSTEMS } from "../lib/solarSystems";

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
  padding: 16px;
`;

const Title = styled.h1`
  font-size: 16px;
  font-weight: 600;
  color: #e8f2ff;
  margin: 0 0 16px 0;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

export function MapPage() {
  const [selectedSystemId, setSelectedSystemId] = useState<number | null>(null);

  const { positions, ids, idToIndex } = useMemo(
    () => buildGalaxyBuffer(Array.from(SOLAR_SYSTEMS.values())),
    [],
  );

  return (
    <PageContainer>
      <CanvasArea>
        <GalaxyMap
          positions={positions}
          ids={ids}
          idToIndex={idToIndex}
          selectedId={selectedSystemId}
          onSelect={setSelectedSystemId}
        />
      </CanvasArea>
      <InfoSidebar>
        <Title>Galaxy Map</Title>
        <SystemInfoPanel selectedSystemId={selectedSystemId} />
      </InfoSidebar>
    </PageContainer>
  );
}
