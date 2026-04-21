import styled from "styled-components";
import { SOLAR_SYSTEMS, solarSystemName } from "../../lib/solarSystems";
import { constellationName, regionName } from "../../lib/regions";
import { formatCoordLy } from "../../lib/galaxyMap";

export interface SystemInfoPanelProps {
  selectedSystemId: number | null;
}

const Panel = styled.div`
  background: rgba(10, 15, 25, 0.82);
  border: 1px solid rgba(100, 160, 220, 0.25);
  border-radius: 6px;
  padding: 12px 16px;
  color: #c8d8e8;
  font-size: 13px;
  line-height: 1.6;
`;

const SystemName = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: #e8f2ff;
  margin-bottom: 4px;
`;

const SystemId = styled.div`
  color: #7a9ab8;
  font-size: 12px;
  margin-bottom: 8px;
`;

const Detail = styled.div`
  color: #a0b8cc;
  font-size: 12px;
`;

const EmptyState = styled.div`
  color: #6080a0;
  font-style: italic;
`;

export function SystemInfoPanel({ selectedSystemId }: SystemInfoPanelProps) {
  if (selectedSystemId === null) {
    return (
      <Panel data-testid="system-info-panel">
        <EmptyState>Select a solar system</EmptyState>
      </Panel>
    );
  }

  const entry = SOLAR_SYSTEMS.get(selectedSystemId);
  const name = solarSystemName(selectedSystemId);
  const constellation = entry ? constellationName(entry.constellationId) : "Unknown";
  const region = entry ? regionName(entry.regionId) : "Unknown";

  return (
    <Panel data-testid="system-info-panel">
      <SystemName>{name}</SystemName>
      <SystemId>{selectedSystemId}</SystemId>
      <Detail>Constellation: {constellation}</Detail>
      <Detail>Region: {region}</Detail>
      {entry && (
        <>
          <Detail>X: {formatCoordLy(entry.x)}</Detail>
          <Detail>Y: {formatCoordLy(entry.y)}</Detail>
          <Detail>Z: {formatCoordLy(entry.z)}</Detail>
        </>
      )}
    </Panel>
  );
}
