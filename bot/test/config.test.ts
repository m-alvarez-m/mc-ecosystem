import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config/env";

// Tests unitarios del cargador de config.
// La fuente de datos es process.env; snapshot + restore para no
// contaminar entre tests ni entre ejecuciones locales.

const ALL_VARS = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_GUILD_ID",
  "DISCORD_EVENTS_CHANNEL_ID",
  "PORT",
  "API_BASE_URL",
  "HTTP_TIMEOUT_MS",
  "CURSOR_FILE",
  "POLL_INTERVAL_MS",
  "TPS_ALERT_THRESHOLD",
] as const;

function setBaseValid(): void {
  process.env.DISCORD_BOT_TOKEN = "fake-token";
  process.env.DISCORD_GUILD_ID = "123456789012345678";
  process.env.DISCORD_EVENTS_CHANNEL_ID = "987654321098765432";
  process.env.PORT = "4000";
  process.env.API_BASE_URL = "http://api:3000";
  process.env.CURSOR_FILE = "/var/lib/pulso/cursor.json";
  process.env.POLL_INTERVAL_MS = "5000";
}

describe("loadConfig", () => {
  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
    for (const k of ALL_VARS) {
      delete process.env[k];
    }
  });

  afterEach(() => {
    process.env = saved;
  });

  it("acepta configuracion completa y valida", () => {
    setBaseValid();

    const config = loadConfig();
    expect(config.discord.token).toBe("fake-token");
    expect(config.discord.guildId).toBe("123456789012345678");
    expect(config.discord.eventsChannelId).toBe("987654321098765432");
    expect(config.server.port).toBe(4000);
    expect(config.eventStore.baseUrl).toBe("http://api:3000");
    // HTTP_TIMEOUT_MS ausente -> default 10 s.
    expect(config.eventStore.timeoutMs).toBe(10_000);
    expect(config.cursor.filePath).toBe("/var/lib/pulso/cursor.json");
    expect(config.polling.intervalMs).toBe(5000);
    // TPS_ALERT_THRESHOLD ausente -> default 18.
    expect(config.tps.alertThreshold).toBe(18);
  });

  it("acepta HTTP_TIMEOUT_MS custom cuando es entero positivo", () => {
    setBaseValid();
    process.env.HTTP_TIMEOUT_MS = "30000";

    const config = loadConfig();
    expect(config.eventStore.timeoutMs).toBe(30_000);
  });

  it("aborta con mensaje claro cuando falta una variable requerida", () => {
    setBaseValid();
    delete process.env.DISCORD_BOT_TOKEN;

    expect(() => loadConfig()).toThrow(/DISCORD_BOT_TOKEN/);
  });

  it("aborta cuando una variable esta vacia", () => {
    setBaseValid();
    process.env.DISCORD_BOT_TOKEN = "   ";

    expect(() => loadConfig()).toThrow(/DISCORD_BOT_TOKEN/);
  });

  it("aborta cuando PORT no es un entero valido", () => {
    setBaseValid();
    process.env.PORT = "no-es-numero";

    expect(() => loadConfig()).toThrow(/PORT invalido/);
  });

  it("aborta cuando PORT esta fuera de rango", () => {
    setBaseValid();
    process.env.PORT = "99999";

    expect(() => loadConfig()).toThrow(/PORT invalido/);
  });

  it("aborta cuando API_BASE_URL no es URL valida", () => {
    setBaseValid();
    process.env.API_BASE_URL = "no es una url";

    expect(() => loadConfig()).toThrow(/API_BASE_URL invalida/);
  });

  it("aborta cuando HTTP_TIMEOUT_MS no es entero positivo", () => {
    setBaseValid();
    process.env.HTTP_TIMEOUT_MS = "-1";

    expect(() => loadConfig()).toThrow(/HTTP_TIMEOUT_MS invalido/);
  });

  it("aborta cuando POLL_INTERVAL_MS no es entero positivo", () => {
    setBaseValid();
    process.env.POLL_INTERVAL_MS = "0";

    expect(() => loadConfig()).toThrow(/POLL_INTERVAL_MS invalido/);
  });

  it("acepta TPS_ALERT_THRESHOLD custom (entero)", () => {
    setBaseValid();
    process.env.TPS_ALERT_THRESHOLD = "15";

    const config = loadConfig();
    expect(config.tps.alertThreshold).toBe(15);
  });

  it("acepta TPS_ALERT_THRESHOLD custom (decimal)", () => {
    setBaseValid();
    process.env.TPS_ALERT_THRESHOLD = "17.5";

    const config = loadConfig();
    expect(config.tps.alertThreshold).toBe(17.5);
  });

  it("aborta cuando TPS_ALERT_THRESHOLD no es numero finito positivo", () => {
    setBaseValid();
    process.env.TPS_ALERT_THRESHOLD = "no-es-numero";

    expect(() => loadConfig()).toThrow(/TPS_ALERT_THRESHOLD invalido/);
  });

  it("aborta cuando TPS_ALERT_THRESHOLD es cero o negativo", () => {
    setBaseValid();
    process.env.TPS_ALERT_THRESHOLD = "0";
    expect(() => loadConfig()).toThrow(/TPS_ALERT_THRESHOLD invalido/);

    process.env.TPS_ALERT_THRESHOLD = "-5";
    expect(() => loadConfig()).toThrow(/TPS_ALERT_THRESHOLD invalido/);
  });
});
