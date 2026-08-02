import { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import * as repo from "../insight/repository";
import {
  countQuerySchema,
  timelineQuerySchema,
  playersQuerySchema,
  playerParamsSchema,
} from "../insight/schemas";

// Rutas GET /insight/*.
//
// Separación deliberada de /events y /players:
//   - POST /events (routes/events.ts) → consumo operacional del
//     plugin. Escritura (append-only).
//   - GET /players/:uuid (routes/players.ts) → resolución de identidad
//     puntual. Lectura simple.
//   - GET /insight/* (este archivo) → consumo analítico histórico.
//     Sólo lectura, sólo agregaciones sobre lo que ya existe en la DB.
//
// El router es fino: parsea params, delega a `insight/repository.ts`,
// devuelve el resultado. Cero SQL aquí — así los tests unitarios
// del repositorio se pueden hacer sin Fastify si algún día se
// necesita, y este archivo se centra sólo en el contrato HTTP.

export interface InsightRoutesDeps {
  /** GET-only: /insight/* nunca abre transacciones ni escribe. */
  pool: Pick<Pool, "query">;
}

// Cota interna para timeline. El cliente puede pedir cualquier `limit`
// que cumpla el schema (entero positivo); server clamp a MAX.
const DEFAULT_TIMELINE_LIMIT = 100;
const MAX_TIMELINE_LIMIT = 1000;

interface CountQuery {
  from: string;
  to: string;
  type?: string;
}
interface TimelineQuery {
  from: string;
  to: string;
  limit?: string;
}
interface PlayersQuery {
  from: string;
}
interface PlayerParams {
  uuid: string;
}

export async function insightRoutes(
  app: FastifyInstance,
  deps: InsightRoutesDeps,
): Promise<void> {
  const { pool } = deps;

  // -----------------------------------------------------------------
  // GET /insight/events/count
  // -----------------------------------------------------------------

  app.get<{ Querystring: CountQuery }>(
    "/insight/events/count",
    { schema: { querystring: countQuerySchema } },
    async (request) => {
      const q = request.query;
      return repo.countEvents(pool, {
        from: q.from,
        to: q.to,
        type: q.type ?? null,
      });
    },
  );

  // -----------------------------------------------------------------
  // GET /insight/events/timeline
  // -----------------------------------------------------------------

  app.get<{ Querystring: TimelineQuery }>(
    "/insight/events/timeline",
    { schema: { querystring: timelineQuerySchema } },
    async (request) => {
      const q = request.query;
      const limit = Math.min(
        q.limit ? parseInt(q.limit, 10) : DEFAULT_TIMELINE_LIMIT,
        MAX_TIMELINE_LIMIT,
      );
      return repo.timelineEvents(pool, {
        from: q.from,
        to: q.to,
        limit,
      });
    },
  );

  // -----------------------------------------------------------------
  // GET /insight/players
  // -----------------------------------------------------------------

  app.get<{ Querystring: PlayersQuery }>(
    "/insight/players",
    { schema: { querystring: playersQuerySchema } },
    async (request) => {
      return repo.playersSummary(pool, { from: request.query.from });
    },
  );

  // -----------------------------------------------------------------
  // GET /insight/player/:uuid
  // -----------------------------------------------------------------

  app.get<{ Params: PlayerParams }>(
    "/insight/player/:uuid",
    { schema: { params: playerParamsSchema } },
    async (request, reply) => {
      const result = await repo.playerInsight(pool, request.params.uuid);
      if (result === null) {
        return reply.code(404).send({ error: "player_not_found" });
      }
      return result;
    },
  );

  // -----------------------------------------------------------------
  // GET /insight/server
  // -----------------------------------------------------------------

  app.get("/insight/server", async () => {
    return repo.serverInsight(pool);
  });
}
