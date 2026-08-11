import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "../../src/resilience/circuit-breaker";

// Circuit breaker con sliding window (ADR-013 D2). Cubre 2 escenarios
// centrales:
//   - circuit_open: 5 fallos en 60s dispara open; nuevos requests
//     obtienen shouldAttempt=false.
//   - half_open_recovery: tras 60s open pasa a half_open; el próximo
//     shouldAttempt=true consume el probe; éxito → closed + limpia
//     ventana.

function makeClock(startMs = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

describe("ADR-013 D2 · sliding window · trigger de apertura", () => {
  it("4 fallos en 60s → sigue closed; 5º dispara open", () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ now: clock.now, failureThreshold: 5, windowMs: 60_000 });
    for (let i = 0; i < 4; i++) {
      breaker.record(false);
      clock.advance(1_000);
    }
    expect(breaker.state()).toBe("closed");
    breaker.record(false);
    expect(breaker.state()).toBe("open");
  });

  it("fallos que salen de la ventana no cuentan (rodante)", () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ now: clock.now, failureThreshold: 5, windowMs: 60_000 });
    // 4 fallos, luego 61 segundos, luego 4 fallos más → sigue closed
    // porque los primeros 4 salieron de la ventana.
    for (let i = 0; i < 4; i++) breaker.record(false);
    clock.advance(61_000);
    for (let i = 0; i < 4; i++) breaker.record(false);
    expect(breaker.state()).toBe("closed");
  });
});

describe("ADR-013 D2 · circuit_open", () => {
  it("una vez open, shouldAttempt=false y record no reintenta desde closed", () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ now: clock.now, failureThreshold: 3, windowMs: 60_000, openDurationMs: 60_000 });
    breaker.record(false);
    breaker.record(false);
    breaker.record(false); // trigger
    expect(breaker.state()).toBe("open");
    expect(breaker.shouldAttempt()).toBe(false);
    // Y en open, avanzar 30s no debería reabrir tampoco.
    clock.advance(30_000);
    expect(breaker.state()).toBe("open");
    expect(breaker.shouldAttempt()).toBe(false);
  });
});

describe("ADR-013 D2 · half_open_recovery con evento real", () => {
  it("tras openDurationMs entra half_open; próximo shouldAttempt=true (probe); éxito cierra", () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ now: clock.now, failureThreshold: 3, windowMs: 60_000, openDurationMs: 60_000 });
    breaker.record(false);
    breaker.record(false);
    breaker.record(false); // open
    clock.advance(60_000);
    expect(breaker.state()).toBe("half_open");

    // El primer shouldAttempt en half_open ES el probe → true.
    expect(breaker.shouldAttempt()).toBe(true);
    // Un segundo shouldAttempt concurrente → false (probe en vuelo).
    expect(breaker.shouldAttempt()).toBe(false);

    // Éxito del probe → cierra + limpia ventana.
    breaker.record(true);
    expect(breaker.state()).toBe("closed");
    expect(breaker.snapshot().failuresInWindow).toBe(0);
    expect(breaker.shouldAttempt()).toBe(true);
  });

  it("fallo del probe re-abre 60s más", () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ now: clock.now, failureThreshold: 3, windowMs: 60_000, openDurationMs: 60_000 });
    breaker.record(false);
    breaker.record(false);
    breaker.record(false);
    clock.advance(60_000);
    expect(breaker.shouldAttempt()).toBe(true); // probe consumido
    breaker.record(false); // probe falla
    expect(breaker.state()).toBe("open");
    // Y hay que esperar OTROS 60s antes de half_open otra vez.
    clock.advance(59_000);
    expect(breaker.state()).toBe("open");
    clock.advance(2_000);
    expect(breaker.state()).toBe("half_open");
  });
});
