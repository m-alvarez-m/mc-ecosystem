import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { insightRoutes, InsightRoutesDeps } from "../src/routes/insight";

// Tests del Insight Engine (I5): GET /insight/insights y
// GET /insight/insights/:id.
//
// Cada insight compone un signal, cada signal dispara N queries
// contra la DB. Los tests inyectan un fake de pool.query con
// respuestas ordenadas (mockResolvedValueOnce) que reproducen
// exactamente el pipeline signal → repo.

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
const PREVIOUS_FROM = "2026-07-25T00:00:00.000Z";

// Helper: 24 filas del histograma horario con overrides.
function makeHourlyRows(overrides: Record<number, string> = {}) {
  const rows: { hour: number; count: string }[] = [];
  for (let h = 0; h < 24; h++) {
    rows.push({ hour: h, count: overrides[h] ?? "0" });
  }
  return rows;
}

// Ordenes de queries por signal (documentados en signals.ts):
//   activitySignal (6):     4 growth + 2 activity(hourly, daily)
//   explorationSignal (2):  countCurrent + countPrevious
//   economySignal (3):      trading + crafting + progression
//   playersSignal (3):      summary + recurrent + idle

function primeActivitySignal(
  q: ReturnType<typeof vi.fn>,
  opts: {
    curEvents?: string;
    prevEvents?: string;
    curPlayers?: string;
    prevPlayers?: string;
    hourly?: { hour: number; count: string }[];
    daily?: { date: string; count: string }[];
  } = {},
) {
  q.mockResolvedValueOnce({
    rows: [{ total: opts.curEvents ?? "0" }],
  })
    .mockResolvedValueOnce({ rows: [{ total: opts.prevEvents ?? "0" }] })
    .mockResolvedValueOnce({ rows: [{ total: opts.curPlayers ?? "0" }] })
    .mockResolvedValueOnce({ rows: [{ total: opts.prevPlayers ?? "0" }] })
    .mockResolvedValueOnce({ rows: opts.hourly ?? makeHourlyRows() })
    .mockResolvedValueOnce({ rows: opts.daily ?? [] });
}

function primeExplorationSignal(
  q: ReturnType<typeof vi.fn>,
  opts: { current?: string; previous?: string } = {},
) {
  q.mockResolvedValueOnce({
    rows: opts.current
      ? [{ type: "chunk.first_load", count: opts.current }]
      : [],
  }).mockResolvedValueOnce({
    rows: opts.previous
      ? [{ type: "chunk.first_load", count: opts.previous }]
      : [],
  });
}

function primeEconomySignal(
  q: ReturnType<typeof vi.fn>,
  opts: {
    trading?: string;
    crafting?: string;
    progression?: string;
  } = {},
) {
  q.mockResolvedValueOnce({
    rows: opts.trading
      ? [{ type: "villager.trade", count: opts.trading }]
      : [],
  })
    .mockResolvedValueOnce({
      rows: opts.crafting ? [{ type: "item.craft", count: opts.crafting }] : [],
    })
    .mockResolvedValueOnce({
      rows: opts.progression
        ? [{ type: "item.enchant", count: opts.progression }]
        : [],
    });
}

function primePlayersSignal(
  q: ReturnType<typeof vi.fn>,
  opts: {
    total?: string;
    active?: string;
    newP?: string;
    returning?: string;
    recurrent?: string;
    idle?: string;
  } = {},
) {
  q.mockResolvedValueOnce({
    rows: [
      {
        total_players: opts.total ?? "0",
        active_players: opts.active ?? "0",
        new_players: opts.newP ?? "0",
        returning_players: opts.returning ?? "0",
      },
    ],
  })
    .mockResolvedValueOnce({ rows: [{ total: opts.recurrent ?? "0" }] })
    .mockResolvedValueOnce({ rows: [{ total: opts.idle ?? "0" }] });
}

// -------------------------------------------------------------------
// GET /insight/insights (listado)
// -------------------------------------------------------------------

