import type { Client } from "discord.js";
import type { Server } from "node:http";
import type { Logger } from "pino";

// Cierre limpio ante SIGINT / SIGTERM.
//
// Secuencia: destruir cliente Discord -> cerrar HTTP server -> exit(0).
// Si el shutdown graceful excede timeoutMs, forzamos exit(1). Sin ese
// timeout, un handshake Discord colgado bloquearia el proceso y docker
// tendria que matarlo con SIGKILL (exit 137).

export interface ShutdownDeps {
  client: Client;
  server: Server;
  logger: Logger;
  timeoutMs?: number;
}

export function registerShutdownHandlers(deps: ShutdownDeps): void {
  const { client, server, logger, timeoutMs = 10_000 } = deps;

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Senal recibida, cerrando ordenadamente");

    const forceExit = setTimeout(() => {
      logger.warn({ timeoutMs }, "Timeout de shutdown, forzando exit(1)");
      process.exit(1);
    }, timeoutMs);
    forceExit.unref();

    try {
      // client.destroy() puede ser void (v14.14-) o Promise<void> (v14.15+).
      // await sobre void resuelve a undefined sin error.
      await client.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
      logger.info("Shutdown limpio completado");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error durante shutdown");
      process.exit(1);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
