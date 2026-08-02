import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { eventRoutes } from "./routes/events";
import { playerRoutes } from "./routes/players";
import { insightRoutes } from "./routes/insight";
import { pool } from "./db";

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
