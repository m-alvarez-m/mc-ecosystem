import Fastify from "fastify";
import addFormats from "ajv-formats";
import { eventRoutes } from "./routes/events";

const app = Fastify({
  logger: true,
  // ajv-formats habilita los formatos "uuid" y "date-time" del esquema.
  ajv: { plugins: [addFormats] },
});

app.get("/health", async () => ({ status: "ok" }));

app.register(eventRoutes);

app.listen({ port: 3000, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