describe("GET /insight/insights", () => {
  it("devuelve 4 insights en orden estable", async () => {
    const query = vi.fn();
    // Orden por listInsights: activity-trend → exploration-trend →
    // economy-focus → player-engagement. Cada insight dispara sus
    // queries en paralelo internamente, pero el orden textual de
    // primeXxxSignal debe coincidir con el orden real de invocación.
    primeActivitySignal(query, {
      curEvents: "1000",
      prevEvents: "800",
      curPlayers: "50",
      prevPlayers: "40",
      hourly: makeHourlyRows({ 12: "500", 21: "500" }),
      daily: [
        { date: "2026-08-01", count: "300" },
        { date: "2026-08-05", count: "500" },
      ],
    });
    primeExplorationSignal(query, { current: "200", previous: "180" });
    primeEconomySignal(query, {
      trading: "50",
      crafting: "100",
      progression: "30",
    });
    primePlayersSignal(query, {
      total: "150",
      active: "80",
      newP: "10",
      returning: "70",
      recurrent: "20",
      idle: "40",
    });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/insights?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; category: string }>;
    expect(body).toHaveLength(4);
    expect(body.map((i) => i.id)).toEqual([
      "activity-trend",
      "exploration-trend",
      "economy-focus",
      "player-engagement",
    ]);
    expect(body.map((i) => i.category)).toEqual([
      "activity",
      "exploration",
      "economy",
      "players",
    ]);
  });

  it("todos los insights comparten el contrato uniforme", async () => {
    const query = vi.fn();
    primeActivitySignal(query, { curEvents: "1000", prevEvents: "800" });
    primeExplorationSignal(query, { current: "100", previous: "50" });
    primeEconomySignal(query, { trading: "10", crafting: "20", progression: "5" });
    primePlayersSignal(query, { total: "100", active: "50", idle: "10" });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/insights?from=${FROM}&to=${TO}`,
    });

    const body = res.json() as Array<Record<string, unknown>>;
    for (const ins of body) {
      expect(Object.keys(ins).sort()).toEqual(
        [
          "category",
          "confidence",
          "evidence",
          "facts",
          "generatedAt",
          "id",
          "metadata",
          "severity",
          "window",
        ].sort(),
      );
      expect(ins.window).toEqual({ from: FROM, to: TO });
      expect(typeof ins.generatedAt).toBe("string");
      expect(String(ins.generatedAt)).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect(Array.isArray(ins.evidence)).toBe(true);
      expect((ins.evidence as unknown[]).length).toBeGreaterThan(0);
      const md = ins.metadata as {
        severityThresholds: Record<string, number>;
        confidenceThresholds: { medium: number; high: number };
        engineVersion: string;
      };
      expect(md.confidenceThresholds).toEqual({ medium: 10, high: 100 });
      expect(md.engineVersion).toBe("1.0");
    }
  });

  it("falta 'from' o 'to': 400 sin ejecutar SQL", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights?to=${TO}`,
    });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(500);
  });
});

// -------------------------------------------------------------------
// GET /insight/insights/:id — activity-trend
// -------------------------------------------------------------------

