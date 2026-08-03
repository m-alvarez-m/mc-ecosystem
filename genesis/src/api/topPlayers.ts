import { getJson } from "../lib/http";

// GET /insight/players/top?from=<ISO>&to=<ISO>&limit=<n>
//
// Fuente: api/src/insight/types.ts (TopPlayer). Devuelve top-N
// jugadores por número de eventos en el rango [from, to], junto
// con el nombre canónico (JOIN con `players`) — evita N+1 desde
// el consumidor. `count` es STRING (BIGINT-safe).

export interface TopPlayer {
  uuid: string;
  name: string;
  count: string;
}

export interface TopPlayersQuery {
  from: string;
  to: string;
  limit: number;
}

function toQueryString(params: TopPlayersQuery): string {
  const usp = new URLSearchParams({
    from: params.from,
    to: params.to,
    limit: String(params.limit),
  });
  return `?${usp.toString()}`;
}

export async function fetchTopPlayers(
  params: TopPlayersQuery,
): Promise<TopPlayer[]> {
  return getJson<TopPlayer[]>(`/insight/players/top${toQueryString(params)}`);
}
