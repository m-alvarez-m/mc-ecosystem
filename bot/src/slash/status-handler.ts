import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { CursorStore } from "../cursor";
import type { RuntimeSnapshot } from "../observability";
import { SlashApiClient, SlashApiError, LatestByTypeEvent } from "./api-client";
import {
  formatDurationMs,
  formatRelative,
  formatRelativeOrAbsolute,
} from "./format-time";
import { computeTpsView, renderTpsLine } from "./tps-handler";

// Handler de /status (ADR-016 D3, 9 líneas).
//
// 1. Server Minecraft online/offline (server.start vs server.stop)
// 2. Uptime del server (desde último server.start si online)
// 3. Jugadores online (número)
// 4. TPS 1m (con freshness)
// 5. DLQ pendientes (evidencia silenciosa ADR-013)
// 6. Último evento procesado (via RuntimeState.snapshot)
// 7. Última alerta TPS bajo (query events, filtro client-side)
// 8. Bot version + uptime del bot
// 9. Cursor del bot vs latest_id (lag)

const LOW_TPS_SCAN_LIMIT = 50;
const NO_ALERTS_WINDOW_LABEL = `en las últimas ~${LOW_TPS_SCAN_LIMIT} muestras`;

export interface StatusHandlerDeps {
  apiClient: Pick<
    SlashApiClient,
    "getPlayersOnline" | "getLatestByType" | "getLatestEventId"
  >;
  cursorStore: Pick<CursorStore, "load">;
  snapshotRuntime: () => RuntimeSnapshot;
  dlqCountPending: (() => Promise<number>) | null;
  now: () => Date;
  botVersion: string;
  processUptimeSeconds: () => number;
  tpsAlertThreshold: number;
  freshnessThresholdMs?: number;
}

export interface StatusView {
  serverOnline: boolean;
  serverUptimeMs: number | null;
  playersOnlineCount: number | null;
  playersError: string | null;
  tpsLine: string;
  dlqPending: number | null;
  dlqLine: string;
  lastEventLine: string;
  lastLowTpsLine: string;
  botUptimeSeconds: number;
  botVersion: string;
  cursorLine: string;
}

export async function computeStatusView(
  deps: StatusHandlerDeps,
): Promise<StatusView> {
  const now = deps.now();

  // Lanzamos en paralelo lo independiente. Cada uno con try/catch
  // individual: un fallo aislado no rompe el /status entero.
  const [
    startEvents,
    stopEvents,
    playersRes,
    tpsView,
    lowTpsEvents,
    latestId,
    cursorData,
    dlqPending,
  ] = await Promise.all([
    safe(() => deps.apiClient.getLatestByType("server.start", 1), []),
    safe(() => deps.apiClient.getLatestByType("server.stop", 1), []),
    safe(async () => ({
      count: (await deps.apiClient.getPlayersOnline()).length,
    })),
    safe(() => computeTpsView(deps)),
    safe(
      () =>
        deps.apiClient.getLatestByType(
          "server.tps_sample",
          LOW_TPS_SCAN_LIMIT,
        ),
      [] as LatestByTypeEvent[],
    ),
    safe(() => deps.apiClient.getLatestEventId()),
    safe(() => deps.cursorStore.load()),
    deps.dlqCountPending === null
      ? Promise.resolve(null)
      : safe(deps.dlqCountPending),
  ]);

  const snapshot = deps.snapshotRuntime();

  const { serverOnline, serverUptimeMs } = deriveServerUptime(
    startEvents,
    stopEvents,
    now,
  );

  return {
    serverOnline,
    serverUptimeMs,
    playersOnlineCount: playersRes ? playersRes.count : null,
    playersError: playersRes ? null : "consulta fallida",
    tpsLine: tpsView
      ? renderTpsLine(tpsView)
      : "⚡ TPS no disponible (consulta fallida)",
    dlqPending: dlqPending ?? null,
    dlqLine: renderDlqLine(dlqPending, deps.dlqCountPending !== null),
    lastEventLine: renderLastEventLine(snapshot, now),
    lastLowTpsLine: renderLowTpsLine(
      lowTpsEvents,
      deps.tpsAlertThreshold,
      now,
    ),
    botUptimeSeconds: deps.processUptimeSeconds(),
    botVersion: deps.botVersion,
    cursorLine: renderCursorLine(cursorData, latestId),
  };
}

