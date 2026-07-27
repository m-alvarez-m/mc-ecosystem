import { createServer, type Server } from "node:http";
import type { Client } from "discord.js";
import type { Logger } from "pino";

// Servidor HTTP minimalista: expone unicamente GET /health.
//
// Health = liveness. El proceso responde 200 cuando (a) esta arriba,
// (b) la config es valida (implicito: si este handler corre, ya se
// cargo) y (c) el cliente Discord esta inicializado y "ready".
//
// La distincion liveness vs readiness (y GET /ready aparte) queda
// pendiente para cuando aparezca caso de uso. En este bootstrap ambos
// conceptos comparten implementacion.

export interface HealthDeps {
  client: Client;
  port: number;
  logger: Logger;
}

export function startHealthServer(deps: HealthDeps): Server {
  const { client, port, logger } = deps;

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const ready = client.isReady();
      const status = ready ? 200 : 503;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: ready ? "ok" : "not-ready" }));
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
