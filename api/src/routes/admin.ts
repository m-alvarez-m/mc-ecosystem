// POST /admin/events/prune — endpoint on-demand del ADR-012 D3.
//
// Contrato:
//   - Header X-Admin-Token debe coincidir con ADMIN_PRUNE_TOKEN
//     (comparación en tiempo constante para no filtrar longitud).
//   - Body opcional `{ "period": "YYYY-MM" }` para forzar un mes.
//     Sin body → recorre todos los meses vencidos.
//   - Responde 200 con el array de PruneMonthResult.
//   - Sin token configurado: 503 (endpoint deshabilitado — nunca
//     "abrir por ausencia de config").
//
// La exposición pública se corta a nivel de compose (sin publicar
// puerto adicional; el 3000 sí está publicado pero no hay reverse
// proxy que enrute /admin/*; el operador invoca desde otro contenedor
// de la misma red interna).

import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { B2Uploader } from "../prune/b2.js";
import type { PrunePool } from "../prune/prune.js";
import { runPrune } from "../prune/prune.js";

export interface AdminRoutesDeps {
  prunePool: PrunePool;
  b2: B2Uploader | null;
  dryRun: boolean;
  retentionMonths: number;
  b2Bucket: string;
  b2ArchivePrefix: string;
  adminToken: string | null;
  now?: () => Date;
}

const bodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    period: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" },
  },
} as const;

interface PruneBody {
  period?: string;
}

// Comparación en tiempo constante. Diferencia de longitud rechaza al
// entrar (timingSafeEqual exige igual length; ese chequeo es O(1) y
// no filtra el valor comparado).
function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf-8");
  const bb = Buffer.from(b, "utf-8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function adminRoutes(app: FastifyInstance, deps: AdminRoutesDeps) {
  app.post<{ Body: PruneBody }>(
    "/admin/events/prune",
    { schema: { body: bodySchema } },
    async (request, reply) => {
      if (deps.adminToken === null) {
        return reply.code(503).send({ error: "ADMIN_PRUNE_TOKEN no configurado" });
      }
      const provided = request.headers["x-admin-token"];
      if (typeof provided !== "string" || !tokensEqual(provided, deps.adminToken)) {
        return reply.code(401).send({ error: "token inválido" });
      }

      const results = await runPrune(deps.prunePool, {
        now: deps.now?.() ?? new Date(),
        retentionMonths: deps.retentionMonths,
        period: request.body?.period,
        dryRun: deps.dryRun,
        b2: deps.b2,
        b2Bucket: deps.b2Bucket,
        b2ArchivePrefix: deps.b2ArchivePrefix,
      });
      return reply.code(200).send({ dry_run: deps.dryRun, results });
    }
  );
}
