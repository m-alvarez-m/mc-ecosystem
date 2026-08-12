import { FastifyInstance } from "fastify";
import type { Pool } from "pg";

// GET /players/online (B.1 · ADR-016 D3).
//
// Deriva la lista de jugadores online desde `events`: aquellos cuyo
// último `session.start` es posterior a su último `session.end` (o
// que nunca cerraron sesión). Une con `players` para el name canónico.
//
// Orden ASC por session_start: el jugador que lleva más tiempo online
// aparece primero (ADR-016 D3 · "el que lleva más tiempo primero").
//
// Sin auth: red interna Docker Compose (decisión de dueño registrada
// en la implementación de B.1). Cuando se decida exponer la api fuera
// de la red interna, un ADR futuro definirá la política de auth
// bot↔api.

export interface PlayersOnlineRoutesDeps {
  pool: Pick<Pool, "query">;
}

interface OnlineRow {
  uuid: string;
  name: string;
  session_start_ts: Date;
}

const SQL = `
  SELECT
    p.uuid,
    p.name,
    starts.last_start AS session_start_ts
  FROM (
    SELECT
      player_uuid,
      MAX(ts) FILTER (WHERE type = 'session.start') AS last_start,
      MAX(ts) FILTER (WHERE type = 'session.end')   AS last_end
    FROM events
    WHERE type IN ('session.start', 'session.end')
      AND player_uuid IS NOT NULL
    GROUP BY player_uuid
    HAVING MAX(ts) FILTER (WHERE type = 'session.start') IS NOT NULL
       AND MAX(ts) FILTER (WHERE type = 'session.start') >
           COALESCE(MAX(ts) FILTER (WHERE type = 'session.end'),
                    '-infinity'::timestamptz)
  ) AS starts
  JOIN players p ON p.uuid = starts.player_uuid
  ORDER BY starts.last_start ASC
`;

export async function playersOnlineRoutes(
  app: FastifyInstance,
  deps: PlayersOnlineRoutesDeps,
) {
  const { pool } = deps;

  app.get("/players/online", async () => {
    const result = await pool.query<OnlineRow>(SQL);
    return {
      players: result.rows.map((r) => ({
        uuid: r.uuid,
        name: r.name,
        session_start_ts: r.session_start_ts,
      })),
    };
  });
}
