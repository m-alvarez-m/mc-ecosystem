import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { eventRoutes } from "./routes/events";

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
