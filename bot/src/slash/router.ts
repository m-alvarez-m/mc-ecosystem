import type { Client, Interaction } from "discord.js";
import type { Logger } from "pino";

// Router de interacciones slash (ADR-016).
//
// Suscribe UN listener a "interactionCreate" del Discord client.
// Cada interacción entrante se despacha a su handler por commandName.
// Comandos desconocidos → warn + reply ephemeral genérico (paranoia
// vs comandos huérfanos que hayan quedado registrados en Discord).

export type SlashHandler = (
  interaction: import("discord.js").ChatInputCommandInteraction,
) => Promise<void>;

export interface SlashRouterOptions {
  client: Client;
  handlers: Record<string, SlashHandler>;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

export function attachSlashRouter(options: SlashRouterOptions): void {
  const { client, handlers, logger } = options;

  client.on("interactionCreate", async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;
    const handler = handlers[name];
    if (!handler) {
      logger.warn({ commandName: name }, "Slash command sin handler registrado");
      try {
        await interaction.reply({
          content: `⚠️ Comando desconocido: /${name}`,
          ephemeral: true,
        });
      } catch (err) {
        logger.error({ err, commandName: name }, "reply a comando desconocido fallo");
      }
      return;
    }
    try {
      await handler(interaction);
      logger.info({ commandName: name }, "Slash command ejecutado");
    } catch (err) {
      logger.error({ err, commandName: name }, "Slash command handler lanzo");
      // Best-effort: si aún no respondimos, avisamos al usuario.
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "⚠️ Error interno ejecutando el comando.",
            ephemeral: true,
          });
        }
      } catch {
        // ignore secondary failure
      }
    }
  });

  logger.info(
    { commands: Object.keys(handlers) },
    "Slash router activo · listeners registrados en interactionCreate",
  );
}
