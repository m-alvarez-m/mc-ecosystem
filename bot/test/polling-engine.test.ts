import { describe, it, expect, beforeEach, vi } from "vitest";
import { PollingEngine } from "../src/polling/polling-engine";
import {
  AlreadyRunningError,
  ConsumerError,
  CursorAccessError,
  EventFetchError,
  PollingEngineError,
} from "../src/polling/errors";
import type { EventFetcher, PollingConsumer } from "../src/polling/types";
import type { CursorData, CursorStore } from "../src/cursor";
import type { EventRecord, GetEventsResponse } from "../src/eventstore";

// Tests del Polling Engine.
// Mocks/fakes en memoria: cero filesystem, cero red.

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeCursorStore implements CursorStore {
  data: CursorData | null = null;
  saveCount = 0;

  async exists(): Promise<boolean> {
    return this.data !== null;
  }

  async load(): Promise<CursorData | null> {
    return this.data;
  }

  async save(eventId: string): Promise<void> {
    this.data = { event_id: eventId, updated_at: new Date().toISOString() };
    this.saveCount++;
  }

  async reset(): Promise<void> {
    this.data = null;
  }
}

function fakeEvent(id: string): EventRecord {
  return {
    id,
    event_uuid: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
    type: "test.event",
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data: {},
  };
}

interface Ctx {
  cursorStore: FakeCursorStore;
  getEvents: ReturnType<typeof vi.fn>;
  consumer: ReturnType<typeof vi.fn>;
  errors: PollingEngineError[];
  makeEngine: (pollIntervalMs?: number) => PollingEngine;
}

function setupCtx(): Ctx {
  const cursorStore = new FakeCursorStore();
  const getEvents = vi.fn(async (): Promise<GetEventsResponse> => ({
    events: [],
    last_id: null,
  }));
  const consumer = vi.fn(async (_events: readonly EventRecord[]): Promise<void> => {
    /* noop */
  });
  const errors: PollingEngineError[] = [];

  const makeEngine = (pollIntervalMs = 20): PollingEngine => {
    const fetcher: EventFetcher = {
      getEvents: getEvents as unknown as EventFetcher["getEvents"],
    };
    const cb: PollingConsumer = consumer as unknown as PollingConsumer;
    return new PollingEngine({
      eventStoreClient: fetcher,
      cursorStore,
      consumer: cb,
      pollIntervalMs,
      onError: (err) => errors.push(err),
    });
  };

  return { cursorStore, getEvents, consumer, errors, makeEngine };
}

