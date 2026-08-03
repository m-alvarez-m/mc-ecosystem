import { describe, it, expect, vi } from "vitest";
import { EventDispatcher } from "../src/dispatcher";
import { ServerStartedHandler } from "../src/handlers/server-started-handler";
import { ServerStoppedHandler } from "../src/handlers/server-stopped-handler";
import { createLifecycleStateStore } from "../src/handlers/lifecycle-state";
import type { DispatchContext } from "../src/context";
import type { EventRecord } from "../src/eventstore";
import type { PlayerNameResolver } from "../src/players";

// BUG-02C · tests de integracion de la maquina de estados lifecycle.
//
// Reproducen las 4 secuencias solicitadas:
//   1) start + stop antiguo → NO publica stop (freshness).
//   2) start + start duplicado → NO publica dos veces (state UP).
//   3) stop + stop duplicado → NO publica dos veces (state DOWN).
//   4) start + stop valido → publica ambos (transicion up → down).
//
// Los tests van a traves del dispatcher real, con
// ServerStartedHandler y ServerStoppedHandler registrados y el
// mismo `lifecycleState` compartido — modo exacto en el que se
// integran en produccion.

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

function fakeContext(): DispatchContext & {
  publisher: { publish: ReturnType<typeof vi.fn> };
  logger: { warn: ReturnType<typeof vi.fn> };
} {
  const publisher = { publish: vi.fn(async () => undefined) };
  const logger = { warn: vi.fn() };
  return {
    publisher,
    playerNameResolver: {
      resolve: async () => "TestName",
    } as unknown as PlayerNameResolver,
    logger,
    freshnessThresholdMs: 120_000,
    lifecycleState: createLifecycleStateStore(),
  };
}

function serverStart(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "1",
    event_uuid: "00000000-0000-4000-8000-000000000001",
    type: "server.start",
    v: 1,
    ts: "2026-08-03T03:28:08.266Z",
    received_at: "2026-08-03T03:28:08.301Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data: {},
    ...overrides,
  };
}

function serverStop(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "2",
    event_uuid: "00000000-0000-4000-8000-000000000002",
    type: "server.stop",
    v: 1,
    ts: "2026-08-03T03:30:00.000Z",
    received_at: "2026-08-03T03:30:00.500Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data: {},
    ...overrides,
  };
}

function buildDispatcher(context: DispatchContext): EventDispatcher {
  const d = new EventDispatcher({ context });
  d.register("server.start", new ServerStartedHandler());
  d.register("server.stop", new ServerStoppedHandler());
  return d;
}

// ------------------------------------------------------------------
// store standalone
// ------------------------------------------------------------------

describe("createLifecycleStateStore", () => {
  it("estado inicial default = 'unknown'", () => {
    const s = createLifecycleStateStore();
    expect(s.get()).toBe("unknown");
  });

  it("acepta estado inicial custom (util para tests)", () => {
    const s = createLifecycleStateStore("up");
    expect(s.get()).toBe("up");
  });

  it("set → get devuelve el nuevo valor", () => {
    const s = createLifecycleStateStore();
    s.set("up");
    expect(s.get()).toBe("up");
    s.set("down");
    expect(s.get()).toBe("down");
  });
});

// ------------------------------------------------------------------
// escenarios de BUG-02C
// ------------------------------------------------------------------

