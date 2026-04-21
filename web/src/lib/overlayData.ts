import overlayDataJson from '../data/overlay-data.json';

type SystemRow = [number, number | null, number, number, number, number];

const data = overlayDataJson as unknown as {
  systems: SystemRow[];
  regionAdj: [number, number][];
  constAdj: [number, number][];
};

export const SYSTEM_FACTION = new Map<number, number | null>();
export const SYSTEM_PLANET_COUNT = new Map<number, number>();
export const SYSTEM_PLANET_BITMASK = new Map<number, number>();
export const SYSTEM_MOON_COUNT = new Map<number, number>();
export const SYSTEM_HAS_NPC_STATION = new Set<number>();

let maxPlanetCount = 0;
let maxMoonCount = 0;

for (const [sysId, factionId, totalPlanets, bitmask, moonCount, hasStation] of data.systems) {
  SYSTEM_FACTION.set(sysId, factionId);
  SYSTEM_PLANET_COUNT.set(sysId, totalPlanets);
  SYSTEM_PLANET_BITMASK.set(sysId, bitmask);
  SYSTEM_MOON_COUNT.set(sysId, moonCount);
  if (hasStation) {
    SYSTEM_HAS_NPC_STATION.add(sysId);
  }
  if (totalPlanets > maxPlanetCount) maxPlanetCount = totalPlanets;
  if (moonCount > maxMoonCount) maxMoonCount = moonCount;
}

export const MAX_PLANET_COUNT: number = maxPlanetCount;
export const MAX_MOON_COUNT: number = maxMoonCount;

export const PLANET_TYPES: ReadonlyArray<{ typeId: number; name: string; bit: number }> = [
  { typeId: 11,   name: 'Temperate', bit: 0 },
  { typeId: 12,   name: 'Ice',       bit: 1 },
  { typeId: 13,   name: 'Gas',       bit: 2 },
  { typeId: 2014, name: 'Oceanic',   bit: 3 },
  { typeId: 2015, name: 'Lava',      bit: 4 },
  { typeId: 2016, name: 'Barren',    bit: 5 },
  { typeId: 2063, name: 'Plasma',    bit: 6 },
];

export const REGION_ADJACENCY = new Map<number, number[]>();
export const CONSTELLATION_ADJACENCY = new Map<number, number[]>();

for (const [a, b] of data.regionAdj) {
  if (!REGION_ADJACENCY.has(a)) REGION_ADJACENCY.set(a, []);
  if (!REGION_ADJACENCY.has(b)) REGION_ADJACENCY.set(b, []);
  REGION_ADJACENCY.get(a)!.push(b);
  REGION_ADJACENCY.get(b)!.push(a);
}

for (const [a, b] of data.constAdj) {
  if (!CONSTELLATION_ADJACENCY.has(a)) CONSTELLATION_ADJACENCY.set(a, []);
  if (!CONSTELLATION_ADJACENCY.has(b)) CONSTELLATION_ADJACENCY.set(b, []);
  CONSTELLATION_ADJACENCY.get(a)!.push(b);
  CONSTELLATION_ADJACENCY.get(b)!.push(a);
}
