import { FastifyInstance } from "fastify";
import { pool } from "../db";

// Esquema del body según docs/event-catalog.md (campos comunes v1).
// Fastify valida contra esto ANTES de ejecutar el handler: si falta un
// campo requerido o un tipo no cuadra, responde 400 automáticamente.
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

export async function eventRoutes(app: FastifyInstance) {
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
}
