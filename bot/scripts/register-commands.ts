import "dotenv/config";
import { REST, Routes } from "discord.js";
import { SLASH_COMMANDS, COMMAND_NAMES } from "../src/slash/commands";

// Script de registro de slash commands por-guild (ADR-016 D2).
//
// Diseño:
//   - Fail-fast: valida DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID,
//     DISCORD_GUILD_ID antes de tocar Discord.
//   - Log de evidencia: nombres a publicar, IDs devueltos por
//     Discord, antes/después del count.
//   - Idempotente: PUT reemplaza la lista completa. Ejecuciones
//     repetidas no acumulan comandos duplicados.
//
// Uso operativo:
//   cd bot && npm run register-commands
//
// Prerequisitos:
//   bot/.env debe contener las 3 vars requeridas (ver runbook
//   sección "Slash commands (B.1 · ADR-016)").

interface DiscordCommandSummary {
  id: string;
  name: string;
}

async function main(): Promise<void> {
  const missing: string[] = [];
  for (const v of ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"]) {
    const raw = process.env[v];
    if (raw === undefined || raw.trim().length === 0) missing.push(v);
  }
  if (missing.length > 0) {
    console.error(
      `[register-commands] FAIL fail-fast · variables faltantes en bot/.env: ${missing.join(", ")}`,
    );
    console.error(
      "[register-commands] cero llamadas a Discord con configuración parcial (ADR-016 D2)",
    );
    process.exit(1);
  }

  const token = process.env.DISCORD_BOT_TOKEN!;
  const applicationId = process.env.DISCORD_CLIENT_ID!;
  const guildId = process.env.DISCORD_GUILD_ID!;

  const rest = new REST({ version: "10" }).setToken(token);

  // ANTES: cuántos comandos hay ahora en el guild.
  let before: DiscordCommandSummary[];
  try {
    before = (await rest.get(
      Routes.applicationGuildCommands(applicationId, guildId),
    )) as DiscordCommandSummary[];
  } catch (err) {
    console.error(
      "[register-commands] FAIL al leer estado actual del guild:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }
  console.log(`[register-commands] guild=${guildId} · antes: ${before.length} comandos`);
  console.log(`[register-commands] publicando: ${COMMAND_NAMES.join(", ")}`);

  // PUT reemplaza la lista completa. Idempotente.
  let after: DiscordCommandSummary[];
  try {
    after = (await rest.put(
      Routes.applicationGuildCommands(applicationId, guildId),
      { body: SLASH_COMMANDS },
    )) as DiscordCommandSummary[];
  } catch (err) {
    console.error(
      "[register-commands] FAIL al publicar comandos:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }

  console.log(
    `[register-commands] PUT /applications/${applicationId}/guilds/${guildId}/commands → 200 OK`,
  );
  console.log(`[register-commands] después: ${after.length} comandos`);
  for (const cmd of after) {
    console.log(`[register-commands]   ${cmd.name.padEnd(8)} → id=${cmd.id}`);
  }
}

main().catch((err) => {
  console.error("[register-commands] error no capturado:", err);
  process.exit(1);
});
