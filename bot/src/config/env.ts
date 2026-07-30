import "dotenv/config";

// Configuracion del bot Pulso (v1.1).
//
// Contrato: fallar rapido y ruidoso si falta cualquier variable
// requerida. Sin fallbacks silenciosos. Sin lecturas desde otros
// sitios: solo variables de entorno. Los secretos vienen del .env
// local (dev) o inyectados por Docker Compose desde infra/.env (deploy).

export interface Config {
  discord: {
    token: string;
    guildId: string;
    eventsChannelId: string;
  };
  server: {
    port: number;
  };
  eventStore: {
    baseUrl: string;
    timeoutMs: number;
  };
  cursor: {
    filePath: string;
  };
  polling: {
    intervalMs: number;
  };
  tps: {
    /**
     * Umbral por debajo del cual TpsHandler emite alerta de
     * degradacion. TPS >= umbral -> silencio (evita 1440 mensajes/dia
     * de samples sanos). TPS < umbral -> se publica.
     * Default: 18 (vanilla objetivo = 20; margen razonable de tolerancia).
     */
    alertThreshold: number;
  };
}

interface RequiredVar {
  key: string;
  description: string;
}

const REQUIRED: RequiredVar[] = [
  { key: "DISCORD_BOT_TOKEN", description: "Token del bot (Discord Developer Portal)" },
  { key: "DISCORD_GUILD_ID", description: "ID numerico del servidor Discord destino" },
  { key: "DISCORD_EVENTS_CHANNEL_ID", description: "ID del canal donde el bot publica" },
  { key: "PORT", description: "Puerto HTTP para el endpoint /health" },
  { key: "API_BASE_URL", description: "URL base de la api del Event Store (p.ej. http://api:3000)" },
  { key: "CURSOR_FILE", description: "Ruta al archivo JSON de persistencia del cursor" },
  { key: "POLL_INTERVAL_MS", description: "Intervalo entre iteraciones del polling engine (entero positivo, en ms)" },
];

// Default 10 s: cubre latencia local (compose network, sub-milisegundo)
// mas margen amplio para picos. El consumidor puede subirlo si en el
// futuro se hace long-polling con timeouts >30s.
const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

// Default 18: vanilla objetivo = 20 TPS; ~10% de tolerancia. Debajo,
// se considera degradacion y TpsHandler emite alerta. Aceptamos
// decimales para umbrales finos (17.5, 15.8, etc.).
const DEFAULT_TPS_ALERT_THRESHOLD = 18;

export function loadConfig(): Config {
  const missing: string[] = [];
  for (const v of REQUIRED) {
    const value = process.env[v.key];
    if (value === undefined || value.trim().length === 0) {
      missing.push(`  - ${v.key}  (${v.description})`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      "Variables de entorno faltantes o vacias:\n" +
        missing.join("\n") +
        "\n\nDefinelas en bot/.env (dev) o en infra/.env (deploy).",
    );
  }

  const rawPort = process.env.PORT!;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT invalido: "${rawPort}" (debe ser entero 1-65535)`);
  }

  const rawBaseUrl = process.env.API_BASE_URL!;
  try {
    // Validacion cruda: si no parsea como URL, no vale.
    new URL(rawBaseUrl);
  } catch {
    throw new Error(`API_BASE_URL invalida: "${rawBaseUrl}" (debe ser URL bien formada)`);
  }

  const rawTimeout = process.env.HTTP_TIMEOUT_MS;
  let timeoutMs = DEFAULT_HTTP_TIMEOUT_MS;
  if (rawTimeout !== undefined && rawTimeout.trim().length > 0) {
    const parsed = Number(rawTimeout);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`HTTP_TIMEOUT_MS invalido: "${rawTimeout}" (debe ser entero positivo)`);
    }
    timeoutMs = parsed;
  }

  const rawPollInterval = process.env.POLL_INTERVAL_MS!;
  const pollIntervalMs = Number(rawPollInterval);
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error(
      `POLL_INTERVAL_MS invalido: "${rawPollInterval}" (debe ser entero positivo, en ms)`,
    );
  }

  const rawTpsThreshold = process.env.TPS_ALERT_THRESHOLD;
  let tpsAlertThreshold = DEFAULT_TPS_ALERT_THRESHOLD;
  if (rawTpsThreshold !== undefined && rawTpsThreshold.trim().length > 0) {
    const parsed = Number(rawTpsThreshold);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `TPS_ALERT_THRESHOLD invalido: "${rawTpsThreshold}" (debe ser numero finito positivo)`,
      );
    }
    tpsAlertThreshold = parsed;
  }

  return {
    discord: {
      token: process.env.DISCORD_BOT_TOKEN!,
      guildId: process.env.DISCORD_GUILD_ID!,
      eventsChannelId: process.env.DISCORD_EVENTS_CHANNEL_ID!,
    },
    server: { port },
    eventStore: { baseUrl: rawBaseUrl, timeoutMs },
    cursor: { filePath: process.env.CURSOR_FILE! },
    polling: { intervalMs: pollIntervalMs },
    tps: { alertThreshold: tpsAlertThreshold },
  };
}
