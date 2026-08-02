import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { insightRoutes, InsightRoutesDeps } from "../src/routes/insight";

// Tests de los 4 endpoints I3 bajo /insight/patterns/*:
//   - activity: peak/quiet hour + busiest day + coverage
//   - growth: current vs previous period
//   - players: recurrent + idle
//   - streaks: días consecutivos server-wide

type AjvPlugin = NonNullable<
  NonNullable<FastifyServerOptions["ajv"]>["plugins"]
>[number];

async function makeApp(pool: InsightRoutesDeps["pool"]) {
  const app = Fastify({
    ajv: { plugins: [addFormats as unknown as AjvPlugin] },
  });
  await app.register(insightRoutes, { pool });
  return app;
}

const FROM = "2026-08-01T00:00:00.000Z";
const TO = "2026-08-08T00:00:00.000Z"; // 7 días exactos

// -------------------------------------------------------------------
// GET /insight/patterns/activity
// -------------------------------------------------------------------

describe("GET /insight/patterns/activity", () => {
  // Helper que produce las 24 filas de generate_series con count=0
  // por defecto y overrides opcionales por hora.
  function makeHourlyRows(
    overrides: Record<number, string> = {},
  ): { hour: number; count: string }[] {
    const rows: { hour: number; count: string }[] = [];
    for (let h = 0; h < 24; h++) {
      rows.push({ hour: h, count: overrides[h] ?? "0" });
    }
    return rows;
  }

  it("sin eventos en el rango: peakHour null, quietHours=[0..23], totales 0", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: makeHourlyRows() }) // hourly (24 filas con 0)
      .mockResolvedValueOnce({ rows: [] }); // daily
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/activity?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.peakHour).toBeNull();
    expect(body.quietHours).toEqual(
      Array.from({ length: 24 }, (_, i) => i),
    );
    expect(body.busiestDay).toBeNull();
    expect(body.quietestDayWithActivity).toBeNull();
    expect(body.activeDaysCount).toBe(0);
    expect(body.totalEvents).toBe("0");
  });

  it("con actividad: identifica peakHour por count máximo (tie-breaker por hora ASC)", async () => {
    const hourly = makeHourlyRows({
      3: "100",
      5: "50",
      12: "300", // pico
      21: "300", // empate — hora 12 debe ganar (aparece antes en el barrido)
    });
    const daily = [
      { date: "2026-08-03", count: "500" },
      { date: "2026-08-01", count: "250" },
    ];
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: hourly })
      .mockResolvedValueOnce({ rows: daily });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/activity?from=${FROM}&to=${TO}`,
    });

    const body = res.json();
    // El algoritmo del repo elige el PRIMER hallazgo del máximo (strict >),
    // así que empate → gana la hora más baja.
    expect(body.peakHour).toEqual({ hour: 12, count: "300" });
  });

  it("quietHours excluye horas con count > 0", async () => {
    const hourly = makeHourlyRows({
      0: "5",
      6: "10",
      12: "15",
      18: "20",
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: hourly })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/activity?from=${FROM}&to=${TO}`,
    });

    const body = res.json();
    // 20 horas con count=0.
    expect(body.quietHours.length).toBe(20);
    expect(body.quietHours).not.toContain(0);
    expect(body.quietHours).not.toContain(6);
    expect(body.quietHours).not.toContain(12);
    expect(body.quietHours).not.toContain(18);
  });

  it("busiestDay = primer row (DESC por count), quietestDayWithActivity = último", async () => {
    const daily = [
      { date: "2026-08-03", count: "500" },
      { date: "2026-08-01", count: "250" },
      { date: "2026-08-05", count: "10" },
    ];
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: makeHourlyRows({ 12: "760" }) })
      .mockResolvedValueOnce({ rows: daily });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/activity?from=${FROM}&to=${TO}`,
    });

    const body = res.json();
    expect(body.busiestDay).toEqual({ date: "2026-08-03", count: "500" });
    expect(body.quietestDayWithActivity).toEqual({ date: "2026-08-05", count: "10" });
    expect(body.activeDaysCount).toBe(3);
    expect(body.totalEvents).toBe("760");
  });

  it("totalDaysInRange calculado desde ISO strings (from/to)", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: makeHourlyRows() })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/activity?from=${FROM}&to=${TO}`,
    });

    // FROM = 2026-08-01T00:00Z, TO = 2026-08-08T00:00Z → exactamente 7 días.
    expect(res.json().totalDaysInRange).toBe(7);
  });

  it("totalEvents suma con BigInt precisión (evita overflow)", async () => {
    const hourly = makeHourlyRows({
      0: "9007199254740992", // 2^53
      1: "10",
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: hourly })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/activity?from=${FROM}&to=${TO}`,
    });

    expect(res.json().totalEvents).toBe("9007199254741002");
  });

  it("falta 'from': 400 sin ejecutar SQL", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/activity?to=${TO}`,
    });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/activity?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(500);
  });
});

