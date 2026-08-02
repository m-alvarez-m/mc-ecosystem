import type { Pool } from "pg";
import type {
  EventCount,
  PlayerEventReference,
  PlayerInsight,
  PlayersSummary,
  ServerInsight,
  ServerEventReference,
  TimelineEvent,
} from "./types";

// Repositorio SQL de Insight.
//
// Toda la SQL vive aquí — las rutas del router en `routes/insight.ts`
// solamente parsean parámetros, invocan estas funciones y formatean
// la respuesta HTTP.
//
// Contrato: cada función recibe `Pick<Pool, "query">` (mismo subset
// que routes/events.ts para GET, permite inyectar fake en tests) y
// devuelve tipos ya listos para serializar. Las funciones NO lanzan
// por errores de dominio — devuelven `null` para "no encontrado".
// Los errores de DB propagan (Fastify → 500).
//
// SQL:
//   - Sólo SELECT sobre `events`, `players`, `player_names`.
//   - Sin CREATE, sin ALTER, sin UPDATE, sin INSERT — coherente con
//     el rol `mc_app` (append-only en events; SELECT/INSERT/UPDATE
//     en players; SELECT/INSERT en player_names).
//   - Sin operadores JSONB salvo cuando el ticket lo requiera
//     (ninguna consulta actual lo necesita).
//   - `id::text` y `COUNT(*)::text` para blindar BIGINT como string
//     en JS (>2^53).
//   - Uso de índices existentes: `ix_events_type_ts` (type + rango
//     temporal), `ix_events_player_ts` (jugador + rango temporal),
//     `id` PK (order/limit).

/** Subset de Pool que necesita el repositorio. */
type QueryClient = Pick<Pool, "query">;

// --------------------------------------------------------------------
// GET /insight/events/count
// --------------------------------------------------------------------

export async function countEvents(
  pool: QueryClient,
  params: { from: string; to: string; type: string | null },
): Promise<EventCount> {
  // Un solo GROUP BY. El total se calcula sumando en código —
  // evita una segunda query redundante.
  const result = await pool.query<{ type: string; count: string }>(
    `SELECT type, COUNT(*)::text AS count
       FROM events
       WHERE ts >= $1::timestamptz
         AND ts <= $2::timestamptz
         AND ($3::text IS NULL OR type = $3::text)
       GROUP BY type
       ORDER BY COUNT(*) DESC, type ASC`,
    [params.from, params.to, params.type],
  );
  const groupedByType = result.rows;
  let total = 0n;
  for (const row of groupedByType) {
    total += BigInt(row.count);
  }
  return { total: total.toString(), groupedByType };
}

// --------------------------------------------------------------------
// GET /insight/events/timeline
// --------------------------------------------------------------------

export async function timelineEvents(
  pool: QueryClient,
  params: { from: string; to: string; limit: number },
): Promise<TimelineEvent[]> {
  const result = await pool.query<TimelineEvent>(
    `SELECT id::text AS id,
            event_uuid,
            type,
            v,
            ts,
            received_at,
            player_uuid,
            world,
            x, y, z,
            data
       FROM events
       WHERE ts >= $1::timestamptz
         AND ts <= $2::timestamptz
       ORDER BY ts ASC, id ASC
       LIMIT $3::int`,
    [params.from, params.to, params.limit],
  );
  return result.rows;
}

// --------------------------------------------------------------------
// GET /insight/players
// --------------------------------------------------------------------

