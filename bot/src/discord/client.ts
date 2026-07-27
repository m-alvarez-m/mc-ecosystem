import { Client, GatewayIntentBits } from "discord.js";
import type { Logger } from "pino";

// Cliente Discord del bot Pulso (bootstrap v1.1).
//
// Intents: SOLO Guilds (no-privilegiado). En esta version el bot no
// lee mensajes, no ve presencia, no consulta miembros. Cuando llegue
// chat bridge (v1.2+) tocara revisar intents y probablemente activar
// MESSAGE CONTENT en el Portal.
//
// No se registran otros listeners aqui: los del Gateway relacionados
// con eventos (mensajes, comandos, interacciones) llegan en sesiones
// posteriores segun el roadmap de Pulso.

export function createDiscordClient(logger: Logger): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once("ready", (readyClient) => {
    logger.info({ user: readyClient.user.tag }, "Discord conectado y listo");
  });

  client.on("error", (err) => {
    logger.error({ err }, "Error del cliente Discord");
  });

  return client;
}
