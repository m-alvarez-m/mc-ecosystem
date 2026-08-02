import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { insightRoutes, InsightRoutesDeps } from "../src/routes/insight";

// Tests de los 4 agregados I2:
//   - GET /insight/activity/hourly
//   - GET /insight/activity/daily
//   - GET /insight/players/top
//   - GET /insight/types/top
//
// Mismo patrón que insight-events/players/server: fake pool via vi.fn,
// cero Postgres real.

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
const TO = "2026-08-02T00:00:00.000Z";

// -------------------------------------------------------------------
// GET /insight/activity/hourly
// -------------------------------------------------------------------

describe("GET /insight/activity/hourly", () => {
  it("sin eventos en el rango: array vacío", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/activity/hourly?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("devuelve buckets por hora (0-23) con count como string", async () => {
    const rows = [
      { hour: 0, count: "10" },
      { hour: 12, count: "150" },
      { hour: 23, count: "42" },
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/activity/hourly?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(rows);
  });

  it("SQL agrupa por EXTRACT(HOUR FROM ts) y ordena ASC", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/activity/hourly?from=${FROM}&to=${TO}`,
    });

    const [sql, params] = query.mock.calls[0]!;
    expect(String(sql)).toMatch(/EXTRACT\(HOUR FROM ts\)/i);
    expect(String(sql)).toMatch(/GROUP BY hour/i);
    expect(String(sql)).toMatch(/ORDER BY hour ASC/i);
    expect(params).toEqual([FROM, TO]);
  });

  it("falta 'from' o 'to': 400 sin ejecutar SQL", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });

    const noFrom = await app.inject({
      method: "GET",
      url: `/insight/activity/hourly?to=${TO}`,
    });
    const noTo = await app.inject({
      method: "GET",
      url: `/insight/activity/hourly?from=${FROM}`,
    });

    expect(noFrom.statusCode).toBe(400);
    expect(noTo.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("'from' con formato inválido: 400 sin ejecutar SQL", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/activity/hourly?from=not-a-date&to=${TO}`,
    });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/activity/hourly?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(500);
  });
});

// -------------------------------------------------------------------
// GET /insight/activity/daily
// -------------------------------------------------------------------

describe("GET /insight/activity/daily", () => {
  it("sin eventos: array vacío", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/activity/daily?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("devuelve buckets por día en formato YYYY-MM-DD", async () => {
    const rows = [
      { date: "2026-07-30", count: "1200" },
      { date: "2026-07-31", count: "980" },
      { date: "2026-08-01", count: "1500" },
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/activity/daily?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(rows);
  });

  it("SQL agrupa por date_trunc('day', ts) y ordena ASC", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/activity/daily?from=${FROM}&to=${TO}`,
    });

    const [sql] = query.mock.calls[0]!;
    expect(String(sql)).toMatch(/date_trunc\('day', ts\)/i);
    expect(String(sql)).toMatch(/ORDER BY date_trunc\('day', ts\) ASC/i);
  });

  it("días sin eventos NO aparecen en la respuesta (interpolación del cliente)", async () => {
    // La SQL con GROUP BY sólo emite grupos existentes. El repo no
    // rellena huecos — el consumidor decide si necesita continuidad.
    const rows = [
      { date: "2026-07-30", count: "5" },
      { date: "2026-08-01", count: "3" }, // 2026-07-31 saltado
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/activity/daily?from=${FROM}&to=${TO}`,
    });

    const body = res.json() as { date: string }[];
    expect(body.map((r) => r.date)).toEqual(["2026-07-30", "2026-08-01"]);
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/activity/daily?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(500);
  });
});

// -------------------------------------------------------------------
// GET /insight/players/top
// -------------------------------------------------------------------

