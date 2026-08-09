import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { eventRoutes } from "./routes/events";
import { playerRoutes } from "./routes/players";
import { insightRoutes } from "./routes/insight";
import { adminRoutes } from "./routes/admin";
import { pool } from "./db";
import { loadPruneConfig } from "./prune/config";
import { createPrunePool } from "./prune/db";
import { createB2Client, type B2Uploader } from "./prune/b2";
import { startScheduler } from "./prune/scheduler";

// ajv-formats habilita los formatos "uuid" y "date-time" del esquema.
// Los tipos de ajv-formats y fastify discrepan; el cast puntual es inocuo.
type AjvPlugin = NonNullable<NonNullable<FastifyServerOptions["ajv"]>["plugins"]>[number];

const app = Fastify({
  logger: true,
  ajv: { plugins: [addFormats as unknown as AjvPlugin] },
});

app.get("/health", async () => ({ status: "ok" }));

// Resource pack del Modo Evento (generado por infra/resourcepack/build-pack.ps1
// y montado read-only). Los clientes de Minecraft lo descargan de aquí.
const PACK_PATH = process.env.RESOURCE_PACK_FILE ?? "/app/resourcepack/pack.zip";
app.get("/pack.zip", async (_request, reply) => {
  const { existsSync, createReadStream } = await import("node:fs");
  if (!existsSync(PACK_PATH)) {
    return reply.code(404).send({ error: "resource pack no generado" });
  }
  return reply.type("application/zip").send(createReadStream(PACK_PATH));
});

app.register(eventRoutes, { pool });
app.register(playerRoutes, { pool });
app.register(insightRoutes, { pool });

// ADR-012 · Retención de events. Se levanta el pool de mc_pruner
// sólo si DATABASE_URL_PRUNE está definida (staging local sin
// credenciales de B2 puede correr la API sin este subsistema).
const pruneCfg = loadPruneConfig();
if (process.env.DATABASE_URL_PRUNE) {
  const prunePool = createPrunePool();
  const b2: B2Uploader | null = pruneCfg.b2 ? createB2Client(pruneCfg.b2) : null;

  app.register(adminRoutes, {
    prunePool,
    b2,
    dryRun: pruneCfg.dryRun,
    retentionMonths: pruneCfg.retentionMonths,
    b2Bucket: pruneCfg.b2?.bucket ?? "",
    b2ArchivePrefix: pruneCfg.b2?.archivePrefix ?? "archive/events",
    adminToken: pruneCfg.adminToken,
  });

  const scheduler = startScheduler({
    pool: prunePool,
    runOptions: {
      dryRun: pruneCfg.dryRun,
      retentionMonths: pruneCfg.retentionMonths,
      b2,
      b2Bucket: pruneCfg.b2?.bucket ?? "",
      b2ArchivePrefix: pruneCfg.b2?.archivePrefix ?? "archive/events",
    },
    onTick: (info) => {
      if (info.ran) {
        app.log.info({ prune: info }, "ADR-012 prune tick fired");
      }
    },
    onError: (err) => app.log.error({ err }, "ADR-012 prune tick error"),
  });

  // Apagado del scheduler junto al pool en el shutdown handler.
  process.once("SIGTERM", () => scheduler.stop());
  process.once("SIGINT", () => scheduler.stop());

  app.log.info(
    { dryRun: pruneCfg.dryRun, retentionMonths: pruneCfg.retentionMonths, b2Enabled: b2 !== null },
    "ADR-012 · scheduler de retención activo"
  );
} else {
  app.log.warn("ADR-012 · DATABASE_URL_PRUNE no definida; scheduler de retención NO activo");
}

app.listen({ port: 3000, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

// Apagado graceful: sin esto, docker stop espera su timeout y mata con
// SIGKILL (exit 137). Se cierran las conexiones HTTP en vuelo y el pool.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} recibido: cerrando ordenadamente`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
