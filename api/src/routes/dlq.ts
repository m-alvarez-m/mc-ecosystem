// Rutas admin de la DLQ (ADR-013 D5 + D7 + D8).
//
//   POST /admin/dlq                    — bot deposita una entrada
//   POST /admin/dlq/replay             — operador dispara reproceso
//   GET  /admin/dlq/pending-count      — bot monitor de saturación (D7)
//
// Todas bajo `ADMIN_DLQ_TOKEN` (variable NUEVA, distinta de
// ADMIN_PRUNE_TOKEN — D8) y sólo por red interna de Docker Compose
// (no se enruta desde cloudflared/playit).
//
// Comparación en tiempo constante para el token: mismo patrón que en
// routes/admin.ts (endpoint de prune del ADR-012).

import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import {
  countPending,
  findPending,
  insertDlqRow,
  markReplayed,
  markReplayFailed,
  type QueryablePool,
} from "../dlq/repository.js";

export interface DlqRoutesDeps {
  dlqPool: QueryablePool;
  adminToken: string | null;
  /**
   * Callback opcional que reproduce una entrada de la DLQ contra el
   * bot. Devuelve `{ ok: true }` si el evento fue publicado con
   * éxito; `{ ok: false, error }` en caso contrario. En este chat
   * no se implementa un cliente real hacia el bot — el
   * hook queda inyectable para pruebas y para que futuras sesiones
   * añadan el forwarding HTTP hacia el bot sin tocar la ruta.
   */
  replayFn?: (row: {
    id: string;
    event_payload: Record<string, unknown>;
  }) => Promise<{ ok: true } | { ok: false; error: string; errorType?: string }>;
}

const insertBodySchema = {
  type: "object",
  required: [
    "event_id",
    "event_uuid",
    "event_type",
    "event_payload",
    "reason",
    "error_type",
    "error_message",
    "attempts",
    "first_failed_at",
    "last_failed_at",
  ],
  properties: {
    event_id: { type: "string", minLength: 1 },
    event_uuid: { type: "string", format: "uuid" },
    event_type: { type: "string", minLength: 1 },
    event_payload: { type: "object" },
    reason: {
      type: "string",
      enum: ["max_retries", "parse_error", "circuit_open", "replay_failed"],
    },
    error_type: { type: "string", minLength: 1 },
    error_message: { type: "string" },
    attempts: { type: "integer", minimum: 1 },
    first_failed_at: { type: "string", format: "date-time" },
    last_failed_at: { type: "string", format: "date-time" },
  },
} as const;

const replayBodySchema = {
  type: "object",
  properties: {
    id: { type: "integer", minimum: 1 },
    reason: {
      type: "string",
      enum: ["max_retries", "parse_error", "circuit_open", "replay_failed"],
    },
  },
} as const;

interface InsertBody {
  event_id: string;
  event_uuid: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  reason: "max_retries" | "parse_error" | "circuit_open" | "replay_failed";
  error_type: string;
  error_message: string;
  attempts: number;
  first_failed_at: string;
  last_failed_at: string;
}

interface ReplayBody {
  id?: number;
  reason?: "max_retries" | "parse_error" | "circuit_open" | "replay_failed";
}

function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf-8");
  const bb = Buffer.from(b, "utf-8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function dlqRoutes(app: FastifyInstance, deps: DlqRoutesDeps) {
  const requireToken = (
    request: { headers: Record<string, string | string[] | undefined> },
    reply: {
      code: (n: number) => { send: (body: unknown) => unknown };
    },
  ): boolean => {
    if (deps.adminToken === null) {
      reply.code(503).send({ error: "ADMIN_DLQ_TOKEN no configurado" });
      return false;
    }
    const provided = request.headers["x-admin-token"];
    if (typeof provided !== "string" || !tokensEqual(provided, deps.adminToken)) {
      reply.code(401).send({ error: "token inválido" });
      return false;
    }
    return true;
  };

  app.post<{ Body: InsertBody }>(
    "/admin/dlq",
    { schema: { body: insertBodySchema } },
    async (request, reply) => {
      if (!requireToken(request, reply)) return reply;
      const b = request.body;
      const { inserted, id } = await insertDlqRow(deps.dlqPool, b);
      return reply.code(201).send({ inserted, id });
    },
  );

  app.get("/admin/dlq/pending-count", async (request, reply) => {
    if (!requireToken(request, reply)) return reply;
    const n = await countPending(deps.dlqPool);
    return reply.code(200).send({ pending: n });
  });

  app.post<{ Body: ReplayBody }>(
    "/admin/dlq/replay",
    { schema: { body: replayBodySchema } },
    async (request, reply) => {
      if (!requireToken(request, reply)) return reply;
      const rows = await findPending(deps.dlqPool, {
        id: request.body?.id,
        reason: request.body?.reason,
      });

      // Sin replayFn cableado: la ruta se limita a REPORTAR qué se
      // reprocesaría, sin ejecutar. Deliberado: el forwarding real
      // al bot vive en una sesión posterior; el endpoint está
      // listo, autenticado y con el shape correcto.
      if (deps.replayFn === undefined) {
        return reply.code(200).send({
          replayed: 0,
          still_failing: [],
          candidates: rows.map((r) => ({
            id: r.id,
            event_uuid: r.event_uuid,
            reason: r.reason,
          })),
          note: "replayFn no configurado — sólo se listaron candidatos",
        });
      }

      const stillFailing: Array<{
        id: string;
        error_type?: string;
        error_message: string;
      }> = [];
      let replayed = 0;
      for (const row of rows) {
        const result = await deps.replayFn({
          id: row.id,
          event_payload: row.event_payload,
        });
        if (result.ok) {
          await markReplayed(deps.dlqPool, row.id);
          replayed++;
        } else {
          await markReplayFailed(deps.dlqPool, row.id, result.error);
          stillFailing.push({
            id: row.id,
            error_type: result.errorType,
            error_message: result.error,
          });
        }
      }
      return reply.code(200).send({ replayed, still_failing: stillFailing });
    },
  );
}