describe("GET /insight/players/top", () => {
  const UUID_A = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";
  const UUID_B = "9d3a0000-0000-4000-8000-000000000abc";

  it("sin eventos con player_uuid: array vacío", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/players/top?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("devuelve ranking con uuid + name canónico + count", async () => {
    const rows = [
      { uuid: UUID_A, name: "Vancorbus", count: "1200" },
      { uuid: UUID_B, name: "Miguel", count: "800" },
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/players/top?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(rows);
  });

  it("SQL hace JOIN events + players con GROUP BY uuid/name", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/players/top?from=${FROM}&to=${TO}`,
    });

    const [sql, params] = query.mock.calls[0]!;
    const s = String(sql);
    expect(s).toMatch(/JOIN players/i);
    expect(s).toMatch(/GROUP BY p\.uuid, p\.name/i);
    expect(s).toMatch(/ORDER BY COUNT\(e\.id\) DESC/i);
    // Tie-breaker determinista.
    expect(s).toMatch(/p\.uuid ASC/i);
    expect(params).toEqual([FROM, TO, 10]); // default limit = 10
  });

  it("limit por defecto = 10 cuando no se especifica", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/players/top?from=${FROM}&to=${TO}`,
    });

    const [, params] = query.mock.calls[0]!;
    expect(params).toEqual([FROM, TO, 10]);
  });

  it("limit explícito se respeta si es válido y < MAX", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/players/top?from=${FROM}&to=${TO}&limit=5`,
    });

    const [, params] = query.mock.calls[0]!;
    expect(params).toEqual([FROM, TO, 5]);
  });

  it("limit > MAX_RANKING_LIMIT (100): se clampa a 100", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/players/top?from=${FROM}&to=${TO}&limit=99999`,
    });

    const [, params] = query.mock.calls[0]!;
    expect(params).toEqual([FROM, TO, 100]);
  });

  it("limit=0 / negativo / decimal / no numérico: 400", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });

    for (const bad of ["0", "-1", "1.5", "abc"]) {
      const res = await app.inject({
        method: "GET",
        url: `/insight/players/top?from=${FROM}&to=${TO}&limit=${bad}`,
      });
      expect(res.statusCode, `limit=${bad}`).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("count como string preserva precisión BigInt", async () => {
    const rows = [
      { uuid: UUID_A, name: "N", count: "9007199254740993" }, // >2^53
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/players/top?from=${FROM}&to=${TO}`,
    });

    const body = res.json() as { count: string }[];
    expect(body[0]!.count).toBe("9007199254740993");
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/players/top?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(500);
  });
});

// -------------------------------------------------------------------
// GET /insight/types/top
// -------------------------------------------------------------------

describe("GET /insight/types/top", () => {
  it("sin eventos: array vacío", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/types/top?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("devuelve ranking de tipos con count", async () => {
    const rows = [
      { type: "position.sample", count: "5000" },
      { type: "damage.minute", count: "2000" },
      { type: "chat.message", count: "500" },
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/types/top?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(rows);
  });

  it("SQL agrupa por type y ordena DESC con tie-breaker type ASC", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/types/top?from=${FROM}&to=${TO}&limit=5`,
    });

    const [sql, params] = query.mock.calls[0]!;
    const s = String(sql);
    expect(s).toMatch(/GROUP BY type/i);
    expect(s).toMatch(/ORDER BY COUNT\(\*\) DESC, type ASC/i);
    expect(params).toEqual([FROM, TO, 5]);
  });

  it("limit por defecto = 10 y clamp a 100", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/types/top?from=${FROM}&to=${TO}`,
    });
    expect(query.mock.calls[0]![1]).toEqual([FROM, TO, 10]);

    await app.inject({
      method: "GET",
      url: `/insight/types/top?from=${FROM}&to=${TO}&limit=500`,
    });
    expect(query.mock.calls[1]![1]).toEqual([FROM, TO, 100]);
  });

  it("falta 'from' o 'to': 400 sin ejecutar SQL", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });

    const noFrom = await app.inject({
      method: "GET",
      url: `/insight/types/top?to=${TO}`,
    });
    const noTo = await app.inject({
      method: "GET",
      url: `/insight/types/top?from=${FROM}`,
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
      url: `/insight/types/top?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(500);
  });
});
