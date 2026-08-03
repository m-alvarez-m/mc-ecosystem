import { getJson } from "../lib/http";

// GET /insight/players?from=<ISO> — resumen server-wide de jugadores.
// Fuente: api/src/insight/types.ts (PlayersSummary). Todos los
// contadores viajan como STRING (BIGINT-safe). La definición del
// contrato garantiza `activePlayers = newPlayers + returningPlayers`.
//   - `totalPlayers`: histórico total (no filtrado por `from`).
//   - `activePlayers`: last_seen >= from
//   - `newPlayers`: first_seen >= from
//   - `returningPlayers`: first_seen < from && last_seen >= from

export interface PlayersSummary {
  totalPlayers: string;
  activePlayers: string;
  newPlayers: string;
  returningPlayers: string;
}

export interface PlayersSummaryQuery {
  from: string;
}

function toQueryString(params: PlayersSummaryQuery): string {
  const usp = new URLSearchParams({ from: params.from });
  return `?${usp.toString()}`;
}

export async function fetchPlayersSummary(
  params: PlayersSummaryQuery,
): Promise<PlayersSummary> {
  return getJson<PlayersSummary>(`/insight/players${toQueryString(params)}`);
}
