import { describe, it, expect } from "vitest";
import { RuntimeState } from "../src/observability";
import type { EventRecord } from "../src/eventstore";

// Tests unitarios de RuntimeState. Cero IO, cero timing.
//
// Verifican los contratos que compose.ts y el health server (T7)
// darán por sentados: contadores monótonos, timestamps ISO 8601,
// snapshot inmutable, ultimo error atribuible a evento cuando aplica.

function fakeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: overrides.id ?? "42",
    event_uuid: overrides.event_uuid ?? "00000000-0000-4000-8000-000000000042",
    type: overrides.type ?? "chat.message",
    v: 1,
    ts: "2026-07-30T00:00:00.000Z",
    received_at: "2026-07-30T00:00:00.010Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data: {},
  };
}

describe("RuntimeState", () => {
  it("estado inicial: todos los contadores en 0, todos los timestamps null", () => {
    const state = new RuntimeState();
    const s = state.snapshot();

    expect(s.processedEventsTotal).toBe(0);
    expect(Object.keys(s.processedByType)).toHaveLength(0);
    expect(s.unknownEventsTotal).toBe(0);
    expect(s.pollingErrorsTotal).toBe(0);
    expect(s.handlerErrorsTotal).toBe(0);
    expect(s.lastPollAt).toBeNull();
    expect(s.lastSuccessfulPollAt).toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.lastEventProcessed).toBeNull();
  });

  it("contador de eventos procesados y contador por tipo", () => {
    const state = new RuntimeState();

    state.recordEventProcessed(fakeEvent({ id: "1", type: "chat.message" }));
    state.recordEventProcessed(fakeEvent({ id: "2", type: "chat.message" }));
    state.recordEventProcessed(fakeEvent({ id: "3", type: "session.start" }));

    const s = state.snapshot();
    expect(s.processedEventsTotal).toBe(3);
    expect(s.processedByType["chat.message"]).toBe(2);
    expect(s.processedByType["session.start"]).toBe(1);
  });

  it("recordEventProcessed actualiza lastEventProcessed", () => {
    const state = new RuntimeState();

    state.recordEventProcessed(
      fakeEvent({ id: "100", type: "server.start", event_uuid: "aaaa" }),
    );
    state.recordEventProcessed(
      fakeEvent({ id: "101", type: "chat.message", event_uuid: "bbbb" }),
    );

    const s = state.snapshot();
    expect(s.lastEventProcessed).not.toBeNull();
    expect(s.lastEventProcessed!.id).toBe("101");
    expect(s.lastEventProcessed!.type).toBe("chat.message");
    expect(s.lastEventProcessed!.eventUuid).toBe("bbbb");
    // ISO 8601 parseable.
    expect(new Date(s.lastEventProcessed!.timestamp).getTime()).toBeGreaterThan(0);
  });

  it("contador de unknown events se incrementa por cada evento sin handler", () => {
    const state = new RuntimeState();

    state.recordUnknownEvent(fakeEvent({ type: "tipo.desconocido.a" }));
    state.recordUnknownEvent(fakeEvent({ type: "tipo.desconocido.b" }));
    state.recordUnknownEvent(fakeEvent({ type: "tipo.desconocido.a" }));

    expect(state.snapshot().unknownEventsTotal).toBe(3);
  });

  it("recordPollStarted actualiza lastPollAt sin tocar succeeded", () => {
    const state = new RuntimeState();
    state.recordPollStarted();

    const s = state.snapshot();
    expect(s.lastPollAt).not.toBeNull();
    expect(new Date(s.lastPollAt!).getTime()).toBeGreaterThan(0);
    expect(s.lastSuccessfulPollAt).toBeNull();
  });

  it("recordPollCompleted actualiza lastSuccessfulPollAt", () => {
    const state = new RuntimeState();
    state.recordPollStarted();
    state.recordPollCompleted();

    const s = state.snapshot();
    expect(s.lastSuccessfulPollAt).not.toBeNull();
  });

  it("recordPollFailed incrementa pollingErrorsTotal y registra lastError (scope polling)", () => {
    const state = new RuntimeState();
    const err = Object.assign(new Error("boom red"), { code: "NETWORK" });

    state.recordPollFailed(err);
    state.recordPollFailed(err);

    const s = state.snapshot();
    expect(s.pollingErrorsTotal).toBe(2);
    expect(s.lastError).not.toBeNull();
    expect(s.lastError!.scope).toBe("polling");
    expect(s.lastError!.code).toBe("NETWORK");
    expect(s.lastError!.message).toBe("boom red");
    expect(s.lastError!.eventUuid).toBeUndefined();
    expect(s.lastError!.eventType).toBeUndefined();
  });

  it("recordHandlerFailure incrementa handlerErrorsTotal y atribuye al evento", () => {
    const state = new RuntimeState();
    const event = fakeEvent({
      event_uuid: "aabb-ccdd",
      type: "chat.message",
    });
    const err = Object.assign(new Error("uuid no existe"), {
      code: "PLAYER_NOT_FOUND",
    });

    state.recordHandlerFailure(event, err);

    const s = state.snapshot();
    expect(s.handlerErrorsTotal).toBe(1);
    expect(s.lastError).not.toBeNull();
    expect(s.lastError!.scope).toBe("handler");
    expect(s.lastError!.code).toBe("PLAYER_NOT_FOUND");
    expect(s.lastError!.eventUuid).toBe("aabb-ccdd");
    expect(s.lastError!.eventType).toBe("chat.message");
  });

  it("lastError refleja SIEMPRE el error MÁS reciente (polling o handler)", () => {
    const state = new RuntimeState();

    state.recordPollFailed(
      Object.assign(new Error("primero"), { code: "TIMEOUT" }),
    );
    expect(state.snapshot().lastError!.code).toBe("TIMEOUT");

    state.recordHandlerFailure(
      fakeEvent({ type: "session.start" }),
      Object.assign(new Error("segundo"), { code: "MISSING_PLAYER_UUID" }),
    );
    expect(state.snapshot().lastError!.code).toBe("MISSING_PLAYER_UUID");
    expect(state.snapshot().lastError!.scope).toBe("handler");
  });

  it("extractCode: fallback a err.name si no hay code, y a 'UNKNOWN' si nada", () => {
    const state = new RuntimeState();

    class NamedError extends Error {
      override name = "MyCustomError";
    }
    state.recordPollFailed(new NamedError("sin code"));
    expect(state.snapshot().lastError!.code).toBe("MyCustomError");

    state.recordPollFailed("string suelto");
    expect(state.snapshot().lastError!.code).toBe("UNKNOWN");
  });

  it("snapshot es inmutable: mutar el objeto devuelto NO afecta al estado interno", () => {
    const state = new RuntimeState();
    state.recordEventProcessed(fakeEvent({ type: "chat.message" }));

    const s = state.snapshot();
    expect(() => {
      // El snapshot devuelve un objeto congelado para processedByType.
      (s.processedByType as Record<string, number>)["chat.message"] = 999;
    }).toThrow();

    expect(state.snapshot().processedByType["chat.message"]).toBe(1);
  });

  it("dos snapshots consecutivos no comparten referencias mutables", () => {
    const state = new RuntimeState();
    state.recordEventProcessed(fakeEvent({ type: "chat.message" }));

    const s1 = state.snapshot();
    const s2 = state.snapshot();

    expect(s1).not.toBe(s2);
    expect(s1.processedByType).not.toBe(s2.processedByType);
    expect(s1.processedByType).toEqual(s2.processedByType);
  });

  it("contadores son monótonamente crecientes (no hay decremento)", () => {
    const state = new RuntimeState();
    for (let i = 0; i < 100; i++) {
      state.recordEventProcessed(fakeEvent({ id: String(i) }));
    }
    expect(state.snapshot().processedEventsTotal).toBe(100);
  });
});
