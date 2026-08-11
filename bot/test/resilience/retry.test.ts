import { describe, it, expect, vi } from "vitest";
import { computeDelayMs, retryWithBackoff } from "../../src/resilience/retry";

// Retry con backoff exponencial + jitter independiente (ADR-013 D1).
// Se prueban 2 escenarios centrales del ADR:
//   - max_retries: fallo persistente → agota 5 intentos y devuelve ok:false.
//   - retry_success: fallo transitorio → éxito antes del tope.
// Además: computeDelayMs con random inyectable para verificar la
// fórmula base·2^(n-1), el cap y el ±25% de jitter.

describe("ADR-013 D1 · computeDelayMs", () => {
  it("random=0.5 (jitter=0) devuelve el delay base·2^(n-1)", () => {
    const opts = { baseDelayMs: 200, capMs: 30_000, jitterRatio: 0.25, random: () => 0.5 };
    expect(computeDelayMs(1, opts)).toBe(200);
    expect(computeDelayMs(2, opts)).toBe(400);
    expect(computeDelayMs(3, opts)).toBe(800);
    expect(computeDelayMs(4, opts)).toBe(1600);
    expect(computeDelayMs(5, opts)).toBe(3200);
  });

  it("cap de 30s aplica antes del jitter", () => {
    const opts = { baseDelayMs: 200, capMs: 30_000, jitterRatio: 0.25, random: () => 0.5 };
    // attempt 9 → 200·2^8 = 51200, capado a 30000, sin jitter = 30000.
    expect(computeDelayMs(9, opts)).toBe(30_000);
  });

  it("random=0 aplica jitter negativo ~-25%; random=1 aplica ~+25%", () => {
    const optsNeg = { baseDelayMs: 400, capMs: 30_000, jitterRatio: 0.25, random: () => 0 };
    const optsPos = { baseDelayMs: 400, capMs: 30_000, jitterRatio: 0.25, random: () => 0.999999 };
    // attempt 2 base = 800. jitterRatio=0.25 → ±200.
    expect(computeDelayMs(2, optsNeg)).toBe(600); // 800·(1-0.25)
    expect(computeDelayMs(2, optsPos)).toBeGreaterThanOrEqual(999);
    expect(computeDelayMs(2, optsPos)).toBeLessThanOrEqual(1000);
  });
});

describe("ADR-013 D1 · retryWithBackoff · max_retries", () => {
  it("fn falla las 5 veces → ok:false, attempts=5, err es el último", async () => {
    const err = new Error("boom");
    const fn = vi.fn().mockRejectedValue(err);
    const onRetry = vi.fn();
    const result = await retryWithBackoff(fn, {
      sleep: async () => undefined,
      onRetry,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(5);
      expect(result.err).toBe(err);
    }
    // onRetry se invoca sólo entre intentos, no después del último → 4 veces.
    expect(onRetry).toHaveBeenCalledTimes(4);
    expect(fn).toHaveBeenCalledTimes(5);
  });
});

describe("ADR-013 D1 · retryWithBackoff · retry_success", () => {
  it("fn falla 2 veces, éxito al 3er intento → ok:true, attempts=3, value correcto", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("blip 1"))
      .mockRejectedValueOnce(new Error("blip 2"))
      .mockResolvedValueOnce("hola");
    const result = await retryWithBackoff(fn, { sleep: async () => undefined });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(3);
      expect(result.value).toBe("hola");
    }
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
