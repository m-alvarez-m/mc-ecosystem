import { getJson } from "../lib/http";

// GET /insight/events/timeline?from=<ISO>&to=<ISO>&limit=<n>
//
// Fuente de verdad del contrato: api/src/insight/types.ts
// (TimelineEvent) y api/src/insight/repository.ts (SQL). La API
// devuelve eventos ORDER BY ts ASC — no hay "descendente"; el
// cliente invierte para presentar "más reciente arriba".
//
// Notas:
//   - `from` y `to` son requeridos por schema.
//   - `limit` opcional; D5 fija 20.
//   - `data` es opaco (JSONB): el Timeline NO lo pinta — el
//     `eventFormatters` genera el titulo humano a partir de `type`.

export interface TimelineEvent {
  id: string;
  event_uuid: string;
  type: string;
  v: number;
  ts: string;
  received_at: string;
  player_uuid: string | null;
  world: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  data: Record<string, unknown>;
}

export interface TimelineQuery {
  from: string;
  to: string;
  limit: number;
}

function toQueryString(params: TimelineQuery): string {
  const usp = new URLSearchParams({
    from: params.from,
    to: params.to,
    limit: String(params.limit),
  });
  return `?${usp.toString()}`;
}

export async function fetchTimeline(
  params: TimelineQuery,
): Promise<TimelineEvent[]> {
  return getJson<TimelineEvent[]>(
    `/insight/events/timeline${toQueryString(params)}`,
  );
}
