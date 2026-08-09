import { describe, it, expect, vi } from "vitest";
import { startScheduler } from "../src/prune/scheduler";
import type { PrunePool } from "../src/prune/prune";

// El scheduler es un tick horario con guardián in-process. Se prueba
// por control de tiempo: se instancia con setInterval fake y se
// invoca `tick(now)` con distintas fechas.

function makeIdlePool(): PrunePool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ min_ts: null }] }),
    connect: vi
      .fn()
      .mockResolvedValue({ query: vi.fn(), release: vi.fn() }) as unknown as PrunePool["connect"],
  };
}

describe("ADR-012 · scheduler", () => {
  it("día 2, 04:00 UTC → NO dispara", async () => {
    const pool = makeIdlePool();
    const sched = startScheduler({
      pool,
      runOptions: {
        dryRun: true,
        b2: null,
        b2Bucket: "test",
        b2ArchivePrefix: "archive/events",
      },
      setIntervalImpl: () => ({ unref: () => undefined }) as unknown as NodeJS.Timeout,
    });
    const r = await sched.tick(new Date("2026-08-02T04:00:00Z"));
    expect(r.ran).toBe(false);
    sched.stop();
  });

  it("día 1, 03:00 UTC → NO dispara (hora incorrecta)", async () => {
    const pool = makeIdlePool();
    const sched = startScheduler({
      pool,
      runOptions: {
        dryRun: true,
        b2: null,
        b2Bucket: "test",
        b2ArchivePrefix: "archive/events",
      },
      setIntervalImpl: () => ({ unref: () => undefined }) as unknown as NodeJS.Timeout,
    });
    const r = await sched.tick(new Date("2026-08-01T03:00:00Z"));
    expect(r.ran).toBe(false);
    sched.stop();
  });

  it("día 1, 04:00 UTC → dispara UNA vez y no re-dispara ese mismo mes", async () => {
    const pool = makeIdlePool();
    let firedCount = 0;
    const sched = startScheduler({
      pool,
      runOptions: {
        dryRun: true,
        b2: null,
        b2Bucket: "test",
        b2ArchivePrefix: "archive/events",
      },
      setIntervalImpl: () => ({ unref: () => undefined }) as unknown as NodeJS.Timeout,
      onTick: (info) => {
        if (info.ran) firedCount++;
      },
    });
    const r1 = await sched.tick(new Date("2026-08-01T04:00:00Z"));
    const r2 = await sched.tick(new Date("2026-08-01T04:30:00Z"));
    expect(r1.ran).toBe(true);
    expect(r2.ran).toBe(false); // mismo mes: guardián in-process
    expect(firedCount).toBe(1);
    sched.stop();
  });

  it("mes siguiente vuelve a disparar", async () => {
    const pool = makeIdlePool();
    const sched = startScheduler({
      pool,
      runOptions: {
        dryRun: true,
        b2: null,
        b2Bucket: "test",
        b2ArchivePrefix: "archive/events",
      },
      setIntervalImpl: () => ({ unref: () => undefined }) as unknown as NodeJS.Timeout,
    });
    const r1 = await sched.tick(new Date("2026-08-01T04:00:00Z"));
    const r2 = await sched.tick(new Date("2026-09-01T04:00:00Z"));
    expect(r1.ran).toBe(true);
    expect(r2.ran).toBe(true);
    sched.stop();
  });
});
