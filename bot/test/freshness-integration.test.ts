import { describe, it, expect, vi } from "vitest";
import { EventDispatcher } from "../src/dispatcher";
import { ServerStartedHandler } from "../src/handlers/server-started-handler";
import { ServerStoppedHandler } from "../src/handlers/server-stopped-handler";
import type { DispatchContext } from "../src/context";
import { createLifecycleStateStore } from "../src/handlers/lifecycle-state";
import type { EventRecord } from "../src/eventstore";
import type { PlayerNameResolver } from "../src/players";

// Tests de integracion del contrato de freshness (BUG-02B).
//
// Escenario reproducido del BUG-02: al dispatcher llega un lote con
// [server.start fresco, server.stop obsoleto reentregado por buffer
// del plugin]. Verifica que:
//   - Discord recibe SOLO el server.start.
//   - El dispatcher NO lanza (cursor puede avanzar).
//   - El log WARN se emite sobre el server.stop obsoleto.
//   - El polling engine no se ve afectado (dispatcher.dispatch resuelve OK).

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

function serverStart(): EventRecord {
  return {
    id: "14081",
    event_uuid: "ce110c88-6844-4231-a91e-bc76ba1f9af3",
    type: "server.start",
    v: 1,
    ts: "2026-08-02T07:00:31.785Z",
    received_at: "2026-08-02T07:00:31.814Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data: { mc_version: "26.1.2", plugins: [] },
  };
}

function serverStopStale(): EventRecord {
  // El evento del BUG-02: server.stop de ayer entregado hoy.
  return {
    id: "14082",
    event_uuid: "4fa12f2c-d645-4f7e-bd64-73149de1968a",
    type: "server.stop",
    v: 1,
    ts: "2026-08-01T09:08:32.427Z",
    received_at: "2026-08-02T07:01:03.996Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data: { uptime_s: 1752 },
  };
}

describe("Freshness contract — integracion via dispatcher (BUG-02B)", () => {
  it("BUG-02 reproducido: server.start fresco + server.stop obsoleto → Discord ve UNO", async () => {
    const context = fakeContext();
    const dispatcher = new EventDispatcher({ context });
    dispatcher.register("server.start", new ServerStartedHandler());
    dispatcher.register("server.stop", new ServerStoppedHandler());

    await dispatcher.dispatch([serverStart(), serverStopStale()]);

    // Solo un publish: el server.start. El server.stop obsoleto se
    // descarta con WARN.
    expect(context.publisher.publish).toHaveBeenCalledTimes(1);
    expect(context.publisher.publish).toHaveBeenCalledWith({
      title: "Servidor iniciado",
      body: "Servidor iniciado correctamente.",
      kind: "server_started",
    });
    // WARN sobre el stop obsoleto (no sobre el start).
    expect(context.logger.warn).toHaveBeenCalledTimes(1);
    const warned = context.logger.warn.mock.calls[0]![0] as Record<string, unknown>;
    expect(warned.type).toBe("server.stop");
    expect(warned.handler).toBe("ServerStoppedHandler");
  });

  it("dispatch NO lanza aunque haya un evento obsoleto (cursor puede avanzar)", async () => {
    const context = fakeContext();
    const dispatcher = new EventDispatcher({ context });
    dispatcher.register("server.start", new ServerStartedHandler());
    dispatcher.register("server.stop", new ServerStoppedHandler());

    await expect(
      dispatcher.dispatch([serverStart(), serverStopStale()]),
    ).resolves.toBeUndefined();
  });

  it("orden preservado: el server.start (id 14081) se publica ANTES de descartar el server.stop (id 14082)", async () => {
    const context = fakeContext();
    const dispatcher = new EventDispatcher({ context });
    // Registramos publish y warn como spies con timestamps de invocacion.
    const order: string[] = [];
    context.publisher.publish.mockImplementation(async () => {
      order.push("publish");
    });
    context.logger.warn.mockImplementation(() => {
      order.push("warn");
    });
    dispatcher.register("server.start", new ServerStartedHandler());
    dispatcher.register("server.stop", new ServerStoppedHandler());

    await dispatcher.dispatch([serverStart(), serverStopStale()]);

    expect(order).toEqual(["publish", "warn"]);
  });

  it("el EventRecord obsoleto NO se muta ni se transforma (Event Store permanece intacto en el lote)", async () => {
    const context = fakeContext();
    const dispatcher = new EventDispatcher({ context });
    dispatcher.register("server.stop", new ServerStoppedHandler());

    const stale = serverStopStale();
    const snapshot = JSON.parse(JSON.stringify(stale));

    await dispatcher.dispatch([stale]);

    // El handler descarto el evento pero NO lo modifico. La api
    // (Event Store) sigue siendo la fuente de verdad; el bot solo
    // decide si lo publica o no.
    expect(stale).toEqual(snapshot);
  });

  it("polling puede seguir tras un lote con obsoletos (dispatcher OK → cursor avanza)", async () => {
    // Simulamos DOS lotes consecutivos: uno con obsoleto, otro con
    // eventos frescos. Ambos resuelven OK — el motor de polling
    // avanza el cursor sin quedar atascado.
    const context = fakeContext();
    const dispatcher = new EventDispatcher({ context });
    dispatcher.register("server.start", new ServerStartedHandler());
    dispatcher.register("server.stop", new ServerStoppedHandler());

    await expect(
      dispatcher.dispatch([serverStart(), serverStopStale()]),
    ).resolves.toBeUndefined();

    // Siguiente lote: server.stop fresco. Debe publicarse.
    const freshStop: EventRecord = {
      ...serverStopStale(),
      id: "14200",
      event_uuid: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
      ts: "2026-08-02T08:00:00.000Z",
      received_at: "2026-08-02T08:00:00.500Z",
    };
    await expect(dispatcher.dispatch([freshStop])).resolves.toBeUndefined();

    // Al final: 1 start publicado + 1 stop publicado (el fresco).
    expect(context.publisher.publish).toHaveBeenCalledTimes(2);
  });
});
