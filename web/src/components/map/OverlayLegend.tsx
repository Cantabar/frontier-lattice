import * as THREE from "three";
import styled from "styled-components";
import type { OverlayConfig } from "../../lib/overlayTypes";
import {
  REGION_COLOR_MAP,
  CONSTELLATION_COLOR_MAP,
  ANCIENT_CIV_COLORS,
  ACCENT_COLOR,
  DIM_COLOR,
  GRADIENT_FROM,
  GRADIENT_TO,
} from "../../lib/overlayPalette";
import { MAX_PLANET_COUNT, MAX_MOON_COUNT, PLANET_TYPES } from "../../lib/overlayData";
import { regionName, constellationName } from "../../lib/regions";

const MAX_SWATCHES = 8;

const Wrapper = styled.div`
  margin-top: 12px;
`;

const SwatchRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 11px;
  color: #a0b8cc;
`;

const Swatch = styled.div<{ $color: string }>`
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: ${(p) => p.$color};
  flex-shrink: 0;
`;

const More = styled.div`
  font-size: 11px;
  color: #6080a0;
  margin-top: 4px;
`;

const GradientBar = styled.div`
  height: 10px;
  border-radius: 3px;
  background: linear-gradient(to right, ${GRADIENT_FROM.getStyle()}, ${GRADIENT_TO.getStyle()});
  margin-bottom: 4px;
`;

const GradientLabels = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #6080a0;
`;

function threeToHex(c: THREE.Color): string {
  return `#${c.getHexString()}`;
}

interface CategoricalEntry {
  label: string;
  color: THREE.Color;
}

function CategoricalLegend({ entries }: { entries: CategoricalEntry[] }) {
  const visible = entries.slice(0, MAX_SWATCHES);
  const overflow = entries.length - MAX_SWATCHES;
  return (
    <Wrapper>
      {visible.map((e) => (
        <SwatchRow key={e.label}>
          <Swatch $color={threeToHex(e.color)} />
          {e.label}
        </SwatchRow>
      ))}
      {overflow > 0 && <More>+ {overflow} more</More>}
    </Wrapper>
  );
}

function GradientLegend({ minLabel, maxLabel }: { minLabel: string; maxLabel: string }) {
  return (
    <Wrapper>
      <GradientBar />
      <GradientLabels>
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </GradientLabels>
    </Wrapper>
  );
}

interface OverlayLegendProps {
  overlayConfig: OverlayConfig;
}

export function OverlayLegend({ overlayConfig }: OverlayLegendProps) {
  const { filter } = overlayConfig;

  if (filter === "region") {
    const entries: CategoricalEntry[] = [];
    for (const [id, color] of REGION_COLOR_MAP) {
      entries.push({ label: regionName(id), color });
    }
    return <CategoricalLegend entries={entries} />;
  }

  if (filter === "constellation") {
    const entries: CategoricalEntry[] = [];
    for (const [id, color] of CONSTELLATION_COLOR_MAP) {
      entries.push({ label: constellationName(id), color });
    }
    return <CategoricalLegend entries={entries} />;
  }

  if (filter === "ancientCivilizations") {
    return (
      <CategoricalLegend
        entries={[
          { label: "Jove Empire",      color: ANCIENT_CIV_COLORS[500074] },
          { label: "Triglavian",        color: ANCIENT_CIV_COLORS[500075] },
          { label: "Drifters",          color: ANCIENT_CIV_COLORS[500078] },
          { label: "Unclaimed",         color: ANCIENT_CIV_COLORS.unclaimed },
        ]}
      />
    );
  }

  if (filter === "planetCount") {
    return <GradientLegend minLabel="0 planets" maxLabel={`${MAX_PLANET_COUNT} planets`} />;
  }

  if (filter === "moonCount") {
    return <GradientLegend minLabel="0 moons" maxLabel={`${MAX_MOON_COUNT} moons`} />;
  }

  if (filter === "planetType") {
    const typeId = overlayConfig.planetTypeId;
    const type = PLANET_TYPES.find((t) => t.typeId === typeId);
    return (
      <CategoricalLegend
        entries={[
          { label: type ? `Has ${type.name}` : "Has type", color: ACCENT_COLOR },
          { label: "No match",                               color: DIM_COLOR },
        ]}
      />
    );
  }

  if (filter === "npcStations") {
    return (
      <CategoricalLegend
        entries={[
          { label: "Has NPC station", color: ACCENT_COLOR },
          { label: "No station",      color: DIM_COLOR },
        ]}
      />
    );
  }

  if (filter === "myStructures") {
    return (
      <CategoricalLegend
        entries={[
          { label: "Has my structure", color: ACCENT_COLOR },
          { label: "No structure",     color: DIM_COLOR },
        ]}
      />
    );
  }

  return null;
}
