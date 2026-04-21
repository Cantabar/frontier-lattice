import { useMemo } from 'react';
import * as THREE from 'three';
import type { OverlayConfig } from '../lib/overlayTypes';
import type { DecryptedPod } from './useLocationPods';
import { SOLAR_SYSTEMS } from '../lib/solarSystems';
import {
  SYSTEM_FACTION, SYSTEM_PLANET_COUNT, SYSTEM_PLANET_BITMASK,
  SYSTEM_MOON_COUNT, SYSTEM_HAS_NPC_STATION, PLANET_TYPES,
  MAX_PLANET_COUNT, MAX_MOON_COUNT,
} from '../lib/overlayData';
import {
  REGION_COLOR_MAP, CONSTELLATION_COLOR_MAP, ANCIENT_CIV_COLORS,
  ACCENT_COLOR, DIM_COLOR, GRADIENT_FROM, GRADIENT_TO, gradientColor,
} from '../lib/overlayPalette';

export function useOverlayColors(params: {
  overlayConfig: OverlayConfig | null;
  ids: number[];
  pods: DecryptedPod[];
}): {
  colors: Float32Array | null;
  glowMask: Float32Array | null;
  densityMask: Float32Array | null;
} {
  const { overlayConfig, ids, pods } = params;

  return useMemo(() => {
    if (overlayConfig === null) {
      return { colors: null, glowMask: null, densityMask: null };
    }

    const { filter, mode, planetTypeId } = overlayConfig;
    const N = ids.length;

    // Helper: get color for a system by filter
    function getColor(id: number): THREE.Color {
      switch (filter) {
        case 'region': {
          const sys = SOLAR_SYSTEMS.get(id);
          return REGION_COLOR_MAP.get(sys?.regionId ?? 0) ?? DIM_COLOR;
        }
        case 'constellation': {
          const sys = SOLAR_SYSTEMS.get(id);
          return CONSTELLATION_COLOR_MAP.get(sys?.constellationId ?? 0) ?? DIM_COLOR;
        }
        case 'ancientCivilizations': {
          const factionId = SYSTEM_FACTION.get(id);
          if (factionId === 500074 || factionId === 500075 || factionId === 500078) {
            return ANCIENT_CIV_COLORS[factionId];
          }
          return ANCIENT_CIV_COLORS.unclaimed;
        }
        case 'planetCount': {
          return gradientColor(
            SYSTEM_PLANET_COUNT.get(id) ?? 0,
            0,
            MAX_PLANET_COUNT,
            GRADIENT_FROM,
            GRADIENT_TO,
          );
        }
        case 'planetType': {
          if (planetTypeId == null) return DIM_COLOR;
          const entry = PLANET_TYPES.find((pt) => pt.typeId === planetTypeId);
          if (entry == null) return DIM_COLOR;
          const bitmask = SYSTEM_PLANET_BITMASK.get(id) ?? 0;
          return (bitmask & (1 << entry.bit)) !== 0 ? ACCENT_COLOR : DIM_COLOR;
        }
        case 'moonCount': {
          return gradientColor(
            SYSTEM_MOON_COUNT.get(id) ?? 0,
            0,
            MAX_MOON_COUNT,
            GRADIENT_FROM,
            GRADIENT_TO,
          );
        }
        case 'npcStations': {
          return SYSTEM_HAS_NPC_STATION.has(id) ? ACCENT_COLOR : DIM_COLOR;
        }
        case 'myStructures': {
          const hasStructure = pods.some((pod) => pod.location.solarSystemId === id);
          return hasStructure ? ACCENT_COLOR : DIM_COLOR;
        }
        default:
          return DIM_COLOR;
      }
    }

    // Helper: does system qualify (for glow/density masks)
    function qualifies(id: number): boolean {
      switch (filter) {
        case 'region': {
          const sys = SOLAR_SYSTEMS.get(id);
          const c = REGION_COLOR_MAP.get(sys?.regionId ?? 0) ?? DIM_COLOR;
          return c !== DIM_COLOR;
        }
        case 'constellation': {
          const sys = SOLAR_SYSTEMS.get(id);
          const c = CONSTELLATION_COLOR_MAP.get(sys?.constellationId ?? 0) ?? DIM_COLOR;
          return c !== DIM_COLOR;
        }
        case 'ancientCivilizations': {
          const factionId = SYSTEM_FACTION.get(id);
          return factionId === 500074 || factionId === 500075 || factionId === 500078;
        }
        case 'planetCount': {
          return (SYSTEM_PLANET_COUNT.get(id) ?? 0) > 0;
        }
        case 'planetType': {
          if (planetTypeId == null) return false;
          const entry = PLANET_TYPES.find((pt) => pt.typeId === planetTypeId);
          if (entry == null) return false;
          const bitmask = SYSTEM_PLANET_BITMASK.get(id) ?? 0;
          return (bitmask & (1 << entry.bit)) !== 0;
        }
        case 'moonCount': {
          return (SYSTEM_MOON_COUNT.get(id) ?? 0) > 0;
        }
        case 'npcStations': {
          return SYSTEM_HAS_NPC_STATION.has(id);
        }
        case 'myStructures': {
          return pods.some((pod) => pod.location.solarSystemId === id);
        }
        default:
          return false;
      }
    }

    if (mode === 'densityGradient') {
      const densityMask = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        densityMask[i] = qualifies(ids[i]) ? 1.0 : 0.0;
      }
      return { colors: null, glowMask: null, densityMask };
    }

    // Both 'color' and 'glow' modes produce a colors buffer
    const colors = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const c = getColor(ids[i]);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    if (mode === 'glow') {
      const glowMask = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        glowMask[i] = qualifies(ids[i]) ? 1.0 : 0.0;
      }
      return { colors, glowMask, densityMask: null };
    }

    // mode === 'color'
    return { colors, glowMask: null, densityMask: null };
  }, [overlayConfig, ids, pods]);
}
