/**
 * resetCormPhase — calls the continuity-engine API to reset a corm's phase.
 *
 * POST /api/reset-phase { network_node_id, phase }
 */

import { config } from "../config";

export interface ResetPhaseResult {
  ok: boolean;
  phase: number;
  chain: string;
}

export async function resetCormPhase(
  networkNodeId: string,
  phase: number,
): Promise<ResetPhaseResult> {
  const url = `${config.continuityEngineUrl}/api/reset-phase`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ network_node_id: networkNodeId, phase }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${resp.status}`);
  }

  return resp.json() as Promise<ResetPhaseResult>;
}