describe("BUG-02C · secuencias lifecycle a traves del dispatcher", () => {
  it("1) start fresco + stop antiguo (~20h lag): NO publica stop", async () => {
    // Escenario textual del bug del 2026-08-03: server.start id 14118
    // con lag 34ms; server.stop id 14120 con lag ~20h. La bandera del
    // sistema tras procesar ambos debe ser: 1 publish (start), 1 warn
    // (obsoleto), estado "up".
    const context = fakeContext();
    const dispatcher = buildDispatcher(context);

    const start = serverStart({
      id: "14118",
      event_uuid: "90fe7cd3-b2d9-46b8-a516-93b7c3dbfb9d",
      ts: "2026-08-03T03:28:08.266Z",
      received_at: "2026-08-03T03:28:08.301Z",
    });
    const staleStop = serverStop({
      id: "14120",
      event_uuid: "9a636409-aab4-45bc-96a3-d976a69b8df8",
      ts: "2026-08-02T07:29:43.642Z", // ayer
      received_at: "2026-08-03T03:28:40.870Z", // hoy → ~20h de lag
    });

    await dispatcher.dispatch([start, staleStop]);

    expect(context.publisher.publish).toHaveBeenCalledTimes(1);
    expect(context.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "server_started" }),
    );
    // warn: 1 exacto por el stop obsoleto.
    const warnCalls = context.logger.warn.mock.calls;
    expect(warnCalls.length).toBe(1);
    const payload = warnCalls[0]![0] as Record<string, unknown>;
    expect(payload.motivo).toBe("evento_obsoleto");
    expect(payload.type).toBe("server.stop");
    // Estado quedo en "up".
    expect(context.lifecycleState.get()).toBe("up");
  });

  it("2) start + start duplicado (ambos frescos): publica UNO, warn duplicado_lifecycle", async () => {
    const context = fakeContext();
    const dispatcher = buildDispatcher(context);

    const start1 = serverStart({
      id: "100",
      event_uuid: "00000000-0000-4000-8000-000000000100",
    });
    const start2 = serverStart({
      id: "101",
      event_uuid: "00000000-0000-4000-8000-000000000101",
      // Frescos ambos — el segundo llega segundos despues del primero.
      ts: "2026-08-03T03:28:20.000Z",
      received_at: "2026-08-03T03:28:20.100Z",
    });

    await dispatcher.dispatch([start1, start2]);

    expect(context.publisher.publish).toHaveBeenCalledTimes(1);
    expect(context.logger.warn).toHaveBeenCalledTimes(1);
    const payload = context.logger.warn.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.motivo).toBe("duplicado_lifecycle");
    expect(payload.type).toBe("server.start");
    expect(payload.prior_state).toBe("up");
    expect(context.lifecycleState.get()).toBe("up");
  });

  it("3) stop + stop duplicado (ambos frescos): publica UNO, warn duplicado_lifecycle", async () => {
    // Estado inicial 'up' para que el primer stop publique (transicion
    // legitima up → down). Reproduce el peor caso: dos stops frescos
    // consecutivos.
    const context = fakeContext();
    context.lifecycleState.set("up");
    const dispatcher = buildDispatcher(context);

    const stop1 = serverStop({
      id: "200",
      event_uuid: "00000000-0000-4000-8000-000000000200",
    });
    const stop2 = serverStop({
      id: "201",
      event_uuid: "00000000-0000-4000-8000-000000000201",
      ts: "2026-08-03T03:30:20.000Z",
      received_at: "2026-08-03T03:30:20.100Z",
    });

    await dispatcher.dispatch([stop1, stop2]);

    expect(context.publisher.publish).toHaveBeenCalledTimes(1);
    expect(context.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "server_stopped" }),
    );
    expect(context.logger.warn).toHaveBeenCalledTimes(1);
    const payload = context.logger.warn.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.motivo).toBe("duplicado_lifecycle");
    expect(payload.type).toBe("server.stop");
    expect(payload.prior_state).toBe("down");
    expect(context.lifecycleState.get()).toBe("down");
  });

  it("4) start + stop valido (ambos frescos): publica AMBOS y transiciona a 'down'", async () => {
    const context = fakeContext();
    const dispatcher = buildDispatcher(context);

    const start = serverStart({
      id: "300",
      event_uuid: "00000000-0000-4000-8000-000000000300",
    });
    const stop = serverStop({
      id: "301",
      event_uuid: "00000000-0000-4000-8000-000000000301",
      ts: "2026-08-03T03:30:00.000Z",
      received_at: "2026-08-03T03:30:00.500Z",
    });

    await dispatcher.dispatch([start, stop]);

    expect(context.publisher.publish).toHaveBeenCalledTimes(2);
    // Kinds en orden.
    expect(context.publisher.publish.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ kind: "server_started" }),
    );
    expect(context.publisher.publish.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ kind: "server_stopped" }),
    );
    expect(context.logger.warn).not.toHaveBeenCalled();
    expect(context.lifecycleState.get()).toBe("down");
  });

  it("start obsoleto: NO publica ni transiciona (freshness gana antes que state)", async () => {
    const context = fakeContext();
    const dispatcher = buildDispatcher(context);
    const staleStart = serverStart({
      id: "999",
      ts: "2026-07-01T00:00:00Z",
      received_at: "2026-08-03T00:00:00Z",
    });
    await dispatcher.dispatch([staleStart]);
    expect(context.publisher.publish).not.toHaveBeenCalled();
    expect(context.lifecycleState.get()).toBe("unknown");
  });
});