export function renderStatusEmbed(view: StatusView, now: Date): EmbedBuilder {
  const serverLine = view.serverOnline
    ? "🟢 **Server:** online"
    : "🔴 **Server:** offline";
  const uptimeLine = view.serverOnline
    ? `⏱️ **Uptime server:** ${view.serverUptimeMs === null ? "N/A" : formatDurationMs(view.serverUptimeMs)}`
    : "⏱️ **Uptime server:** N/A";
  const playersLine =
    view.playersError !== null
      ? "👥 **Jugadores online:** N/A (consulta fallida)"
      : `👥 **Jugadores online:** ${view.playersOnlineCount}`;
  const botLine = `🤖 **Bot:** v${view.botVersion} (uptime ${formatDurationMs(view.botUptimeSeconds * 1000)})`;

  const lines = [
    serverLine,
    uptimeLine,
    playersLine,
    view.tpsLine,
    view.dlqLine,
    view.lastEventLine,
    view.lastLowTpsLine,
    botLine,
    view.cursorLine,
  ];

  return new EmbedBuilder()
    .setTitle("📊 Status del ecosistema")
    .setDescription(lines.join("\n"))
    .setTimestamp(now);
}

export async function handleStatus(
  interaction: Pick<ChatInputCommandInteraction, "reply">,
  deps: StatusHandlerDeps,
): Promise<void> {
  try {
    const view = await computeStatusView(deps);
    const embed = renderStatusEmbed(view, deps.now());
    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (err) {
    const detail = err instanceof SlashApiError ? err.message : String(err);
    await interaction.reply({
      content: `⚠️ No pude construir el status: ${detail}`,
      ephemeral: true,
    });
  }
}

// ---------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------

async function safe<T>(fn: () => Promise<T>, fallback?: T): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return fallback ?? null;
  }
}

function deriveServerUptime(
  startEvents: LatestByTypeEvent[] | null,
  stopEvents: LatestByTypeEvent[] | null,
  now: Date,
): { serverOnline: boolean; serverUptimeMs: number | null } {
  if (!startEvents || startEvents.length === 0) {
    return { serverOnline: false, serverUptimeMs: null };
  }
  const startTs = new Date(startEvents[0]!.ts);
  const stopTs =
    stopEvents && stopEvents.length > 0
      ? new Date(stopEvents[0]!.ts)
      : null;
  if (stopTs !== null && stopTs.getTime() >= startTs.getTime()) {
    return { serverOnline: false, serverUptimeMs: null };
  }
  return {
    serverOnline: true,
    serverUptimeMs: now.getTime() - startTs.getTime(),
  };
}

function renderDlqLine(
  pending: number | null,
  subsystemActive: boolean,
): string {
  if (!subsystemActive) return "📮 **DLQ:** subsistema no activo (ADR-013 sin token)";
  if (pending === null) return "📮 **DLQ:** consulta fallida";
  return `📮 **DLQ pendientes:** ${pending}`;
}

function renderLastEventLine(
  snapshot: RuntimeSnapshot,
  now: Date,
): string {
  if (snapshot.lastEventProcessed === null) {
    return "📥 **Último evento:** ninguno procesado aún";
  }
  const rec = snapshot.lastEventProcessed;
  const ageMs = now.getTime() - new Date(rec.timestamp).getTime();
  return `📥 **Último evento:** #${rec.id} ${rec.type} (${formatRelative(ageMs)})`;
}

function renderLowTpsLine(
  events: LatestByTypeEvent[] | null,
  threshold: number,
  now: Date,
): string {
  if (!events || events.length === 0) return "🚨 **Última alerta TPS:** sin datos";
  // Ya vienen en orden DESC por id — el primero que matchea es el más reciente.
  for (const ev of events) {
    const raw = ev.data?.["tps_1m"];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    if (raw < threshold) {
      const ageMs = now.getTime() - new Date(ev.ts).getTime();
      return `🚨 **Última alerta TPS:** ${raw.toFixed(2)} ${formatRelative(ageMs)}`;
    }
  }
  return `🚨 **Última alerta TPS:** sin alertas ${NO_ALERTS_WINDOW_LABEL}`;
}

function renderCursorLine(
  cursor: { event_id: string } | null,
  latestId: string | null,
): string {
  if (cursor === null && latestId === null)
    return "📍 **Cursor:** sin datos";
  if (cursor === null) return `📍 **Cursor:** sin persistir / latest=${latestId}`;
  if (latestId === null)
    return `📍 **Cursor:** ${cursor.event_id} / latest=?`;
  const lag = safeBigIntDiff(latestId, cursor.event_id);
  const lagStr = lag === null ? "?" : lag.toString();
  return `📍 **Cursor:** ${cursor.event_id} / latest=${latestId} (lag=${lagStr})`;
}

function safeBigIntDiff(a: string, b: string): bigint | null {
  try {
    return BigInt(a) - BigInt(b);
  } catch {
    return null;
  }
}
