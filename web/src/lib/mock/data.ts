/**
 * Static fixture data for local development.
 *
 * Only the World API tribe list is mocked — the Eve Frontier World API
 * has no localnet data, so useWorldTribeInfo returns these fixtures when
 * appEnv === "local".
 */

import type { WorldTribeInfo } from "../types";

// ---------------------------------------------------------------------------
// World API tribe fixtures (used by useWorldTribeInfo in local env)
// ---------------------------------------------------------------------------

export const mockWorldTribes: WorldTribeInfo[] = [
  {
    id: 1,
    name: "Pathfinder Collective",
    nameShort: "PGCL",
    description: "Explorers charting the uncharted.",
    taxRate: 5,
    tribeUrl: "",
  },
  {
    id: 2,
    name: "Iron Meridian",
    nameShort: "IRON",
    description: "Industrial backbone of the frontier.",
    taxRate: 8,
    tribeUrl: "",
  },
  {
    id: 3,
    name: "Void Sentinels",
    nameShort: "VOID",
    description: "Defence specialists guarding the gates.",
    taxRate: 3,
    tribeUrl: "",
  },
];
