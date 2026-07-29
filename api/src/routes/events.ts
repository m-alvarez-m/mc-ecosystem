import { FastifyInstance } from "fastify";
import type { Pool } from "pg";

// Dependencias inyectables de las rutas de eventos.
//
// Se toma `Pick<Pool, "query">` en lugar del `Pool` completo: la ruta
// solo necesita ejecutar queries, y aceptar el subset minimo permite
// que los tests pasen un fake que implemente solo `query` sin fingir
// el resto de la superficie del pool (connect, end, on, etc.).
//
// No hay adapter, gateway ni repositorio: la ruta sigue hablando con
// `pool.query(...)` directamente, solo cambia de donde llega la
// referencia (import global → parametro).
export interface EventRoutesDeps {
  pool: Pick<Pool, "query">;
}

// Esquema del body de POST /events según docs/event-catalog.md (campos
// comunes v1). Fastify valida contra esto ANTES de ejecutar el handler:
// si falta un campo requerido o un tipo no cuadra, responde 400
// automáticamente.
const eventBodySchema = {
  type: "object",
  required: ["event_uuid", "type", "v", "ts"],
  additionalProperties: false,
  properties: {
    event_uuid: { type: "string", format: "uuid" },
    type: { type: "string", minLength: 1 },
    v: { type: "integer", minimum: 1 },
    ts: { type: "string", format: "date-time" },
    player_uuid: { type: ["string", "null"], format: "uuid" },
    world: { type: ["string", "null"] },
    x: { type: ["integer", "null"] },
    y: { type: ["integer", "null"] },
    z: { type: ["integer", "null"] },
    data: { type: "object" },
  },
} as const;

interface EventBody {
  event_uuid: string;
  type: string;
  v: number;
  ts: string;
  player_uuid?: string | null;
  world?: string | null;
  x?: number | null;
  y?: number | null;
  z?: number | null;
  data?: Record<string, unknown>;
}

// Esquema de query de GET /events. Fastify entrega los query params
// como string, por eso `limit` se valida como string numerico y se
// parsea en el handler (evita configurar coerceTypes global y afectar
// la validacion estricta del body de POST).
const getEventsQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    after_id: { type: "string", pattern: "^\\d+$" },
    limit: { type: "string", pattern: "^[1-9]\\d*$" },
    types: { type: "string", minLength: 1 },
  },
} as const;

interface GetEventsQuery {
  after_id?: string;
  limit?: string;
  types?: string;
}

// Limite duro server-side. Si un cliente pide mas, se sirve MAX_LIMIT
// sin error (clamp): la api decide su tope, el cliente sugiere.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function eventRoutes(app: FastifyInstance, deps: EventRoutesDeps) {
  const { pool } = deps;

  app.post<{ Body: EventBody }>(
    "/events",
    { schema: { body: eventBodySchema } },
    async (request, reply) => {
      const b = request.body;
      try {
        const result = await pool.query(
          `INSERT INTO events (event_uuid, type, v, ts, player_uuid, world, x, y, z, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, received_at`,
          [
            b.event_uuid,
            b.type,
            b.v,
            b.ts,
            b.player_uuid ?? null,
            b.world ?? null,
            b.x ?? null,
            b.y ?? null,
            b.z ?? null,
            JSON.stringify(b.data ?? {}),
          ]
        );
        return reply
          .code(201)
          .send({ id: result.rows[0].id, received_at: result.rows[0].received_at });
      } catch (err: unknown) {
        // 23505 = unique_violation sobre ux_events_uuid: el evento ya existe.
        // Reintento idempotente del plugin, no un error del servidor.
        if ((err as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "event_uuid ya registrado" });
        }
        throw err;
      }
    }
  );

  app.get<{ Querystring: GetEventsQuery }>(
    "/events",
    { schema: { querystring: getEventsQuerySchema } },
    async (request) => {
      const q = request.query;

      // Defaults documentados en ADR-010: sin cursor = desde el inicio;
      // sin limit = 100; sin types = sin filtro.
      const afterId = q.after_id ?? "0";
      const limit = Math.min(q.limit ? parseInt(q.limit, 10) : DEFAULT_LIMIT, MAX_LIMIT);
      const types = q.types
        ? q.types.split(",").map((t) => t.trim()).filter((t) => t.length > 0)
        : [];
      const typesFilter = types.length > 0 ? types : null;

      // `id::text` blinda la serializacion como string: BIGINT excede el
      // rango seguro de Number (2^53). El bot espera string por contrato.
      const result = await pool.query(
        `SELECT
           id::text AS id,
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
         WHERE id > $1::bigint
           AND ($2::text[] IS NULL OR type = ANY($2::text[]))
         ORDER BY id ASC
         LIMIT $3::int`,
        [afterId, typesFilter, limit]
      );

      const events = result.rows;
      const lastId = events.length > 0 ? events[events.length - 1].id : null;

      return { events, last_id: lastId };
    }
  );
}