describe("PollingEngine", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = setupCtx();
  });

  it("start / isRunning / stop: ciclo basico de vida", async () => {
    const engine = ctx.makeEngine();
    expect(engine.isRunning()).toBe(false);

    await engine.start();
    expect(engine.isRunning()).toBe(true);

    await engine.stop();
    expect(engine.isRunning()).toBe(false);
  });

  it("ciclo sin eventos: no invoca consumer ni actualiza cursor", async () => {
    const engine = ctx.makeEngine(20);
    await engine.start();
    await sleep(80);
    await engine.stop();

    expect(ctx.consumer).not.toHaveBeenCalled();
    expect(ctx.cursorStore.data).toBeNull();
    expect(ctx.cursorStore.saveCount).toBe(0);
    expect(ctx.getEvents.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("ciclo con eventos: invoca consumer una vez y actualiza cursor con last_id", async () => {
    ctx.getEvents.mockResolvedValueOnce({
      events: [fakeEvent("10"), fakeEvent("11")],
      last_id: "11",
    });
    // Resto de llamadas: sin eventos (default).

    const engine = ctx.makeEngine(20);
    await engine.start();
    await sleep(80);
    await engine.stop();

    expect(ctx.consumer).toHaveBeenCalledTimes(1);
    const deliveredBatch = ctx.consumer.mock.calls[0]![0] as readonly EventRecord[];
    expect(deliveredBatch).toHaveLength(2);
    expect(deliveredBatch[0]!.id).toBe("10");
    expect(ctx.cursorStore.data?.event_id).toBe("11");
  });

  it("fallback a id del ultimo evento si last_id viene null en la respuesta", async () => {
    ctx.getEvents.mockResolvedValueOnce({
      events: [fakeEvent("7")],
      last_id: null, // la api no lo envio; fallback al id del batch
    });

    const engine = ctx.makeEngine(20);
    await engine.start();
    await sleep(50);
    await engine.stop();

    expect(ctx.cursorStore.data?.event_id).toBe("7");
  });

  it("callback que falla NO actualiza cursor y emite ConsumerError", async () => {
    ctx.getEvents.mockResolvedValue({
      events: [fakeEvent("10")],
      last_id: "10",
    });
    ctx.consumer.mockRejectedValue(new Error("consumer boom"));

    const engine = ctx.makeEngine(20);
    await engine.start();
    await sleep(80);
    await engine.stop();

    expect(ctx.cursorStore.data).toBeNull();
    expect(ctx.cursorStore.saveCount).toBe(0);
    const consumerErrors = ctx.errors.filter((e) => e instanceof ConsumerError);
    expect(consumerErrors.length).toBeGreaterThan(0);
    // El mismo evento se re-entrega en cada iteracion (at-least-once).
    expect(ctx.consumer.mock.calls.length).toBeGreaterThan(1);
  });

  it("error del cliente HTTP emite EventFetchError y no invoca consumer", async () => {
    ctx.getEvents.mockRejectedValue(new Error("network boom"));

    const engine = ctx.makeEngine(20);
    await engine.start();
    await sleep(80);
    await engine.stop();

    expect(ctx.consumer).not.toHaveBeenCalled();
    expect(ctx.errors.some((e) => e instanceof EventFetchError)).toBe(true);
  });

  it("error del cursor store (load) emite CursorAccessError con operation='load'", async () => {
    const failStore: CursorStore = {
      exists: async () => false,
      load: async () => {
        throw new Error("cursor read boom");
      },
      save: async () => undefined,
      reset: async () => undefined,
    };
    const errors: PollingEngineError[] = [];
    const engine = new PollingEngine({
      eventStoreClient: { getEvents: ctx.getEvents as unknown as EventFetcher["getEvents"] },
      cursorStore: failStore,
      consumer: (ctx.consumer as unknown) as PollingConsumer,
      pollIntervalMs: 20,
      onError: (err) => errors.push(err),
    });

    await engine.start();
    await sleep(50);
    await engine.stop();

    const cursorErrors = errors.filter((e) => e instanceof CursorAccessError);
    expect(cursorErrors.length).toBeGreaterThan(0);
    expect((cursorErrors[0] as CursorAccessError).operation).toBe("load");
    expect(ctx.getEvents).not.toHaveBeenCalled();
  });

  it("error del cursor store (save) NO impide re-entrega en la siguiente iteracion", async () => {
    ctx.getEvents.mockResolvedValue({
      events: [fakeEvent("42")],
      last_id: "42",
    });
    const failStore: CursorStore = {
      exists: async () => false,
      load: async () => null,
      save: async () => {
        throw new Error("cursor write boom");
      },
      reset: async () => undefined,
    };
    const errors: PollingEngineError[] = [];
    const engine = new PollingEngine({
      eventStoreClient: { getEvents: ctx.getEvents as unknown as EventFetcher["getEvents"] },
      cursorStore: failStore,
      consumer: (ctx.consumer as unknown) as PollingConsumer,
      pollIntervalMs: 20,
      onError: (err) => errors.push(err),
    });

    await engine.start();
    await sleep(80);
    await engine.stop();

    // save siempre falla -> cursor conceptual sigue en null -> mismo
    // lote se entrega en cada iteracion.
    expect(ctx.consumer.mock.calls.length).toBeGreaterThan(1);
    const saveErrors = errors
      .filter((e) => e instanceof CursorAccessError)
      .map((e) => (e as CursorAccessError).operation);
    expect(saveErrors).toContain("save");
  });

  it("start() dos veces lanza AlreadyRunningError", async () => {
    const engine = ctx.makeEngine();
    await engine.start();
    await expect(engine.start()).rejects.toBeInstanceOf(AlreadyRunningError);
    await engine.stop();
  });

  it("stop() sin start() previo es no-op y no lanza", async () => {
    const engine = ctx.makeEngine();
    await expect(engine.stop()).resolves.toBeUndefined();
    expect(engine.isRunning()).toBe(false);
  });

  it("stop() idempotente: llamar dos veces no lanza", async () => {
    const engine = ctx.makeEngine();
    await engine.start();
    await engine.stop();
    await expect(engine.stop()).resolves.toBeUndefined();
  });

  it("iteracion mas larga que el intervalo: nunca dos concurrentes", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    ctx.getEvents.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Bloqueamos 100 ms; intervalo es 20 ms.
      await sleep(100);
      inFlight--;
      return { events: [], last_id: null };
    });

    const engine = ctx.makeEngine(20);
    await engine.start();
    // Esperamos ~4 iteraciones (400 ms) + margen.
    await sleep(450);
    await engine.stop();

    // La invariante clave del motor.
    expect(maxInFlight).toBe(1);
    // Y de paso: hemos completado al menos 2 iteraciones a este ritmo.
    expect(ctx.getEvents.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("segundo ciclo con eventos: usa after_id del cursor guardado en el primero", async () => {
    ctx.getEvents.mockResolvedValueOnce({
      events: [fakeEvent("100")],
      last_id: "100",
    });
    // Segunda llamada: sin eventos, pero registramos el parametro.

    const engine = ctx.makeEngine(20);
    await engine.start();
    await sleep(80);
    await engine.stop();

    expect(ctx.getEvents.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Primera llamada: sin cursor previo -> {}.
    expect(ctx.getEvents.mock.calls[0]![0]).toEqual({});
    // Segunda llamada en adelante: con after_id="100".
    const secondCallArgs = ctx.getEvents.mock.calls[1]![0] as { after_id?: string };
    expect(secondCallArgs.after_id).toBe("100");
  });

  it("stop() durante una iteracion espera a que termine antes de resolver", async () => {
    let releaseBlock: (() => void) | null = null;
    ctx.getEvents.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseBlock = resolve;
      });
      return { events: [], last_id: null };
    });

    const engine = ctx.makeEngine(20);
    await engine.start();
    // Damos tiempo a que arranque la primera iteracion.
    await sleep(15);

    // Pedimos stop; no puede resolver hasta que liberemos el fetch.
    const stopPromise = engine.stop();
    let stopped = false;
    void stopPromise.then(() => {
      stopped = true;
    });

    await sleep(30);
    expect(stopped).toBe(false); // sigue esperando el fetch

    releaseBlock?.();
    await stopPromise;
    expect(stopped).toBe(true);
  });
});
