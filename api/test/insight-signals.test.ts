import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { insightRoutes, InsightRoutesDeps } from "../src/routes/insight";

// Tests de los 4 endpoints I4 bajo /insight/signals/*:
//   - activity: compone growthPatterns + activityPatterns
//   - exploration: compone countEvents (I1) x 2 (current/previous)
//   - economy: compone countEvents (I1) x 3 (trading/crafting/progression)
//   - players: compone playersSummary (I1) + playerPatterns (I3)
//
// Los tests inyectan un fake de pool.query con respuestas ordenadas
// por el orden de invocación esperado. Cada Signal se sabe qué
// queries dispara (documentado en signals.ts).

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
const PREVIOUS_FROM = "2026-07-25T00:00:00.000Z"; // FROM - 7 días

// Helper: 24 filas del histograma horario con overrides.
function makeHourlyRows(overrides: Record<number, string> = {}) {
  const rows: { hour: number; count: string }[] = [];
  for (let h = 0; h < 24; h++) {
    rows.push({ hour: h, count: overrides[h] ?? "0" });
  }
  return rows;
}

// -------------------------------------------------------------------
// GET /insight/signals/activity
// -------------------------------------------------------------------

describe("GET /insight/signals/activity", () => {
  // activitySignal dispara 6 queries (paralelo entre growth y
  // activityPatterns, pero cada una es varias sub-queries):
  //   growthPatterns    → 4 queries (countCurrent, countPrevious,
  //                       playersCurrent, playersPrevious)
  //   activityPatterns  → 2 queries (hourly con generate_series,
  //                       daily con GROUP BY)
  // Con Promise.all interno cada bloque, el orden en el fake es
  // determinístico por el orden textual de las llamadas.

  function primeQueryFake(query: ReturnType<typeof vi.fn>) {
    // Orden esperado (Promise.all interna del repo):
    //   1. growth.countCurrent
    //   2. growth.countPrevious
    //   3. growth.playersCurrent
    //   4. growth.playersPrevious
    // + Promise.all externa entre growth y activity → 5-6:
    //   5. activity.hourly
    //   6. activity.daily
    query
      .mockResolvedValueOnce({ rows: [{ total: "1000" }] })
      .mockResolvedValueOnce({ rows: [{ total: "800" }] })
      .mockResolvedValueOnce({ rows: [{ total: "50" }] })
      .mockResolvedValueOnce({ rows: [{ total: "40" }] })
      .mockResolvedValueOnce({ rows: makeHourlyRows({ 12: "500", 21: "500" }) })
      .mockResolvedValueOnce({
        rows: [
          { date: "2026-08-01", count: "300" },
          { date: "2026-08-02", count: "200" },
          { date: "2026-08-05", count: "500" },
        ],
      });
  }

  it("compone current + previous + delta + trend + coverage", async () => {
    const query = vi.fn();
    primeQueryFake(query);
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/activity?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.window).toEqual({ from: FROM, to: TO });
    expect(body.current).toEqual({
      from: FROM,
      to: TO,
      totalEvents: "1000",
      activePlayers: "50",
    });
    expect(body.previous).toEqual({
      from: PREVIOUS_FROM,
      to: FROM,
      totalEvents: "800",
      activePlayers: "40",
    });
    expect(body.delta.totalEventsAbsolute).toBe("200");
    expect(body.delta.totalEventsRatio).toBeCloseTo(1.25, 5);
    expect(body.delta.activePlayersAbsolute).toBe("10");

    // trend con thresholds visibles
    expect(body.trend).toBe("up"); // ratio 1.25 >= 1.1
    expect(body.trendThresholds).toEqual({ up: 1.1, down: 0.9 });

    // coverage: 3 días con actividad en un rango de 7
    expect(body.coverage.activeDaysCount).toBe(3);
    expect(body.coverage.totalDaysInRange).toBe(7);
    expect(body.coverage.ratio).toBeCloseTo(3 / 7, 5);
  });

  it.each([
    { ratio: "up", cur: "1200", prev: "1000", expected: "up" },
    { ratio: "down", cur: "800", prev: "1000", expected: "down" },
    { ratio: "flat", cur: "1050", prev: "1000", expected: "flat" },
    { ratio: "boundary-up", cur: "1100", prev: "1000", expected: "up" }, // exactly 1.1
    { ratio: "boundary-down", cur: "900", prev: "1000", expected: "down" }, // exactly 0.9
  ])("trend $ratio → $expected", async ({ cur, prev, expected }) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: cur }] })
      .mockResolvedValueOnce({ rows: [{ total: prev }] })
      .mockResolvedValueOnce({ rows: [{ total: "10" }] })
      .mockResolvedValueOnce({ rows: [{ total: "10" }] })
      .mockResolvedValueOnce({ rows: makeHourlyRows() })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/activity?from=${FROM}&to=${TO}`,
    });
    expect(res.json().trend).toBe(expected);
  });

  it("previous.totalEvents = 0 → trend 'no_baseline'", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: "500" }] })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: [{ total: "5" }] })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: makeHourlyRows() })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/activity?from=${FROM}&to=${TO}`,
    });
    expect(res.json().trend).toBe("no_baseline");
    expect(res.json().delta.totalEventsRatio).toBeNull();
  });

  it("totalDaysInRange = 0 → coverage.ratio = 0 (evita división por cero)", async () => {
    // Rango degenerado: from == to (0 días)
    const sameInstant = "2026-08-01T00:00:00.000Z";
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: makeHourlyRows() })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/activity?from=${sameInstant}&to=${sameInstant}`,
    });
    expect(res.json().coverage.ratio).toBe(0);
  });

  it("falta 'from' o 'to': 400 sin ejecutar SQL", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/activity?from=${FROM}`,
    });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/activity?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(500);
  });
});

