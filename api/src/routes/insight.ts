import { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import * as repo from "../insight/repository";
import * as signals from "../insight/signals";
import {
  activityQuerySchema,
  countQuerySchema,
  patternsPlayersQuerySchema,
  patternsRangeQuerySchema,
  playerParamsSchema,
  playersQuerySchema,
  timelineQuerySchema,
  topRankingQuerySchema,
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

// Cota interna para rankings (top players / top event types). Un
// ranking rara vez es útil por encima de 100 filas — el cliente
// puede pedir menos si sólo quiere podio.
const DEFAULT_RANKING_LIMIT = 10;
const MAX_RANKING_LIMIT = 100;

// Defaults para /insight/patterns/players. Elegidos como valores
// razonables sin heurísticas ocultas — el consumidor puede
// sobreescribirlos explícitamente por query param.
const DEFAULT_MIN_ACTIVE_DAYS = 3;
const DEFAULT_IDLE_THRESHOLD_DAYS = 30;

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
interface ActivityQuery {
  from: string;
  to: string;
}
interface TopRankingQuery {
  from: string;
  to: string;
  limit?: string;
}
interface PatternsRangeQuery {
  from: string;
  to: string;
}
interface PatternsPlayersQuery {
  from: string;
  to: string;
  minActiveDays?: string;
  idleThresholdDays?: string;
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

  // -----------------------------------------------------------------
  // I2 · Agregados
  // -----------------------------------------------------------------

  app.get<{ Querystring: ActivityQuery }>(
    "/insight/activity/hourly",
    { schema: { querystring: activityQuerySchema } },
    async (request) => {
      const q = request.query;
      return repo.activityByHour(pool, { from: q.from, to: q.to });
    },
  );

  app.get<{ Querystring: ActivityQuery }>(
    "/insight/activity/daily",
    { schema: { querystring: activityQuerySchema } },
    async (request) => {
      const q = request.query;
      return repo.activityByDay(pool, { from: q.from, to: q.to });
    },
  );

  app.get<{ Querystring: TopRankingQuery }>(
    "/insight/players/top",
    { schema: { querystring: topRankingQuerySchema } },
    async (request) => {
      const q = request.query;
      const limit = Math.min(
        q.limit ? parseInt(q.limit, 10) : DEFAULT_RANKING_LIMIT,
        MAX_RANKING_LIMIT,
      );
      return repo.topPlayers(pool, { from: q.from, to: q.to, limit });
    },
  );

  app.get<{ Querystring: TopRankingQuery }>(
    "/insight/types/top",
    { schema: { querystring: topRankingQuerySchema } },
    async (request) => {
      const q = request.query;
      const limit = Math.min(
        q.limit ? parseInt(q.limit, 10) : DEFAULT_RANKING_LIMIT,
        MAX_RANKING_LIMIT,
      );
      return repo.topEventTypes(pool, { from: q.from, to: q.to, limit });
    },
  );

  // -----------------------------------------------------------------
  // I3 · Patrones objetivos
  // -----------------------------------------------------------------

  app.get<{ Querystring: PatternsRangeQuery }>(
    "/insight/patterns/activity",
    { schema: { querystring: patternsRangeQuerySchema } },
    async (request) => {
      const q = request.query;
      return repo.activityPatterns(pool, { from: q.from, to: q.to });
    },
  );

  app.get<{ Querystring: PatternsRangeQuery }>(
    "/insight/patterns/growth",
    { schema: { querystring: patternsRangeQuerySchema } },
    async (request) => {
      const q = request.query;
      // Período previo con la misma duración, contiguo al actual.
      // Se acepta un solape de 1 instante en q.from (los eventos con
      // ts == q.from se contabilizan en ambos) — coste práctico ~0
      // y evita restar 1 ms en el ISO string.
      const fromMs = Date.parse(q.from);
      const toMs = Date.parse(q.to);
      const duration = toMs - fromMs;
      const previousFromMs = fromMs - duration;
      const previousFrom = new Date(previousFromMs).toISOString();
      const previousTo = q.from;
      return repo.growthPatterns(pool, {
        currentFrom: q.from,
        currentTo: q.to,
        previousFrom,
        previousTo,
      });
    },
  );

  app.get<{ Querystring: PatternsPlayersQuery }>(
    "/insight/patterns/players",
    { schema: { querystring: patternsPlayersQuerySchema } },
    async (request) => {
      const q = request.query;
      const minActiveDays = q.minActiveDays
        ? parseInt(q.minActiveDays, 10)
        : DEFAULT_MIN_ACTIVE_DAYS;
      const idleThresholdDays = q.idleThresholdDays
        ? parseInt(q.idleThresholdDays, 10)
        : DEFAULT_IDLE_THRESHOLD_DAYS;
      // Corte de idle = to - idleThresholdDays. Calculado aquí (no
      // en SQL) para que el timestamp resultante viaje en la
      // respuesta y sea auditable.
      const toMs = Date.parse(q.to);
      const idleCutoff = new Date(
        toMs - idleThresholdDays * 86_400_000,
      ).toISOString();
      return repo.playerPatterns(pool, {
        from: q.from,
        to: q.to,
        minActiveDays,
        idleCutoff,
        idleThresholdDays,
      });
    },
  );

  app.get<{ Querystring: PatternsRangeQuery }>(
    "/insight/patterns/streaks",
    { schema: { querystring: patternsRangeQuerySchema } },
    async (request) => {
      const q = request.query;
      return repo.streakPatterns(pool, { from: q.from, to: q.to });
    },
  );

  // -----------------------------------------------------------------
  // I4 · Signals (composición de patrones)
  //
  // Los handlers reutilizan los mismos esquemas AJV de I3
  // (patternsRangeQuerySchema, patternsPlayersQuerySchema) porque
  // las entradas son idénticas — from/to y opcionalmente los
  // umbrales para players. Los signals viven en `insight/signals.ts`;
  // el router sólo cablea.
  // -----------------------------------------------------------------

  app.get<{ Querystring: PatternsRangeQuery }>(
    "/insight/signals/activity",
    { schema: { querystring: patternsRangeQuerySchema } },
    async (request) => {
      const q = request.query;
      return signals.activitySignal(pool, { from: q.from, to: q.to });
    },
  );

  app.get<{ Querystring: PatternsRangeQuery }>(
    "/insight/signals/exploration",
    { schema: { querystring: patternsRangeQuerySchema } },
    async (request) => {
      const q = request.query;
      return signals.explorationSignal(pool, { from: q.from, to: q.to });
    },
  );

  app.get<{ Querystring: PatternsRangeQuery }>(
    "/insight/signals/economy",
    { schema: { querystring: patternsRangeQuerySchema } },
    async (request) => {
      const q = request.query;
      return signals.economySignal(pool, { from: q.from, to: q.to });
    },
  );

  app.get<{ Querystring: PatternsPlayersQuery }>(
    "/insight/signals/players",
    { schema: { querystring: patternsPlayersQuerySchema } },
    async (request) => {
      const q = request.query;
      const minActiveDays = q.minActiveDays
        ? parseInt(q.minActiveDays, 10)
        : undefined;
      const idleThresholdDays = q.idleThresholdDays
        ? parseInt(q.idleThresholdDays, 10)
        : undefined;
      return signals.playersSignal(pool, {
        from: q.from,
        to: q.to,
        minActiveDays,
        idleThresholdDays,
      });
    },
  );
}
