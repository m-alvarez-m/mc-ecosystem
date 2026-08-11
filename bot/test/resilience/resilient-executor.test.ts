import { describe, it, expect, vi } from "vitest";
import type { Logger } from "pino";
import { ResilientExecutor } from "../../src/resilience/resilient-executor";
import { CircuitBreaker } from "../../src/resilience/circuit-breaker";
import { StructuredErrorLogger } from "../../src/resilience/structured-error-logger";
import type { EventRecord } from "../../src/eventstore";

// Tests de integración del executor resiliente. Cubre los escenarios
// del ADR-013 aún no tocados por retry.test.ts y circuit-breaker.test.ts:
//   - circuit_open (evento llega con breaker abierto → DLQ inmediato).
//   - crash_dedupe (dos entregas al executor → DLQ recibe 2 inserts;
//     la UNIQUE es responsabilidad de la DB — el executor sólo llama
//     insert 2 veces y no dedupla en cliente).

const sink = {
  warn: vi.fn(),
  error: vi.fn(),
};

function makeLogger(): Logger {
  // No usamos pino real: sólo necesitamos que el shape sea compatible.
  return sink as unknown as Logger;
}

function mkEvent(id: string, type = "chat.message"): EventRecord {
  return {
    id,
    event_uuid: `00000000-0000-0000-0000-${id.padStart(12, "0")}`,
    type,
    v: 1,
    ts: "2026-08-09T10:00:00.000Z",
    received_at: "2026-08-09T10:00:00.100Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data: { hello: "world" },
  };
}

describe("ADR-013 · circuit_open (integración)", () => {
  it("con breaker forzado open, próximo evento va a DLQ con reason='circuit_open' y cursor puede avanzar", async () => {
    const dlqInsert = vi.fn().mockResolvedValue(undefined);
    const clock = { t: 1_000_000, now: () => 1_000_000 };
    clock.now = () => clock.t;
    const breaker = new CircuitBreaker({ now: clock.now, failureThreshold: 1, windowMs: 60_000, openDurationMs: 60_000 });
    // Fuerza la apertura con un fallo previo.
    breaker.record(false);
    expect(breaker.state()).toBe("open");

    const errorLogger = new StructuredErrorLogger(makeLogger(), "test-1.0.0");
    const executor = new ResilientExecutor({
      breaker,
      dlq: { insert: dlqInsert },
      errorLogger,
      now: clock.now,
    });

    const event = mkEvent("100");
    const handler = vi.fn().mockResolvedValue(undefined);
    const result = await executor.execute(event, handler);

    expect(result).toEqual({ outcome: "dlq", reason: "circuit_open", attempts: 1 });
    expect(handler).not.toHaveBeenCalled(); // el handler NO se invoca
    expect(dlqInsert).toHaveBeenCalledOnce();
    const inserted = dlqInsert.mock.calls[0]![0];
    expect(inserted.reason).toBe("circuit_open");
    expect(inserted.error_type).toBe("circuit_open");
    expect(inserted.event_uuid).toBe(event.event_uuid);
    // event_payload es el snapshot completo del evento (protege ADR-012).
    expect(inserted.event_payload.type).toBe(event.type);
  });
});

describe("ADR-013 · max_retries (integración)", () => {
  it("handler falla las 5 veces → DLQ reason='max_retries' + attempts=5; cursor puede avanzar", async () => {
    const dlqInsert = vi.fn().mockResolvedValue(undefined);
    const breaker = new CircuitBreaker();
    const errorLogger = new StructuredErrorLogger(makeLogger(), "test-1.0.0");
    const executor = new ResilientExecutor({
      breaker,
      dlq: { insert: dlqInsert },
      errorLogger,
      retryOptions: { sleep: async () => undefined, maxAttempts: 5 },
    });
    const event = mkEvent("200");
    const handler = vi.fn().mockRejectedValue(new Error("permaboom"));

    const result = await executor.execute(event, handler);
    expect(result).toEqual({ outcome: "dlq", reason: "max_retries", attempts: 5 });
    expect(handler).toHaveBeenCalledTimes(5);
    expect(dlqInsert).toHaveBeenCalledOnce();
    expect(dlqInsert.mock.calls[0]![0].reason).toBe("max_retries");
    expect(dlqInsert.mock.calls[0]![0].attempts).toBe(5);
  });
});

describe("ADR-013 · crash_dedupe (contrato con UNIQUE)", () => {
  it("mismo evento entra dos veces al executor → dlq.insert se llama 2 veces (dedupe delegado a la UNIQUE)", async () => {
    // Este test documenta la política del ADR: el executor NO
    // dedupla en cliente. La duplicación se neutraliza en la DB con
    // UNIQUE(event_uuid, reason) + ON CONFLICT DO NOTHING (schema
    // 003_dead_letter_events.sql).
    const dlqInsert = vi.fn().mockResolvedValue(undefined);
    const breaker = new CircuitBreaker({ failureThreshold: 100 }); // no abrir
    const errorLogger = new StructuredErrorLogger(makeLogger(), "test-1.0.0");
    const executor = new ResilientExecutor({
      breaker,
      dlq: { insert: dlqInsert },
      errorLogger,
      retryOptions: { sleep: async () => undefined, maxAttempts: 1 },
    });
    const event = mkEvent("300");
    const handler = vi.fn().mockRejectedValue(new Error("perma"));

    await executor.execute(event, handler);
    await executor.execute(event, handler);

    expect(dlqInsert).toHaveBeenCalledTimes(2);
    // Ambas llamadas tienen mismo event_uuid + mismo reason → la
    // UNIQUE del schema hace el segundo INSERT no-op.
    expect(dlqInsert.mock.calls[0]![0].event_uuid).toBe(
      dlqInsert.mock.calls[1]![0].event_uuid,
    );
    expect(dlqInsert.mock.calls[0]![0].reason).toBe(
      dlqInsert.mock.calls[1]![0].reason,
    );
  });
});

describe("ADR-013 · éxito primero (baseline sano)", () => {
  it("handler éxito al primer intento → outcome=success, dlq NO se llama", async () => {
    const dlqInsert = vi.fn().mockResolvedValue(undefined);
    const breaker = new CircuitBreaker();
    const errorLogger = new StructuredErrorLogger(makeLogger(), "test-1.0.0");
    const executor = new ResilientExecutor({
      breaker,
      dlq: { insert: dlqInsert },
      errorLogger,
    });
    const event = mkEvent("400");
    const handler = vi.fn().mockResolvedValue(undefined);

    const result = await executor.execute(event, handler);
    expect(result.outcome).toBe("success");
    expect(dlqInsert).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("ADR-013 · DLQ insert failure propaga (cursor NO avanza)", () => {
  it("si dlq.insert falla, execute lanza DlqWriteFailedError", async () => {
    const dlqInsert = vi.fn().mockRejectedValue(new Error("api down"));
    const breaker = new CircuitBreaker();
    const errorLogger = new StructuredErrorLogger(makeLogger(), "test-1.0.0");
    const executor = new ResilientExecutor({
      breaker,
      dlq: { insert: dlqInsert },
      errorLogger,
      retryOptions: { sleep: async () => undefined, maxAttempts: 1 },
    });
    const event = mkEvent("500");
    const handler = vi.fn().mockRejectedValue(new Error("permaboom"));

    await expect(executor.execute(event, handler)).rejects.toThrow(/DLQ insert falló/);
  });
});
