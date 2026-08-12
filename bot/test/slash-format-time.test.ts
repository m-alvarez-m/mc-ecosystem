import { describe, it, expect } from "vitest";
import {
  formatAbsolute,
  formatDurationMs,
  formatRelative,
  formatRelativeOrAbsolute,
} from "../src/slash/format-time";

// ADR-016 D6 anti-flakiness: `now` inyectado como argumento en todas
// las llamadas. Cero dependencia de Date.now real.

describe("formatRelative", () => {
  it.each([
    [500, "hace 0s"],
    [1_000, "hace 1s"],
    [59_000, "hace 59s"],
    [60_000, "hace 1m"],
    [59 * 60_000, "hace 59m"],
    [60 * 60_000, "hace 1h"],
    [(3 * 60 + 12) * 60_000, "hace 3h 12m"],
    [24 * 60 * 60_000 - 1, "hace 23h 59m"],
  ])("diffMs=%i → %s", (diffMs, expected) => {
    expect(formatRelative(diffMs)).toBe(expected);
  });

  it("diffMs negativo → 'en el futuro'", () => {
    expect(formatRelative(-1)).toBe("en el futuro");
  });
});

describe("formatAbsolute · America/Monterrey", () => {
  it("2026-11-08 21:32 UTC-6 (Monterrey) → 'sáb 8 nov a las 21:32'", () => {
    // 2026-11-08 03:32:00 UTC = 2026-11-08 21:32:00 Monterrey (UTC-6)
    // Nota: DST en Monterrey terminó en 2022 (no aplica ajuste estacional).
    const instant = new Date("2026-11-09T03:32:00.000Z");
    const s = formatAbsolute(instant);
    expect(s).toMatch(/\d+ nov a las 21:32/);
  });

  it("acepta timeZone custom", () => {
    const instant = new Date("2026-08-11T14:20:00.000Z");
    const s = formatAbsolute(instant, "UTC");
    expect(s).toContain("14:20");
  });
});

describe("formatRelativeOrAbsolute · bifurcación 24h", () => {
  const now = new Date("2026-08-11T15:00:00.000Z");
  it("< 24h → relativo", () => {
    const instant = new Date("2026-08-11T12:48:00.000Z"); // hace 2h 12m
    expect(formatRelativeOrAbsolute(instant, now)).toBe("hace 2h 12m");
  });
  it(">= 24h → absoluto", () => {
    const instant = new Date("2026-08-10T14:59:59.999Z"); // hace >24h
    const s = formatRelativeOrAbsolute(instant, now);
    // No es relativo (no empieza con "hace"), es absoluto.
    expect(s).not.toMatch(/^hace/);
    expect(s).toMatch(/a las \d{2}:\d{2}/);
  });
});

describe("formatDurationMs", () => {
  it.each([
    [-1, "0s"],
    [500, "0s"],
    [1_000, "1s"],
    [59_000, "59s"],
    [60_000, "1m"],
    [60 * 60_000, "1h"],
    [(3 * 60 + 12) * 60_000, "3h 12m"],
    [24 * 60 * 60_000, "1d"],
    [(24 * 60 + 30) * 60_000, "1d"], // 24.5h → 1d (30m se pierde por diseño)
    [((2 * 24) + 5) * 60 * 60_000, "2d 5h"],
  ])("ms=%i → %s", (ms, expected) => {
    expect(formatDurationMs(ms)).toBe(expected);
  });
});
