import { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";

// Dependencias inyectables de las rutas de eventos.
//
// `Pick<Pool, "query" | "connect">`: la ruta ejecuta queries directos
// (path por defecto) y adquiere un client dedicado para el path
// transaccional de session.start con identidad. Aceptar el subset
// minimo permite que los tests pasen un fake que implemente solo lo
// que se usa sin fingir el resto de la superficie del pool (end, on,
// etc.).
//
// No hay adapter, gateway ni repositorio: la ruta sigue hablando con
// `pool.query(...)` / `pool.connect().query(...)` directamente, solo
// cambia de donde llega la referencia (import global → parametro).
export interface EventRoutesDeps {
  pool: Pick<Pool, "query" | "connect">;
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

// SQL comun para el INSERT de un evento. Se usa igual en el path plain
// y dentro del path transaccional; centralizarlo evita divergencias.
const INSERT_EVENT_SQL = `INSERT INTO events (event_uuid, type, v, ts, player_uuid, world, x, y, z, data)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
   RETURNING id, received_at`;

function insertEventParams(b: EventBody): unknown[] {
  return [
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
  ];
}

// Detecta si el POST debe activar el path transaccional de identidad.
// Sólo aplica a session.start con player_uuid string presente y
// data.name string no vacío (tras trim). Cualquier otro caso — incluidos
// otros tipos, session.start sin data.name, name vacío, name no-string —
// cae al path plain (INSERT directo en events, sin transacción).
function extractIdentity(b: EventBody): { uuid: string; name: string } | null {
  if (b.type !== "session.start") return null;
  if (typeof b.player_uuid !== "string" || b.player_uuid.length === 0) return null;
  const rawName = b.data?.["name"];
  if (typeof rawName !== "string") return null;
  const name = rawName.trim();
  if (name.length === 0) return null;
  return { uuid: b.player_uuid, name };
}

export async function eventRoutes(app: FastifyInstance, deps: EventRoutesDeps) {
  const { pool } = deps;

  app.post<{ Body: EventBody }>(
    "/events",
    { schema: { body: eventBodySchema } },
    async (request, reply) => {
      const b = request.body;
      const identity = extractIdentity(b);
      if (identity !== null) {
        return insertSessionStartWithIdentity(pool, reply, b, identity);
      }
      return insertPlainEvent(pool, reply, b);
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

// Path transaccional: session.start con identidad válida.
//
// Secuencia dentro de BEGIN/COMMIT:
//   1) SELECT del nombre previo (o null si es jugador nuevo).
//   2) UPSERT en players — inserta con first_seen/last_seen=now para
//      nuevos, o actualiza name/last_seen para existentes.
//   3) INSERT en player_names si es nuevo (previousName null) o si el
//      nombre efectivamente cambió. La historia sólo crece con
//      transiciones reales.
//   4) INSERT en events (mismo SQL que el path plain).
//   5) COMMIT.
//
// Ante cualquier error dentro del bloque:
//   - ROLLBACK (best-effort; su propio fallo se ignora — el error
//     original ya está capturado).
//   - Si el error es 23505 sobre event_uuid, responde 409 (idempotencia
//     del reintento del plugin: nada persiste porque todo se
//     rollbackea, incluidos UPSERT y player_names).
//   - Cualquier otro error se propaga a Fastify (500 default).
//
// El client se libera SIEMPRE en el finally.
async function insertSessionStartWithIdentity(
  pool: Pick<Pool, "connect">,
  reply: FastifyReply,
  b: EventBody,
  identity: { uuid: string; name: string }
): Promise<FastifyReply> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const prev = await client.query<{ name: string }>(
      "SELECT name FROM players WHERE uuid = $1",
      [identity.uuid]
    );
    const previousName = prev.rows[0]?.name ?? null;

    await client.query(
      `INSERT INTO players (uuid, name, first_seen, last_seen)
       VALUES ($1, $2, now(), now())
       ON CONFLICT (uuid) DO UPDATE
         SET name = EXCLUDED.name,
             last_seen = EXCLUDED.last_seen`,
      [identity.uuid, identity.name]
    );

    if (previousName !== identity.name) {
      await client.query(
        `INSERT INTO player_names (player_uuid, name, seen_at)
         VALUES ($1, $2, now())`,
        [identity.uuid, identity.name]
      );
    }

    const result = await client.query(INSERT_EVENT_SQL, insertEventParams(b));

    await client.query("COMMIT");
    return reply
      .code(201)
      .send({ id: result.rows[0].id, received_at: result.rows[0].received_at });
  } catch (err: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((err as { code?: string }).code === "23505") {
      return reply.code(409).send({ error: "event_uuid ya registrado" });
    }
    throw err;
  } finally {
    client.release();
  }
}

// Path plain: INSERT directo en events sin transacción. Aplicable a
// todos los tipos que no llevan payload de identidad, y a session.start
// sin data.name (compatibilidad backward con eventos anteriores al
// deploy de la emisión de data.name en el plugin).
async function insertPlainEvent(
  pool: Pick<Pool, "query">,
  reply: FastifyReply,
  b: EventBody
): Promise<FastifyReply> {
  try {
    const result = await pool.query(INSERT_EVENT_SQL, insertEventParams(b));
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
