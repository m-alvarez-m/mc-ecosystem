import { createServer, type Server } from "node:http";
import type { Client } from "discord.js";
import type { Logger } from "pino";
import type { RuntimeState } from "../observability";

// Servidor HTTP minimalista: expone unicamente GET /health.
//
// Contrato de respuesta (T7 v1.1):
//   {
//     "status": "ok" | "not-ready",
//     "runtime": RuntimeSnapshot
//   }
//
// - `status` refleja la conectividad Discord: "ok" si client.isReady(),
//   "not-ready" en caso contrario. HTTP 200 vs 503 respectivamente.
// - `runtime` es EXACTAMENTE `runtimeState.snapshot()` — el health
//   server no reconstruye informacion ni recalcula metricas. Es una
//   pura capa de exposicion. Toda la instrumentacion la genera T5.
//
// La distincion liveness vs readiness (y GET /ready aparte) queda
// pendiente para cuando aparezca caso de uso. En este bootstrap ambos
// conceptos comparten implementacion.

export interface HealthDeps {
  client: Client;
  port: number;
  logger: Logger;
  runtimeState: RuntimeState;
}

export function startHealthServer(deps: HealthDeps): Server {
  const { client, port, logger, runtimeState } = deps;

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const ready = client.isReady();
      const httpStatus = ready ? 200 : 503;
      const body = {
        status: ready ? "ok" : "not-ready",
        runtime: runtimeState.snapshot(),
      };
      res.writeHead(httpStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "Servidor health escuchando");
  });

  return server;
}
