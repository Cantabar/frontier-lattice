import styled from "styled-components";
import type { OverlayConfig, OverlayFilter, OverlayMode } from "../../lib/overlayTypes";
import { PLANET_TYPES } from "../../lib/overlayData";
import { OverlayLegend } from "./OverlayLegend";
import type { DecryptedPod } from "../../hooks/useLocationPods";

const Section = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: #7a9ab8;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
`;

const FilterList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const FilterButton = styled.button<{ $active: boolean; $disabled?: boolean }>`
  background: ${(p) => (p.$active ? "rgba(100, 160, 220, 0.2)" : "transparent")};
  border: 1px solid ${(p) => (p.$active ? "rgba(100, 160, 220, 0.5)" : "transparent")};
  border-radius: 4px;
  color: ${(p) => (p.$disabled ? "#3a5060" : p.$active ? "#e8f2ff" : "#a0b8cc")};
  cursor: ${(p) => (p.$disabled ? "not-allowed" : "pointer")};
  font-size: 12px;
  padding: 5px 8px;
  text-align: left;
  transition: background 0.1s;

  &:hover:not(:disabled) {
    background: rgba(100, 160, 220, 0.1);
  }
`;

const ModeRow = styled.div`
  display: flex;
  gap: 6px;
`;

const ModeButton = styled.button<{ $active: boolean }>`
  background: ${(p) => (p.$active ? "rgba(100, 160, 220, 0.2)" : "transparent")};
  border: 1px solid ${(p) => (p.$active ? "rgba(100, 160, 220, 0.5)" : "rgba(60, 90, 120, 0.4)")};
  border-radius: 4px;
  color: ${(p) => (p.$active ? "#e8f2ff" : "#7a9ab8")};
  cursor: pointer;
  font-size: 11px;
  padding: 4px 8px;

  &:hover {
    background: rgba(100, 160, 220, 0.1);
  }
`;

const Select = styled.select`
  background: rgba(8, 12, 20, 0.9);
  border: 1px solid rgba(60, 90, 120, 0.5);
  border-radius: 4px;
  color: #c8d8e8;
  font-size: 12px;
  padding: 4px 8px;
  width: 100%;
`;

const Note = styled.div`
  font-size: 11px;
  color: #5a7080;
  font-style: italic;
  margin-top: 4px;
`;

const FILTER_LABELS: Record<OverlayFilter, string> = {
  region:               "Region",
  constellation:        "Constellation",
  ancientCivilizations: "Ancient Civilizations",
  planetCount:          "Planet Count",
  planetType:           "Planet Type",
  moonCount:            "Moon Count",
  npcStations:          "NPC Stations",
  myStructures:         "My Structures",
};

const MODE_LABELS: Record<OverlayMode, string> = {
  color:           "Color",
  glow:            "Glow",
  densityGradient: "Density",
};

const ALL_FILTERS: OverlayFilter[] = [
  "region",
  "constellation",
  "ancientCivilizations",
  "planetCount",
  "planetType",
  "moonCount",
  "npcStations",
  "myStructures",
];

const ALL_MODES: OverlayMode[] = ["color", "glow", "densityGradient"];

interface OverlayPanelProps {
  overlayConfig: OverlayConfig | null;
  onChange: (config: OverlayConfig | null) => void;
  pods: DecryptedPod[];
}

export function OverlayPanel({ overlayConfig, onChange, pods }: OverlayPanelProps) {
  const hasPods = pods.length > 0;
  const activeFilter = overlayConfig?.filter ?? null;
  const activeMode = overlayConfig?.mode ?? "color";

  function selectFilter(filter: OverlayFilter) {
    if (activeFilter === filter) {
      onChange(null);
      return;
    }
    const defaultPlanetTypeId = filter === "planetType" ? PLANET_TYPES[0].typeId : undefined;
    onChange({ filter, mode: activeMode, planetTypeId: defaultPlanetTypeId });
  }

  function selectMode(mode: OverlayMode) {
    if (!overlayConfig) return;
    onChange({ ...overlayConfig, mode });
  }

  function selectPlanetType(typeId: number) {
    if (!overlayConfig) return;
    onChange({ ...overlayConfig, planetTypeId: typeId });
  }

  return (
    <div>
      <Section>
        <Label>Filter</Label>
        <FilterList>
          <FilterButton $active={activeFilter === null} onClick={() => onChange(null)}>
            None
          </FilterButton>
          {ALL_FILTERS.map((filter) => {
            const disabled = filter === "myStructures" && !hasPods;
            return (
              <FilterButton
                key={filter}
                $active={activeFilter === filter}
                $disabled={disabled}
                disabled={disabled}
                onClick={() => !disabled && selectFilter(filter)}
              >
                {FILTER_LABELS[filter]}
                {disabled && " (sign in on Locations page)"}
              </FilterButton>
            );
          })}
        </FilterList>
      </Section>

      {overlayConfig && (
        <Section>
          <Label>Render Mode</Label>
          <ModeRow>
            {ALL_MODES.map((mode) => (
              <ModeButton key={mode} $active={activeMode === mode} onClick={() => selectMode(mode)}>
                {MODE_LABELS[mode]}
              </ModeButton>
            ))}
          </ModeRow>
        </Section>
      )}

      {overlayConfig?.filter === "planetType" && (
        <Section>
          <Label>Planet Type</Label>
          <Select
            value={overlayConfig.planetTypeId ?? PLANET_TYPES[0].typeId}
            onChange={(e) => selectPlanetType(Number(e.target.value))}
          >
            {PLANET_TYPES.map((t) => (
              <option key={t.typeId} value={t.typeId}>
                {t.name}
              </option>
            ))}
          </Select>
        </Section>
      )}

      {overlayConfig && (
        <>
          <OverlayLegend overlayConfig={overlayConfig} />
          {overlayConfig.filter === "myStructures" && (
            <Note>Showing your solo structures only.</Note>
          )}
        </>
      )}
    </div>
  );
}