describe("GET /insight/insights/activity-trend", () => {
  it("severity=normal cuando ratio dentro de ±10%", async () => {
    const query = vi.fn();
    primeActivitySignal(query, {
      curEvents: "1050",
      prevEvents: "1000",
      curPlayers: "50",
      prevPlayers: "50",
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/activity-trend?from=${FROM}&to=${TO}`,
    });
    expect(res.json().severity).toBe("normal");
  });

  it("severity=low para 10-25% de cambio", async () => {
    const query = vi.fn();
    primeActivitySignal(query, {
      curEvents: "1200", // ratio 1.20 → 0.20
      prevEvents: "1000",
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/activity-trend?from=${FROM}&to=${TO}`,
    });
    expect(res.json().severity).toBe("low");
  });

  it("severity=high para 25-50%", async () => {
    const query = vi.fn();
    primeActivitySignal(query, {
      curEvents: "1300", // ratio 1.30 → 0.30
      prevEvents: "1000",
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/activity-trend?from=${FROM}&to=${TO}`,
    });
    expect(res.json().severity).toBe("high");
  });

  it("severity=critical para ≥50%", async () => {
    const query = vi.fn();
    primeActivitySignal(query, {
      curEvents: "2000", // ratio 2.0 → 1.0
      prevEvents: "1000",
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/activity-trend?from=${FROM}&to=${TO}`,
    });
    expect(res.json().severity).toBe("critical");
  });

  it("simétrico: severidad crítica también hacia abajo (ratio 0.4)", async () => {
    const query = vi.fn();
    primeActivitySignal(query, {
      curEvents: "400", // ratio 0.4 → |0.4-1|=0.6
      prevEvents: "1000",
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/activity-trend?from=${FROM}&to=${TO}`,
    });
    expect(res.json().severity).toBe("critical");
  });

  it("confidence=low cuando no hay baseline (previous=0)", async () => {
    const query = vi.fn();
    primeActivitySignal(query, {
      curEvents: "1000",
      prevEvents: "0",
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/activity-trend?from=${FROM}&to=${TO}`,
    });
    const body = res.json();
    expect(body.confidence).toBe("low");
    expect(body.severity).toBe("normal"); // ratio null → normal
    expect(body.facts.trend).toBe("no_baseline");
  });

  it("confidence=high para sample ≥100 con baseline", async () => {
    const query = vi.fn();
    primeActivitySignal(query, {
      curEvents: "500",
      prevEvents: "480",
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/activity-trend?from=${FROM}&to=${TO}`,
    });
    expect(res.json().confidence).toBe("high");
  });

  it("confidence=medium para sample 10-99", async () => {
    const query = vi.fn();
    primeActivitySignal(query, {
      curEvents: "50",
      prevEvents: "45",
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/activity-trend?from=${FROM}&to=${TO}`,
    });
    expect(res.json().confidence).toBe("medium");
  });

  it("facts + evidence tienen la forma esperada", async () => {
    const query = vi.fn();
    primeActivitySignal(query, {
      curEvents: "1000",
      prevEvents: "800",
      curPlayers: "50",
      prevPlayers: "40",
      hourly: makeHourlyRows({ 12: "500" }),
      daily: [{ date: "2026-08-01", count: "500" }],
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/activity-trend?from=${FROM}&to=${TO}`,
    });
    const body = res.json();
    expect(body.facts).toEqual({
      currentEvents: "1000",
      previousEvents: "800",
      totalEventsAbsolute: "200",
      totalEventsRatio: 1.25,
      trend: "up",
      coverageActiveDays: 1,
      coverageTotalDays: 7,
      coverageRatio: 1 / 7,
    });
    expect(body.evidence).toEqual(["activitySignal"]);
  });
});

// -------------------------------------------------------------------
// GET /insight/insights/:id — exploration-trend
// -------------------------------------------------------------------

describe("GET /insight/insights/exploration-trend", () => {
  it("compone facts desde explorationSignal", async () => {
    // 200/180 ≈ 1.111 → cae en la banda "up" (≥ 1.1). Verificamos
    // el shape completo y luego el trend explícito.
    const query = vi.fn();
    primeExplorationSignal(query, { current: "200", previous: "180" });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/exploration-trend?from=${FROM}&to=${TO}`,
    });
    const body = res.json();
    expect(body.id).toBe("exploration-trend");
    expect(body.category).toBe("exploration");
    expect(body.evidence).toEqual(["explorationSignal"]);
    expect(body.facts).toEqual({
      currentChunks: "200",
      previousChunks: "180",
      chunksAbsolute: "20",
      chunksRatio: 200 / 180,
      trend: "up",
    });
  });

  it("ratio dentro de ±10% → trend='flat'", async () => {
    const query = vi.fn();
    primeExplorationSignal(query, { current: "195", previous: "200" });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/exploration-trend?from=${FROM}&to=${TO}`,
    });
    expect(res.json().facts.trend).toBe("flat");
  });

  it("severity=critical cuando exploración se dispara (ratio ≥ 1.5)", async () => {
    const query = vi.fn();
    primeExplorationSignal(query, { current: "500", previous: "100" });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/exploration-trend?from=${FROM}&to=${TO}`,
    });
    expect(res.json().severity).toBe("critical");
  });

  it("confidence=low cuando previous=0 (no_baseline)", async () => {
    const query = vi.fn();
    primeExplorationSignal(query, { current: "100" }); // previous vacío → "0"
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/exploration-trend?from=${FROM}&to=${TO}`,
    });
    const body = res.json();
    expect(body.confidence).toBe("low");
    expect(body.facts.trend).toBe("no_baseline");
  });
});

// -------------------------------------------------------------------
// GET /insight/insights/:id — economy-focus
// -------------------------------------------------------------------

describe("GET /insight/insights/economy-focus", () => {
  it("dominantShare calculado correctamente", async () => {
    const query = vi.fn();
    primeEconomySignal(query, {
      trading: "50",
      crafting: "100",
      progression: "50",
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/economy-focus?from=${FROM}&to=${TO}`,
    });
    const body = res.json();
    expect(body.facts.dominant).toBe("crafting");
    expect(body.facts.dominantShare).toBe(0.5); // 100/200
    expect(body.facts.totalEconomyEvents).toBe("200");
    expect(body.evidence).toEqual(["economySignal"]);
  });

  it("severity=critical con monocultura (share ≥ 0.90)", async () => {
    const query = vi.fn();
    primeEconomySignal(query, {
      trading: "5",
      crafting: "950",
      progression: "45",
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/economy-focus?from=${FROM}&to=${TO}`,
    });
    expect(res.json().severity).toBe("critical");
  });

  it("severity=normal con distribución bien balanceada (share < 0.50)", async () => {
    const query = vi.fn();
    primeEconomySignal(query, {
      trading: "40",
      crafting: "40",
      progression: "20",
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/economy-focus?from=${FROM}&to=${TO}`,
    });
    expect(res.json().severity).toBe("normal"); // 40/100 = 0.4
  });

  it("sin eventos económicos: dominant null, dominantShare null, confidence low", async () => {
    const query = vi.fn();
    primeEconomySignal(query);
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/economy-focus?from=${FROM}&to=${TO}`,
    });
    const body = res.json();
    expect(body.facts.dominant).toBeNull();
    expect(body.facts.dominantShare).toBeNull();
    expect(body.severity).toBe("normal");
    expect(body.confidence).toBe("low");
  });
});

// -------------------------------------------------------------------
// GET /insight/insights/:id — player-engagement
// -------------------------------------------------------------------

describe("GET /insight/insights/player-engagement", () => {
  it("shares calculados desde total", async () => {
    const query = vi.fn();
    primePlayersSignal(query, {
      total: "100",
      active: "40",
      newP: "10",
      returning: "30",
      recurrent: "15",
      idle: "50",
    });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/player-engagement?from=${FROM}&to=${TO}`,
    });
    const body = res.json();
    expect(body.facts.total).toBe("100");
    expect(body.facts.activeShare).toBe(0.4);
    expect(body.facts.newcomersShare).toBe(0.1);
    expect(body.facts.idleShare).toBe(0.5);
    expect(body.evidence).toEqual(["playersSignal"]);
  });

  it("severity=critical cuando idle ≥ 80%", async () => {
    const query = vi.fn();
    primePlayersSignal(query, { total: "100", active: "10", idle: "85" });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/player-engagement?from=${FROM}&to=${TO}`,
    });
    expect(res.json().severity).toBe("critical");
  });

  it("severity=high para idle 60-79%", async () => {
    const query = vi.fn();
    primePlayersSignal(query, { total: "100", active: "30", idle: "65" });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/player-engagement?from=${FROM}&to=${TO}`,
    });
    expect(res.json().severity).toBe("high");
  });

  it("severity=normal cuando active ≥ 40% y idle < 60%", async () => {
    const query = vi.fn();
    primePlayersSignal(query, { total: "100", active: "50", idle: "20" });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/player-engagement?from=${FROM}&to=${TO}`,
    });
    expect(res.json().severity).toBe("normal");
  });

  it("severity=low cuando active < 40% y idle < 60%", async () => {
    const query = vi.fn();
    primePlayersSignal(query, { total: "100", active: "30", idle: "30" });
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/player-engagement?from=${FROM}&to=${TO}`,
    });
    expect(res.json().severity).toBe("low");
  });

  it("total=0: shares null, severity=normal, confidence=low", async () => {
    const query = vi.fn();
    primePlayersSignal(query);
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/player-engagement?from=${FROM}&to=${TO}`,
    });
    const body = res.json();
    expect(body.facts.activeShare).toBeNull();
    expect(body.facts.newcomersShare).toBeNull();
    expect(body.facts.idleShare).toBeNull();
    expect(body.severity).toBe("normal");
    expect(body.confidence).toBe("low");
  });
});

// -------------------------------------------------------------------
// GET /insight/insights/:id — 404
// -------------------------------------------------------------------

describe("GET /insight/insights/:id — validaciones", () => {
  it("id desconocido: 404 con {error: 'insight_not_found'}", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/no-existe?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "insight_not_found" });
    expect(query).not.toHaveBeenCalled();
  });

  it("id vacío: 400 (schema rejects minLength:1)", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("falta 'from' o 'to' con id válido: 400", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/activity-trend`,
    });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("error de base de datos: 500 (id válido, DB falla)", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });
    const res = await app.inject({
      method: "GET",
      url: `/insight/insights/activity-trend?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(500);
  });
});
