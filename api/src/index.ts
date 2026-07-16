import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { eventRoutes } from "./routes/events";
import { pool } from "./db";

// ajv-formats habilita los formatos "uuid" y "date-time" del esquema.
// Los tipos de ajv-formats y fastify discrepan; el cast puntual es inocuo.
type AjvPlugin = NonNullable<NonNullable<FastifyServerOptions["ajv"]>["plugins"]>[number];

const app = Fastify({
  logger: true,
  ajv: { plugins: [addFormats as unknown as AjvPlugin] },
});

app.get("/health", async () => ({ status: "ok" }));

app.register(eventRoutes);

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
