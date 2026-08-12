import { describe, it, expect, vi } from "vitest";
import {
  computeStatusView,
  renderStatusEmbed,
  handleStatus,
} from "../src/slash/status-handler";
import type { LatestByTypeEvent, OnlinePlayer } from "../src/slash/api-client";
import type { RuntimeSnapshot } from "../src/observability";

function ev(type: string, ts: string, data: Record<string, unknown> = {}): LatestByTypeEvent {
  return {
    id: "1",
    event_uuid: "00000000-0000-4000-8000-000000000001",
    type,
    v: 1,
    ts,
    received_at: ts,
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data,
  };
}

const NOW = new Date("2026-08-11T15:00:00.000Z");
const EMPTY_SNAPSHOT: RuntimeSnapshot = {
  processedEventsTotal: 0,
  processedByType: {},
  unknownEventsTotal: 0,
  pollingErrorsTotal: 0,
  handlerErrorsTotal: 0,
  lastPollAt: null,
  lastSuccessfulPollAt: null,
  lastError: null,
  lastEventProcessed: null,
};

function makeApiClient(overrides: Partial<{
  getPlayersOnline: () => Promise<OnlinePlayer[]>;
  getLatestByType: (type: string, limit?: number) => Promise<LatestByTypeEvent[]>;
  getLatestEventId: () => Promise<string | null>;
}> = {}) {
  return {
    getPlayersOnline: vi.fn().mockResolvedValue([]),
    getLatestByType: vi.fn().mockResolvedValue([]),
    getLatestEventId: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("computeStatusView · derivaciones básicas", () => {
  it("server online (start reciente, sin stop) + uptime calculado", async () => {
    const startTs = "2026-08-11T13:00:00.000Z"; // hace 2h
    const apiClient = makeApiClient({
      getLatestByType: vi.fn(async (type: string) => {
        if (type === "server.start") return [ev("server.start", startTs)];
        return [];
      }),
    });
    const view = await computeStatusView({
      apiClient,
      cursorStore: { load: vi.fn().mockResolvedValue(null) },
      snapshotRuntime: () => EMPTY_SNAPSHOT,
      dlqCountPending: null,
      now: () => NOW,
      botVersion: "0.1.0",
      processUptimeSeconds: () => 42,
      tpsAlertThreshold: 18,
    });
    expect(view.serverOnline).toBe(true);
    expect(view.serverUptimeMs).toBe(2 * 60 * 60 * 1000);
  });

  it("server offline (stop posterior al start) → serverOnline=false, uptime null", async () => {
    const apiClient = makeApiClient({
      getLatestByType: vi.fn(async (type: string) => {
        if (type === "server.start") return [ev("server.start", "2026-08-11T13:00:00.000Z")];
        if (type === "server.stop") return [ev("server.stop", "2026-08-11T14:30:00.000Z")];
        return [];
      }),
    });
    const view = await computeStatusView({
      apiClient,
      cursorStore: { load: vi.fn().mockResolvedValue(null) },
      snapshotRuntime: () => EMPTY_SNAPSHOT,
      dlqCountPending: null,
      now: () => NOW,
      botVersion: "0.1.0",
      processUptimeSeconds: () => 42,
      tpsAlertThreshold: 18,
    });
    expect(view.serverOnline).toBe(false);
    expect(view.serverUptimeMs).toBeNull();
  });

  it("dlq subsystem inactivo (dlqCountPending=null) → línea explícita", async () => {
    const view = await computeStatusView({
      apiClient: makeApiClient(),
      cursorStore: { load: vi.fn().mockResolvedValue(null) },
      snapshotRuntime: () => EMPTY_SNAPSHOT,
      dlqCountPending: null,
      now: () => NOW,
      botVersion: "0.1.0",
      processUptimeSeconds: () => 42,
      tpsAlertThreshold: 18,
    });
    expect(view.dlqLine).toContain("subsistema no activo");
  });

  it("dlq subsystem activo con 3 pendientes → línea 'DLQ pendientes: 3'", async () => {
    const view = await computeStatusView({
      apiClient: makeApiClient(),
      cursorStore: { load: vi.fn().mockResolvedValue(null) },
      snapshotRuntime: () => EMPTY_SNAPSHOT,
      dlqCountPending: vi.fn().mockResolvedValue(3),
      now: () => NOW,
      botVersion: "0.1.0",
      processUptimeSeconds: () => 42,
      tpsAlertThreshold: 18,
    });
    expect(view.dlqPending).toBe(3);
    expect(view.dlqLine).toContain("DLQ pendientes:");
    expect(view.dlqLine).toContain("3");
  });

  it("línea TPS bajo: encuentra el más reciente con tps_1m < threshold en el scan", async () => {
    // El primero (más reciente) está bien; el segundo también; el tercero es < threshold.
    const apiClient = makeApiClient({
      getLatestByType: vi.fn(async (type: string) => {
        if (type === "server.tps_sample")
          return [
            ev("server.tps_sample", "2026-08-11T14:59:00.000Z", { tps_1m: 19.9 }),
            ev("server.tps_sample", "2026-08-11T14:58:00.000Z", { tps_1m: 19.8 }),
            ev("server.tps_sample", "2026-08-11T14:57:00.000Z", { tps_1m: 15.3 }),
          ];
        return [];
      }),
    });
    const view = await computeStatusView({
      apiClient,
      cursorStore: { load: vi.fn().mockResolvedValue(null) },
      snapshotRuntime: () => EMPTY_SNAPSHOT,
      dlqCountPending: null,
      now: () => NOW,
      botVersion: "0.1.0",
      processUptimeSeconds: () => 42,
      tpsAlertThreshold: 18,
    });
    expect(view.lastLowTpsLine).toContain("15.30");
    // 15:00 - 14:57 = 3m
    expect(view.lastLowTpsLine).toContain("hace 3m");
  });

  it("cursor lag calculado: latest_id=100, cursor.event_id=42 → lag=58", async () => {
    const apiClient = makeApiClient({
      getLatestEventId: vi.fn().mockResolvedValue("100"),
    });
    const view = await computeStatusView({
      apiClient,
      cursorStore: {
        load: vi.fn().mockResolvedValue({
          event_id: "42",
          updated_at: "2026-08-11T14:00:00.000Z",
        }),
      },
      snapshotRuntime: () => EMPTY_SNAPSHOT,
      dlqCountPending: null,
      now: () => NOW,
      botVersion: "0.1.0",
      processUptimeSeconds: () => 42,
      tpsAlertThreshold: 18,
    });
    expect(view.cursorLine).toContain("42");
    expect(view.cursorLine).toContain("100");
    expect(view.cursorLine).toContain("lag=58");
  });
});

describe("renderStatusEmbed", () => {
  it("emite un embed con las 9 líneas dentro del description", () => {
    const view = {
      serverOnline: true,
      serverUptimeMs: 3600 * 1000,
      playersOnlineCount: 2,
      playersError: null,
      tpsLine: "⚡ TPS 1m: 19.84 (hace 12s)",
      dlqPending: 0,
      dlqLine: "📮 **DLQ pendientes:** 0",
      lastEventLine: "📥 **Último evento:** #42 session.start (hace 3m)",
      lastLowTpsLine: "🚨 **Última alerta TPS:** sin alertas en las últimas ~50 muestras",
      botUptimeSeconds: 900,
      botVersion: "0.1.0",
      cursorLine: "📍 **Cursor:** 42 / latest=42 (lag=0)",
    };
    const embed = renderStatusEmbed(view, NOW);
    const desc = (embed.data.description ?? "") as string;
    // Las 9 líneas presentes:
    // Nota: la description usa markdown bold (**...**), por eso los
    // markers son parciales/sin `:` para tolerar el formato.
    const linesFound = [
      "🟢",
      "Uptime server",
      "Jugadores online",
      "TPS 1m",
      "DLQ pendientes",
      "Último evento",
      "Última alerta TPS",
      "Bot",
      "Cursor",
    ];
    for (const marker of linesFound) {
      expect(desc, `esperaba "${marker}" en la description`).toContain(marker);
    }
  });
});

describe("handleStatus", () => {
  it("responde con embed ephemeral", async () => {
    const interaction = { reply: vi.fn().mockResolvedValue(undefined) };
    await handleStatus(interaction, {
      apiClient: makeApiClient(),
      cursorStore: { load: vi.fn().mockResolvedValue(null) },
      snapshotRuntime: () => EMPTY_SNAPSHOT,
      dlqCountPending: null,
      now: () => NOW,
      botVersion: "0.1.0",
      processUptimeSeconds: () => 42,
      tpsAlertThreshold: 18,
    });
    const arg = interaction.reply.mock.calls[0]![0] as {
      embeds: unknown[];
      ephemeral: boolean;
    };
    expect(arg.ephemeral).toBe(true);
    expect(arg.embeds).toHaveLength(1);
  });
});
