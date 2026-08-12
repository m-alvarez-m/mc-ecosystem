import { SlashCommandBuilder } from "discord.js";

// Definiciones de los 3 slash commands de B.1 (ADR-016).
//
// Fuente única de verdad para:
//   1) el script `register-commands` (envía estos objetos a Discord)
//   2) el router en runtime (mapea `interaction.commandName` a handler)
//   3) los tests del builder (verifican nombres/descripciones exactos)
//
// Sin opciones: los 3 comandos son sin parámetros (ADR-016 · Fuera
// de alcance B.1). Añadir opciones futuras entra por su propio ADR.

export const SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName("players")
    .setDescription("Lista de jugadores actualmente online, ordenados por tiempo de sesión.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("tps")
    .setDescription("TPS del último minuto del server (con guardia de freshness).")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Salud consolidada del ecosistema (server + pipeline + bot).")
    .toJSON(),
] as const;

export const COMMAND_NAMES = SLASH_COMMANDS.map((c) => c.name);
