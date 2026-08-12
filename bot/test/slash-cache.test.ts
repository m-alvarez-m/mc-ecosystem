import { describe, it, expect, vi } from "vitest";
import { TtlCache } from "../src/slash/cache";

// ADR-016 D6 anti-flakiness: `now` inyectado en el constructor;
// controlamos el tiempo por completo.

describe("TtlCache", () => {
  it("get inicial → null; después de set → valor", () => {
    const cache = new TtlCache<number>(1000, () => new Date(0));
    expect(cache.get()).toBeNull();
    cache.set(42);
    expect(cache.get()).toBe(42);
  });

  it("expira exactamente a los ttlMs (>=, no >)", () => {
    let t = 0;
    const cache = new TtlCache<number>(1000, () => new Date(t));
    cache.set(1);
    t = 999;
    expect(cache.get()).toBe(1);
    t = 1000;
    expect(cache.get()).toBeNull();
  });

  it("getOrCompute: primer llamado computa, segundo dentro de TTL reusa", async () => {
    let t = 0;
    const cache = new TtlCache<number>(1000, () => new Date(t));
    const compute = vi.fn().mockResolvedValue(7);
    const first = await cache.getOrCompute(compute);
    const second = await cache.getOrCompute(compute);
    expect(first).toBe(7);
    expect(second).toBe(7);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("getOrCompute: tras expiración, re-computa", async () => {
    let t = 0;
    const cache = new TtlCache<number>(1000, () => new Date(t));
    const compute = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const first = await cache.getOrCompute(compute);
    t = 2000;
    const second = await cache.getOrCompute(compute);
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("invalidate: fuerza recompute en el siguiente get", () => {
    const cache = new TtlCache<number>(1000, () => new Date(0));
    cache.set(5);
    cache.invalidate();
    expect(cache.get()).toBeNull();
  });
});
