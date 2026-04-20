import type { SolarSystemEntry } from "./solarSystems";
import type { RegionEntry } from "./regions";

/** 1 light-year in meters (game coordinate unit). */
const METERS_PER_LY = 9_460_730_472_580_800n;

/**
 * Converts an array of solar systems into a flat Float32Array buffer suitable
 * for GPU upload, alongside parallel id and reverse-lookup structures.
 */
export function buildGalaxyBuffer(systems: SolarSystemEntry[]): {
  positions: Float32Array;
  ids: number[];
  idToIndex: Map<number, number>;
} {
  const positions = new Float32Array(systems.length * 3);
  const ids: number[] = [];
  const idToIndex = new Map<number, number>();

  for (let i = 0; i < systems.length; i++) {
    const entry = systems[i];
    positions[i * 3] = Number(entry.x / METERS_PER_LY);
    positions[i * 3 + 1] = Number(entry.y / METERS_PER_LY);
    positions[i * 3 + 2] = Number(entry.z / METERS_PER_LY);
    ids.push(entry.id);
    idToIndex.set(entry.id, i);
  }

  return { positions, ids, idToIndex };
}

/**
 * Computes the union bounding box across all regions, returning values in
 * light-year scale as plain numbers.
 */
export function computeGalaxyBounds(regions: RegionEntry[]): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
} {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;

  for (const region of regions) {
    const { bounds } = region;
    xMin = Math.min(xMin, Number(bounds.xMin / METERS_PER_LY));
    xMax = Math.max(xMax, Number(bounds.xMax / METERS_PER_LY));
    yMin = Math.min(yMin, Number(bounds.yMin / METERS_PER_LY));
    yMax = Math.max(yMax, Number(bounds.yMax / METERS_PER_LY));
    zMin = Math.min(zMin, Number(bounds.zMin / METERS_PER_LY));
    zMax = Math.max(zMax, Number(bounds.zMax / METERS_PER_LY));
  }

  return { xMin, xMax, yMin, yMax, zMin, zMax };
}