export async function playersSummary(
  pool: QueryClient,
  params: { from: string },
): Promise<PlayersSummary> {
  // Todo en una sola query — 4 subconsultas sobre `players` con
  // filtros distintos. La tabla es pequeña (uno por jugador único
  // en la historia del server), no justifica optimización mayor.
  const result = await pool.query<{
    total_players: string;
    active_players: string;
    new_players: string;
    returning_players: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM players) AS total_players,
       (SELECT COUNT(*)::text FROM players
          WHERE last_seen >= $1::timestamptz) AS active_players,
       (SELECT COUNT(*)::text FROM players
          WHERE first_seen >= $1::timestamptz) AS new_players,
       (SELECT COUNT(*)::text FROM players
          WHERE first_seen <  $1::timestamptz
            AND last_seen  >= $1::timestamptz) AS returning_players`,
    [params.from],
  );
  const row = result.rows[0]!;
  return {
    totalPlayers: row.total_players,
    activePlayers: row.active_players,
    newPlayers: row.new_players,
    returningPlayers: row.returning_players,
  };
}

// --------------------------------------------------------------------
// GET /insight/player/:uuid
// --------------------------------------------------------------------

export async function playerInsight(
  pool: QueryClient,
  uuid: string,
): Promise<PlayerInsight | null> {
  // 1) Datos base del jugador (nombre actual, first/last seen).
  const playerResult = await pool.query<{
    uuid: string;
    name: string;
  }>(
    `SELECT uuid, name FROM players WHERE uuid = $1`,
    [uuid],
  );
  if (playerResult.rows.length === 0) return null;
  const player = playerResult.rows[0]!;

  // 2) Historial de nombres (player_names es append-only).
  const nameHistoryResult = await pool.query<{ name: string; seen_at: Date }>(
    `SELECT name, seen_at
       FROM player_names
       WHERE player_uuid = $1
       ORDER BY seen_at ASC`,
    [uuid],
  );

  // 3) Primer y último evento del jugador. Usa `ix_events_player_ts`.
  const firstEventResult = await pool.query<PlayerEventReference>(
    `SELECT id::text AS id, event_uuid, type, ts
       FROM events
       WHERE player_uuid = $1
       ORDER BY ts ASC, id ASC
       LIMIT 1`,
    [uuid],
  );
  const lastEventResult = await pool.query<PlayerEventReference>(
    `SELECT id::text AS id, event_uuid, type, ts
       FROM events
       WHERE player_uuid = $1
       ORDER BY ts DESC, id DESC
       LIMIT 1`,
    [uuid],
  );

  // 4) Conteo por tipo (con el total derivado sumando en código).
  const groupedResult = await pool.query<{ type: string; count: string }>(
    `SELECT type, COUNT(*)::text AS count
       FROM events
       WHERE player_uuid = $1
       GROUP BY type
       ORDER BY COUNT(*) DESC, type ASC`,
    [uuid],
  );
  let totalEvents = 0n;
  for (const row of groupedResult.rows) {
    totalEvents += BigInt(row.count);
  }

  return {
    uuid: player.uuid,
    name: player.name,
    nameHistory: nameHistoryResult.rows,
    firstEvent: firstEventResult.rows[0] ?? null,
    lastEvent: lastEventResult.rows[0] ?? null,
    totalEvents: totalEvents.toString(),
    eventsByType: groupedResult.rows,
  };
}

// --------------------------------------------------------------------
// GET /insight/server
// --------------------------------------------------------------------

export async function serverInsight(pool: QueryClient): Promise<ServerInsight> {
  // Total + distinct types + latest id: subconsultas ligeras en una
  // sola query. `MAX(id)` usa el PK directamente.
  const summaryResult = await pool.query<{
    total_events: string;
    distinct_types: string;
    latest_id: string | null;
  }>(
    `SELECT
       (SELECT COUNT(*)::text        FROM events) AS total_events,
       (SELECT COUNT(DISTINCT type)::text FROM events) AS distinct_types,
       (SELECT MAX(id)::text         FROM events) AS latest_id`,
  );

  // Primer y último evento: por `id` (PK ordena cronológicamente ya
  // que la columna es IDENTITY monotónica). Cero scan sobre `ts`.
  const firstResult = await pool.query<ServerEventReference>(
    `SELECT id::text AS id, event_uuid, type, ts
       FROM events
       ORDER BY id ASC
       LIMIT 1`,
  );
  const lastResult = await pool.query<ServerEventReference>(
    `SELECT id::text AS id, event_uuid, type, ts
       FROM events
       ORDER BY id DESC
       LIMIT 1`,
  );

  const summary = summaryResult.rows[0]!;
  const firstEvent = firstResult.rows[0] ?? null;
  const lastEvent = lastResult.rows[0] ?? null;

  return {
    firstEvent,
    lastEvent,
    totalEvents: summary.total_events ?? "0",
    distinctTypes: summary.distinct_types ?? "0",
    latestId: summary.latest_id ?? null,
    timeRangeStart: firstEvent?.ts ?? null,
    timeRangeEnd: lastEvent?.ts ?? null,
  };
}