// -------------------------------------------------------------------
// GET /insight/patterns/growth
// -------------------------------------------------------------------

describe("GET /insight/patterns/growth", () => {
  it("calcula período previo con misma duración, contiguo al actual", async () => {
    // 4 queries: countCurrent, countPrevious, playersCurrent, playersPrevious
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: "1000" }] })
      .mockResolvedValueOnce({ rows: [{ total: "800" }] })
      .mockResolvedValueOnce({ rows: [{ total: "50" }] })
      .mockResolvedValueOnce({ rows: [{ total: "40" }] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/growth?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.current).toEqual({
      from: FROM,
      to: TO,
      totalEvents: "1000",
      activePlayers: "50",
    });
    // 7 días antes de FROM = 2026-07-25T00:00:00.000Z
    expect(body.previous.from).toBe("2026-07-25T00:00:00.000Z");
    expect(body.previous.to).toBe(FROM);
    expect(body.previous.totalEvents).toBe("800");
    expect(body.previous.activePlayers).toBe("40");
  });

  it("delta.*Absolute como string (BigInt-safe)", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: "1000" }] })
      .mockResolvedValueOnce({ rows: [{ total: "800" }] })
      .mockResolvedValueOnce({ rows: [{ total: "50" }] })
      .mockResolvedValueOnce({ rows: [{ total: "40" }] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/growth?from=${FROM}&to=${TO}`,
    });

    const body = res.json();
    expect(body.delta.totalEventsAbsolute).toBe("200");
    expect(body.delta.activePlayersAbsolute).toBe("10");
    // Ratios como number:
    expect(body.delta.totalEventsRatio).toBeCloseTo(1.25, 5);
    expect(body.delta.activePlayersRatio).toBeCloseTo(1.25, 5);
  });

  it("delta absoluto negativo cuando el actual es menor que el anterior", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: "300" }] })
      .mockResolvedValueOnce({ rows: [{ total: "800" }] })
      .mockResolvedValueOnce({ rows: [{ total: "20" }] })
      .mockResolvedValueOnce({ rows: [{ total: "40" }] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/growth?from=${FROM}&to=${TO}`,
    });

    const body = res.json();
    expect(body.delta.totalEventsAbsolute).toBe("-500");
    expect(body.delta.activePlayersAbsolute).toBe("-20");
    expect(body.delta.totalEventsRatio).toBeCloseTo(0.375, 5);
  });

  it("previous.totalEvents = 0 → totalEventsRatio null (denominador cero)", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: "100" }] })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: [{ total: "10" }] })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/growth?from=${FROM}&to=${TO}`,
    });

    const body = res.json();
    expect(body.delta.totalEventsRatio).toBeNull();
    expect(body.delta.activePlayersRatio).toBeNull();
    // Absolutos siguen calculándose sin problema:
    expect(body.delta.totalEventsAbsolute).toBe("100");
    expect(body.delta.activePlayersAbsolute).toBe("10");
  });

  it("SQL de players activos usa COUNT(DISTINCT player_uuid) IS NOT NULL", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [{ total: "0" }] });
    const app = await makeApp({ query });
    await app.inject({
      method: "GET",
      url: `/insight/patterns/growth?from=${FROM}&to=${TO}`,
    });
    // 4 queries totales; las 2 de players tienen la forma esperada.
    const sqlAll = query.mock.calls.map((c) => String(c[0]));
    const playerSqls = sqlAll.filter((s) => /COUNT\(DISTINCT player_uuid\)/i.test(s));
    expect(playerSqls.length).toBe(2);
    for (const s of playerSqls) {
      expect(s).toMatch(/player_uuid IS NOT NULL/i);
    }
  });

  it("falta 'from' o 'to': 400", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });
    const noFrom = await app.inject({
      method: "GET",
      url: `/insight/patterns/growth?to=${TO}`,
    });
    const noTo = await app.inject({
      method: "GET",
      url: `/insight/patterns/growth?from=${FROM}`,
    });
    expect(noFrom.statusCode).toBe(400);
    expect(noTo.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/growth?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(500);
  });
});

// -------------------------------------------------------------------
// GET /insight/patterns/players
// -------------------------------------------------------------------

describe("GET /insight/patterns/players", () => {
  it("defaults minActiveDays=3 e idleThresholdDays=30 aplicados", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: "12" }] })
      .mockResolvedValueOnce({ rows: [{ total: "40" }] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/players?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recurrent).toEqual({ count: "12", minActiveDays: 3 });
    expect(body.idle.count).toBe("40");
    expect(body.idle.thresholdDays).toBe(30);
    // cutoff = to - 30 días = 2026-07-09T00:00:00.000Z
    expect(body.idle.cutoff).toBe("2026-07-09T00:00:00.000Z");
  });

  it("acepta override explícito de minActiveDays e idleThresholdDays", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: "5" }] })
      .mockResolvedValueOnce({ rows: [{ total: "100" }] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/players?from=${FROM}&to=${TO}&minActiveDays=7&idleThresholdDays=90`,
    });

    const body = res.json();
    expect(body.recurrent.minActiveDays).toBe(7);
    expect(body.idle.thresholdDays).toBe(90);
    // Verifica también que el minActiveDays llegó a la SQL:
    const recurrentCall = query.mock.calls[0]!;
    expect(recurrentCall[1]).toEqual([FROM, TO, 7]);
    // cutoff = to - 90 días = 2026-05-10T00:00:00.000Z
    expect(body.idle.cutoff).toBe("2026-05-10T00:00:00.000Z");
  });

  it("SQL de recurrentes usa CTE con COUNT(DISTINCT day) >= threshold", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [{ total: "0" }] });
    const app = await makeApp({ query });
    await app.inject({
      method: "GET",
      url: `/insight/patterns/players?from=${FROM}&to=${TO}`,
    });
    const recurrentSql = String(query.mock.calls[0]![0]);
    expect(recurrentSql).toMatch(/WITH player_days AS/i);
    expect(recurrentSql).toMatch(/COUNT\(DISTINCT date_trunc\('day', ts\)\)/i);
    expect(recurrentSql).toMatch(/days_active >= \$3/i);
  });

  it("SQL de idle consulta players.last_seen < cutoff", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [{ total: "0" }] });
    const app = await makeApp({ query });
    await app.inject({
      method: "GET",
      url: `/insight/patterns/players?from=${FROM}&to=${TO}`,
    });
    const idleSql = String(query.mock.calls[1]![0]);
    expect(idleSql).toMatch(/FROM players[\s\S]*WHERE last_seen < \$1/i);
  });

  it("valores 0 devueltos por SQL: contract intact", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/players?from=${FROM}&to=${TO}`,
    });
    const body = res.json();
    expect(body.recurrent.count).toBe("0");
    expect(body.idle.count).toBe("0");
  });

  it("minActiveDays inválido (0/negativo/no-numérico): 400", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });
    for (const bad of ["0", "-1", "abc", "1.5"]) {
      const res = await app.inject({
        method: "GET",
        url: `/insight/patterns/players?from=${FROM}&to=${TO}&minActiveDays=${bad}`,
      });
      expect(res.statusCode, `minActiveDays=${bad}`).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/players?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(500);
  });
});

// -------------------------------------------------------------------
// GET /insight/patterns/streaks
// -------------------------------------------------------------------

describe("GET /insight/patterns/streaks", () => {
  it("sin días con actividad: longestStreak null, totalStreaks 0", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/streaks?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      longestStreak: null,
      totalStreaks: 0,
      activeDaysCount: 0,
    });
  });

  it("un único streak: longestStreak = ese streak", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          start_date: "2026-08-01",
          end_date: "2026-08-05",
          length: 5,
        },
      ],
    });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/streaks?from=${FROM}&to=${TO}`,
    });

    expect(res.json()).toEqual({
      longestStreak: {
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        length: 5,
      },
      totalStreaks: 1,
      activeDaysCount: 5,
    });
  });

  it("varios streaks: longestStreak es el más largo, activeDaysCount suma longitudes", async () => {
    // El repo confía en el ORDER BY length DESC de la SQL, así que
    // el primer row es el más largo. Los fake rows deben respetar ese orden.
    const query = vi.fn().mockResolvedValue({
      rows: [
        { start_date: "2026-07-15", end_date: "2026-07-24", length: 10 },
        { start_date: "2026-08-01", end_date: "2026-08-07", length: 7 },
        { start_date: "2026-08-10", end_date: "2026-08-12", length: 3 },
      ],
    });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/streaks?from=${FROM}&to=${TO}`,
    });

    const body = res.json();
    expect(body.longestStreak).toEqual({
      startDate: "2026-07-15",
      endDate: "2026-07-24",
      length: 10,
    });
    expect(body.totalStreaks).toBe(3);
    expect(body.activeDaysCount).toBe(20);
  });

  it("streak de un solo día: length=1, start=end", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { start_date: "2026-08-03", end_date: "2026-08-03", length: 1 },
      ],
    });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/streaks?from=${FROM}&to=${TO}`,
    });

    expect(res.json().longestStreak).toEqual({
      startDate: "2026-08-03",
      endDate: "2026-08-03",
      length: 1,
    });
  });

  it("SQL usa gaps-and-islands (WITH active_days + grouped + streaks)", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });
    await app.inject({
      method: "GET",
      url: `/insight/patterns/streaks?from=${FROM}&to=${TO}`,
    });
    const sql = String(query.mock.calls[0]![0]);
    expect(sql).toMatch(/WITH active_days AS/i);
    expect(sql).toMatch(/grouped AS/i);
    expect(sql).toMatch(/streaks AS/i);
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER \(ORDER BY d\)/i);
    expect(sql).toMatch(/ORDER BY length DESC, start_date ASC/i);
  });

  it("falta 'from' o 'to': 400", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/streaks?from=${FROM}`,
    });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/patterns/streaks?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(500);
  });
});
