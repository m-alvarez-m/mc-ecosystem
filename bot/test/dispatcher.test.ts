import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventDispatcher } from "../src/dispatcher/dispatcher";
import type { EventHandler } from "../src/dispatcher/handler";
import {
  DuplicateHandlerError,
  HandlerExecutionError,
  InvalidHandlerError,
} from "../src/dispatcher/errors";
import type { EventRecord } from "../src/eventstore";

// Tests del EventDispatcher.
// Sin mocks del polling engine ni de Discord: el dispatcher es
// completamente autonomo y solo maneja handlers fake locales.

function fakeEvent(id: string, type: string): EventRecord {
  return {
    id,
    event_uuid: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
    type,
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

/**
 * Factory de handlers fake. `types` = a que tipos responde supports().
 * `handle` es opcional: por defecto no hace nada.
 */
function fakeHandler(
  types: readonly string[],
  handle?: (event: EventRecord) => Promise<void>,
): EventHandler {
  return {
    supports: (t: string) => types.includes(t),
    handle: handle ?? (async () => undefined),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("EventDispatcher", () => {
  let dispatcher: EventDispatcher;

  beforeEach(() => {
    dispatcher = new EventDispatcher();
  });

  it("register + dispatch: invoca el handler correcto", async () => {
    const spy = vi.fn(async () => undefined);
    dispatcher.register("session.start", fakeHandler(["session.start"], spy));

    await dispatcher.dispatch([fakeEvent("1", "session.start")]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].id).toBe("1");
  });

  it("register duplicado: lanza DuplicateHandlerError", () => {
    dispatcher.register("session.start", fakeHandler(["session.start"]));
    expect(() =>
      dispatcher.register("session.start", fakeHandler(["session.start"])),
    ).toThrow(DuplicateHandlerError);
  });

  it("register de handler que no soporta el tipo: InvalidHandlerError", () => {
    // supports() devuelve false para el tipo bajo el que se intenta registrar.
    expect(() =>
      dispatcher.register("session.start", fakeHandler(["block.break"])),
    ).toThrow(InvalidHandlerError);
  });

  it("register de objeto malformado: InvalidHandlerError", () => {
    const notAHandler = {} as unknown as EventHandler;
    expect(() => dispatcher.register("session.start", notAHandler)).toThrow(
      InvalidHandlerError,
    );
  });

  it("dispatch enruta cada evento a su handler segun el tipo", async () => {
    const sessionSpy = vi.fn(async () => undefined);
    const blockSpy = vi.fn(async () => undefined);
    dispatcher.register("session.start", fakeHandler(["session.start"], sessionSpy));
    dispatcher.register("block.break", fakeHandler(["block.break"], blockSpy));

    await dispatcher.dispatch([
      fakeEvent("1", "session.start"),
      fakeEvent("2", "block.break"),
      fakeEvent("3", "session.start"),
    ]);

    expect(sessionSpy).toHaveBeenCalledTimes(2);
    expect(blockSpy).toHaveBeenCalledTimes(1);
  });

  it("evento sin handler: no lanza, continua con el siguiente", async () => {
    const knownSpy = vi.fn(async () => undefined);
    dispatcher.register("session.start", fakeHandler(["session.start"], knownSpy));

    await expect(
      dispatcher.dispatch([
        fakeEvent("1", "tipo.desconocido"),
        fakeEvent("2", "session.start"),
      ]),
    ).resolves.toBeUndefined();

    expect(knownSpy).toHaveBeenCalledTimes(1);
    expect(knownSpy.mock.calls[0]![0].id).toBe("2");
  });

  it("evento sin handler: invoca onUnknown si esta configurado", async () => {
    const onUnknown = vi.fn();
    const d = new EventDispatcher({ onUnknown });
    d.register("session.start", fakeHandler(["session.start"]));

    await d.dispatch([
      fakeEvent("1", "tipo.raro"),
      fakeEvent("2", "session.start"),
      fakeEvent("3", "otro.tipo.raro"),
    ]);

    expect(onUnknown).toHaveBeenCalledTimes(2);
    expect(onUnknown.mock.calls[0]![0].type).toBe("tipo.raro");
    expect(onUnknown.mock.calls[1]![0].type).toBe("otro.tipo.raro");
  });

  it("onUnknown que lanza no rompe el dispatch", async () => {
    const onUnknown = vi.fn(() => {
      throw new Error("observador roto");
    });
    const d = new EventDispatcher({ onUnknown });

    await expect(
      d.dispatch([fakeEvent("1", "tipo.desconocido")]),
    ).resolves.toBeUndefined();
    expect(onUnknown).toHaveBeenCalledTimes(1);
  });

  it("handler que lanza: aborta el lote y propaga HandlerExecutionError", async () => {
    const goodSpy = vi.fn(async () => undefined);
    dispatcher.register("good", fakeHandler(["good"], goodSpy));
    dispatcher.register(
      "bad",
      fakeHandler(["bad"], async () => {
        throw new Error("handler boom");
      }),
    );

    const err = await dispatcher
      .dispatch([
        fakeEvent("1", "good"),
        fakeEvent("2", "bad"),
        fakeEvent("3", "good"), // NO debe procesarse
      ])
      .catch((e) => e);

    expect(err).toBeInstanceOf(HandlerExecutionError);
    expect((err as HandlerExecutionError).eventType).toBe("bad");
    expect((err as HandlerExecutionError).eventId).toBe("2");
    expect((err as HandlerExecutionError).cause).toBeInstanceOf(Error);
    expect((err as HandlerExecutionError).cause).toMatchObject({ message: "handler boom" });

    // Solo el primero se proceso; el tercero NO por la abortacion.
    expect(goodSpy).toHaveBeenCalledTimes(1);
    expect(goodSpy.mock.calls[0]![0].id).toBe("1");
  });

  it("procesamiento secuencial: nunca dos handlers concurrentes", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    dispatcher.register(
      "slow",
      fakeHandler(["slow"], async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(30);
        inFlight--;
      }),
    );

    await dispatcher.dispatch([
      fakeEvent("1", "slow"),
      fakeEvent("2", "slow"),
      fakeEvent("3", "slow"),
    ]);

    expect(maxInFlight).toBe(1);
  });

  it("mantiene el orden recibido", async () => {
    const seen: string[] = [];
    dispatcher.register(
      "a",
      fakeHandler(["a"], async (e) => {
        seen.push(`a:${e.id}`);
      }),
    );
    dispatcher.register(
      "b",
      fakeHandler(["b"], async (e) => {
        seen.push(`b:${e.id}`);
      }),
    );

    await dispatcher.dispatch([
      fakeEvent("1", "a"),
      fakeEvent("2", "b"),
      fakeEvent("3", "a"),
      fakeEvent("4", "b"),
      fakeEvent("5", "a"),
    ]);

    expect(seen).toEqual(["a:1", "b:2", "a:3", "b:4", "a:5"]);
  });

  it("unregister remueve el handler y devuelve true", async () => {
    const spy = vi.fn(async () => undefined);
    dispatcher.register("session.start", fakeHandler(["session.start"], spy));

    expect(dispatcher.unregister("session.start")).toBe(true);
    await dispatcher.dispatch([fakeEvent("1", "session.start")]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("unregister sobre tipo no registrado devuelve false (idempotente)", () => {
    expect(dispatcher.unregister("no.existe")).toBe(false);
  });

  it("clear() vacia el registro", async () => {
    const spy = vi.fn(async () => undefined);
    dispatcher.register("a", fakeHandler(["a"], spy));
    dispatcher.register("b", fakeHandler(["b"], spy));

    dispatcher.clear();

    await dispatcher.dispatch([fakeEvent("1", "a"), fakeEvent("2", "b")]);
    expect(spy).not.toHaveBeenCalled();

    // Y despues de clear se pueden registrar de nuevo sin duplicado.
    expect(() =>
      dispatcher.register("a", fakeHandler(["a"], spy)),
    ).not.toThrow();
  });

  it("lote vacio: no hace nada, no lanza", async () => {
    await expect(dispatcher.dispatch([])).resolves.toBeUndefined();
  });
});