// -------------------------------------------------------------------
// GET /insight/signals/exploration
// -------------------------------------------------------------------

describe("GET /insight/signals/exploration", () => {
  // explorationSignal dispara 2 queries: countEvents(current) y
  // countEvents(previous), ambas filtradas por type='chunk.first_load'.
  // countEvents devuelve rows = [{type, count}] → total se calcula
  // sumando en el repo.

  it("compone current + previous + delta + trend + thresholds", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ type: "chunk.first_load", count: "500" }],
      })
      .mockResolvedValueOnce({
        rows: [{ type: "chunk.first_load", count: "400" }],
      });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/exploration?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      current: { from: FROM, to: TO, chunksExplored: "500" },
      previous: { from: PREVIOUS_FROM, to: FROM, chunksExplored: "400" },
      delta: { absolute: "100", ratio: 1.25 },
      trend: "up",
      trendThresholds: { up: 1.1, down: 0.9 },
    });
  });

  it("current sin chunks (rows vacías): total 0, trend derivado del previous", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // sin chunks en current
      .mockResolvedValueOnce({
        rows: [{ type: "chunk.first_load", count: "100" }],
      });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/exploration?from=${FROM}&to=${TO}`,
    });

    const body = res.json();
    expect(body.current.chunksExplored).toBe("0");
    expect(body.previous.chunksExplored).toBe("100");
    expect(body.delta.absolute).toBe("-100");
    expect(body.delta.ratio).toBe(0);
    expect(body.trend).toBe("down");
  });

  it("ambos vacíos: trend 'no_baseline'", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/exploration?from=${FROM}&to=${TO}`,
    });

    const body = res.json();
    expect(body.delta.absolute).toBe("0");
    expect(body.delta.ratio).toBeNull();
    expect(body.trend).toBe("no_baseline");
  });

  it("SQL filtra por type='chunk.first_load' en las 2 llamadas", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });
    await app.inject({
      method: "GET",
      url: `/insight/signals/exploration?from=${FROM}&to=${TO}`,
    });
    expect(query).toHaveBeenCalledTimes(2);
    for (const call of query.mock.calls) {
      const params = call[1] as unknown[];
      expect(params[2]).toBe("chunk.first_load");
    }
  });

  it("falta 'from': 400 sin ejecutar SQL", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/exploration?to=${TO}`,
    });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/exploration?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(500);
  });
});

// -------------------------------------------------------------------
// GET /insight/signals/economy
// -------------------------------------------------------------------

describe("GET /insight/signals/economy", () => {
  // Orden de llamadas: trading → crafting → progression (Promise.all
  // preserva orden textual con vi.fn.mockResolvedValueOnce).

  it("compone las 3 dimensiones + dominant + total", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ type: "villager.trade", count: "50" }] })
      .mockResolvedValueOnce({ rows: [{ type: "item.craft", count: "100" }] })
      .mockResolvedValueOnce({
        rows: [{ type: "item.enchant", count: "30" }],
      });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/economy?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      window: { from: FROM, to: TO },
      trading: { type: "villager.trade", totalEvents: "50" },
      crafting: { type: "item.craft", totalEvents: "100" },
      progression: { type: "item.enchant", totalEvents: "30" },
      dominant: "crafting", // 100 > 50 > 30
      totalEconomyEvents: "180",
    });
  });

  it("empate entre crafting y trading: gana crafting (alfabético)", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ type: "villager.trade", count: "50" }] })
      .mockResolvedValueOnce({ rows: [{ type: "item.craft", count: "50" }] })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/economy?from=${FROM}&to=${TO}`,
    });

    expect(res.json().dominant).toBe("crafting");
  });

  it("empate triple: gana crafting (crafting < progression < trading alfabético)", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ type: "villager.trade", count: "10" }] })
      .mockResolvedValueOnce({ rows: [{ type: "item.craft", count: "10" }] })
      .mockResolvedValueOnce({ rows: [{ type: "item.enchant", count: "10" }] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/economy?from=${FROM}&to=${TO}`,
    });

    expect(res.json().dominant).toBe("crafting");
  });

  it("sin eventos económicos: dominant null, total 0", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/economy?from=${FROM}&to=${TO}`,
    });

    const body = res.json();
    expect(body.dominant).toBeNull();
    expect(body.totalEconomyEvents).toBe("0");
    expect(body.trading.totalEvents).toBe("0");
    expect(body.crafting.totalEvents).toBe("0");
    expect(body.progression.totalEvents).toBe("0");
  });

  it("SQL filtra por los 3 types correctos en el orden esperado", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });
    await app.inject({
      method: "GET",
      url: `/insight/signals/economy?from=${FROM}&to=${TO}`,
    });
    const typeParams = query.mock.calls.map((c) => (c[1] as unknown[])[2]);
    expect(typeParams).toEqual(["villager.trade", "item.craft", "item.enchant"]);
  });

  it("totalEconomyEvents con BigInt precision", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ type: "villager.trade", count: "9007199254740992" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/economy?from=${FROM}&to=${TO}`,
    });

    expect(res.json().totalEconomyEvents).toBe("9007199254740992");
    expect(res.json().dominant).toBe("trading");
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/economy?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(500);
  });
});

// -------------------------------------------------------------------
// GET /insight/signals/players
// -------------------------------------------------------------------

describe("GET /insight/signals/players", () => {
  // playersSignal dispara 3 queries en Promise.all:
  //   1. playersSummary (1 query con 4 subqueries)
  //   2. playerPatterns.recurrent (1 query con CTE)
  //   3. playerPatterns.idle (1 query sobre players)

  it("compone playersSummary + recurrent + idle en un snapshot", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            total_players: "150",
            active_players: "60",
            new_players: "10",
            returning_players: "50",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: "20" }] }) // recurrent
      .mockResolvedValueOnce({ rows: [{ total: "70" }] }); // idle
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/players?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.window).toEqual({ from: FROM, to: TO });
    expect(body.total).toBe("150");
    expect(body.active).toBe("60");
    expect(body.newcomers).toBe("10");
    expect(body.returning).toBe("50");
    expect(body.recurrent).toEqual({ count: "20", minActiveDays: 3 });
    expect(body.idle.count).toBe("70");
    expect(body.idle.thresholdDays).toBe(30);
    // cutoff = to - 30 días = 2026-07-09T00:00:00.000Z
    expect(body.idle.cutoff).toBe("2026-07-09T00:00:00.000Z");
  });

  it("acepta override de minActiveDays e idleThresholdDays", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            total_players: "0",
            active_players: "0",
            new_players: "0",
            returning_players: "0",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: "5" }] })
      .mockResolvedValueOnce({ rows: [{ total: "100" }] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/players?from=${FROM}&to=${TO}&minActiveDays=7&idleThresholdDays=90`,
    });

    const body = res.json();
    expect(body.recurrent.minActiveDays).toBe(7);
    expect(body.idle.thresholdDays).toBe(90);
    // cutoff = to - 90 días = 2026-05-10T00:00:00.000Z
    expect(body.idle.cutoff).toBe("2026-05-10T00:00:00.000Z");
    // Verifica también que el minActiveDays llegó al SQL de recurrent:
    const recurrentCall = query.mock.calls[1]!;
    expect(recurrentCall[1]).toEqual([FROM, TO, 7]);
  });

  it("dispara 3 queries (playersSummary + recurrent + idle)", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            total_players: "0",
            active_players: "0",
            new_players: "0",
            returning_players: "0",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/signals/players?from=${FROM}&to=${TO}`,
    });

    expect(query).toHaveBeenCalledTimes(3);
    const sqls = query.mock.calls.map((c) => String(c[0]));
    // La primera es playersSummary con las 4 subconsultas.
    expect(sqls[0]).toMatch(/total_players|active_players|new_players|returning_players/i);
    // La segunda es la CTE de recurrentes.
    expect(sqls[1]).toMatch(/WITH player_days AS/i);
    // La tercera es la consulta idle sobre players.
    expect(sqls[2]).toMatch(/FROM players[\s\S]*WHERE last_seen/i);
  });

  it("minActiveDays inválido: 400 sin ejecutar SQL", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/players?from=${FROM}&to=${TO}&minActiveDays=0`,
    });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/signals/players?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(500);
  });
});
