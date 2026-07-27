import pino from "pino";
import { loadConfig } from "./config/env";
import { createDiscordClient } from "./discord/client";
import { startHealthServer } from "./health/server";
import { registerShutdownHandlers } from "./lifecycle/shutdown";

// Bootstrap del servicio Pulso (v1.1).
//
// Alcance de esta version: el servicio arranca, valida config, se
// conecta a Discord, expone /health y espera senales. NO consume
// eventos, NO postea mensajes, NO registra slash commands, NO hace
// polling. La logica de negocio (polling con cursor por id, ver
// ADR-010) llega en sesiones posteriores del roadmap Pulso.
//
// Referencias:
// - ADR-008: Node.js + TypeScript + discord.js v14
// - ADR-009: api HTTP como superficie unica de la DB
// - ADR-010: consumo del Event Store con cursor por id

const logger = pino({ name: "pulso" });

async function main(): Promise<void> {
  logger.info("Inicio del bot Pulso");

  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
    logger.info("Configuracion valida");
  } catch (err) {
    logger.fatal({ err }, "Configuracion invalida, abortando");
    process.exit(1);
  }

  const client = createDiscordClient(logger);
  const server = startHealthServer({ client, port: config.server.port, logger });

  registerShutdownHandlers({ client, server, logger });

  logger.info("Iniciando login a Discord");
  try {
    await client.login(config.discord.token);
    // El "ready" se loguea desde createDiscordClient. login() solo
    // confirma que el token fue aceptado y la conexion arranco.
  } catch (err) {
    logger.fatal({ err }, "Fallo el login a Discord");
    process.exit(1);
  }
}

void main();
