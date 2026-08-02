import { describe, it, expect } from "vitest";
import {
  DEFAULT_FRESHNESS_THRESHOLD_MS,
  computeLagMs,
  isFreshEvent,
} from "../src/handlers/freshness";
import type { EventRecord } from "../src/eventstore";

// Tests del helper de freshness (BUG-02B).
// Sin red, sin Discord, sin logger: pura aritmetica sobre EventRecord.

function eventWith(ts: string, receivedAt: string): EventRecord {
  return {
    id: "1",
    event_uuid: "00000000-0000-4000-8000-000000000001",
    type: "server.stop",
    v: 1,
    ts,
    received_at: receivedAt,
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data: {},
  };
}

describe("DEFAULT_FRESHNESS_THRESHOLD_MS", () => {
  it("es exactamente 120000 (2 minutos) — cota fundamentada en BUG-02A §7", () => {
    expect(DEFAULT_FRESHNESS_THRESHOLD_MS).toBe(120_000);
  });
});

describe("computeLagMs", () => {
  it("devuelve la diferencia received_at - ts en milisegundos", () => {
    const e = eventWith("2026-08-02T07:00:00.000Z", "2026-08-02T07:00:00.500Z");
    expect(computeLagMs(e)).toBe(500);
  });

  it("lag = 0 cuando ts == received_at", () => {
    const e = eventWith("2026-08-02T07:00:00.000Z", "2026-08-02T07:00:00.000Z");
    expect(computeLagMs(e)).toBe(0);
  });

  it("lag grande: dia completo (86_400_000 ms)", () => {
    const e = eventWith("2026-08-01T07:00:00.000Z", "2026-08-02T07:00:00.000Z");
    expect(computeLagMs(e)).toBe(86_400_000);
  });

  it("lag negativo cuando ts es POSTERIOR a received_at (skew de relojes)", () => {
    // No debe pasar en prod (received_at lo pone la DB al insertar); si
    // pasa, devolvemos el numero real para que el llamador decida.
    const e = eventWith("2026-08-02T07:00:00.500Z", "2026-08-02T07:00:00.000Z");
    expect(computeLagMs(e)).toBe(-500);
  });

  it("devuelve null si ts no parsea", () => {
    const e = eventWith("no-es-fecha", "2026-08-02T07:00:00.000Z");
    expect(computeLagMs(e)).toBeNull();
  });

  it("devuelve null si received_at no parsea", () => {
    const e = eventWith("2026-08-02T07:00:00.000Z", "no-es-fecha");
    expect(computeLagMs(e)).toBeNull();
  });
});

describe("isFreshEvent", () => {
  it("fresco cuando lag <= threshold (lag = 0)", () => {
    const e = eventWith("2026-08-02T07:00:00.000Z", "2026-08-02T07:00:00.000Z");
    expect(isFreshEvent(e, 120_000)).toBe(true);
  });

  it("fresco cuando lag EXACTAMENTE en el threshold (borde inclusivo)", () => {
    const e = eventWith("2026-08-02T07:00:00.000Z", "2026-08-02T07:02:00.000Z");
    expect(isFreshEvent(e, 120_000)).toBe(true);
  });

  it("obsoleto cuando lag > threshold por 1 ms", () => {
    const e = eventWith("2026-08-02T07:00:00.000Z", "2026-08-02T07:02:00.001Z");
    expect(isFreshEvent(e, 120_000)).toBe(false);
  });

  it("obsoleto cuando lag = 22 horas (el caso BUG-02)", () => {
    const e = eventWith("2026-08-01T09:08:32.427Z", "2026-08-02T07:01:03.996Z");
    expect(isFreshEvent(e, 120_000)).toBe(false);
  });

  it("fail-open: fresco si ts no parsea (no descartamos por schema malo)", () => {
    const e = eventWith("basura", "2026-08-02T07:00:00.000Z");
    expect(isFreshEvent(e, 120_000)).toBe(true);
  });

  it("fail-open: fresco si received_at no parsea", () => {
    const e = eventWith("2026-08-02T07:00:00.000Z", "basura");
    expect(isFreshEvent(e, 120_000)).toBe(true);
  });

  it("umbral custom: threshold=1000 (1s) filtra lo que 120000 pasa", () => {
    const e = eventWith("2026-08-02T07:00:00.000Z", "2026-08-02T07:00:05.000Z");
    expect(isFreshEvent(e, 120_000)).toBe(true);
    expect(isFreshEvent(e, 1_000)).toBe(false);
  });
});
