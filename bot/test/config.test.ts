import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config/env";

// Tests unitarios del cargador de config.
// La fuente de datos es process.env; snapshot + restore para no
// contaminar entre tests ni entre ejecuciones locales.

describe("loadConfig", () => {
  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
    for (const k of [
      "DISCORD_BOT_TOKEN",
      "DISCORD_GUILD_ID",
      "DISCORD_EVENTS_CHANNEL_ID",
      "PORT",
    ]) {
      delete process.env[k];
    }
  });

  afterEach(() => {
    process.env = saved;
  });

  it("acepta configuracion completa y valida", () => {
    process.env.DISCORD_BOT_TOKEN = "fake-token";
    process.env.DISCORD_GUILD_ID = "123456789012345678";
    process.env.DISCORD_EVENTS_CHANNEL_ID = "987654321098765432";
    process.env.PORT = "4000";

    const config = loadConfig();
    expect(config.discord.token).toBe("fake-token");
    expect(config.discord.guildId).toBe("123456789012345678");
    expect(config.discord.eventsChannelId).toBe("987654321098765432");
    expect(config.server.port).toBe(4000);
  });

  it("aborta con mensaje claro cuando falta una variable requerida", () => {
    process.env.DISCORD_GUILD_ID = "g";
    process.env.DISCORD_EVENTS_CHANNEL_ID = "c";
    process.env.PORT = "4000";
    // DISCORD_BOT_TOKEN ausente

    expect(() => loadConfig()).toThrow(/DISCORD_BOT_TOKEN/);
  });

  it("aborta cuando una variable esta vacia", () => {
    process.env.DISCORD_BOT_TOKEN = "   ";
    process.env.DISCORD_GUILD_ID = "g";
    process.env.DISCORD_EVENTS_CHANNEL_ID = "c";
    process.env.PORT = "4000";

    expect(() => loadConfig()).toThrow(/DISCORD_BOT_TOKEN/);
  });

  it("aborta cuando PORT no es un entero valido", () => {
    process.env.DISCORD_BOT_TOKEN = "t";
    process.env.DISCORD_GUILD_ID = "g";
    process.env.DISCORD_EVENTS_CHANNEL_ID = "c";
    process.env.PORT = "no-es-numero";

    expect(() => loadConfig()).toThrow(/PORT invalido/);
  });

  it("aborta cuando PORT esta fuera de rango", () => {
    process.env.DISCORD_BOT_TOKEN = "t";
    process.env.DISCORD_GUILD_ID = "g";
    process.env.DISCORD_EVENTS_CHANNEL_ID = "c";
    process.env.PORT = "99999";

    expect(() => loadConfig()).toThrow(/PORT invalido/);
  });
});
