import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { insightRoutes, InsightRoutesDeps } from "../src/routes/insight";

// Tests de GET /insight/events/count y GET /insight/events/timeline.
//
// Mismo patrón que test/events-read.test.ts: fake de `pool.query` via
// vi.fn(), cero Postgres real. Los rows del fake replican exactamente
// el shape que devuelve `pg`.

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

// -------------------------------------------------------------------
// GET /insight/events/count
// -------------------------------------------------------------------

describe("GET /insight/events/count", () => {
  const FROM = "2026-08-01T00:00:00.000Z";
  const TO = "2026-08-02T00:00:00.000Z";

  it("sin eventos en el rango: total=0, groupedByType=[]", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/events/count?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ total: "0", groupedByType: [] });
  });

  it("con eventos: suma correctamente el total como BigInt-string", async () => {
    const rows = [
      { type: "chat.message", count: "42" },
      { type: "session.start", count: "10" },
      { type: "player.death", count: "3" },
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/events/count?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      total: "55",
      groupedByType: rows,
    });
  });

  it("total sobrevive valores más allá de Number.MAX_SAFE_INTEGER", async () => {
    // 2^53 + 5 (excede MAX_SAFE_INTEGER si se sumara como Number).
    const rows = [
      { type: "position.sample", count: "9007199254740992" },
      { type: "damage.minute", count: "5" },
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/events/count?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: string };
    expect(body.total).toBe("9007199254740997");
  });

  it("filtro por type: pasa el argumento al repositorio", async () => {
    const rows = [{ type: "chat.message", count: "42" }];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/events/count?from=${FROM}&to=${TO}&type=chat.message`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      total: "42",
      groupedByType: rows,
    });
    const [sql, params] = query.mock.calls[0]!;
    expect(String(sql)).toMatch(/FROM events/i);
    expect(params).toEqual([FROM, TO, "chat.message"]);
  });

  it("sin filtro por type: pasa null al repositorio", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/events/count?from=${FROM}&to=${TO}`,
    });

    const [, params] = query.mock.calls[0]!;
    expect(params).toEqual([FROM, TO, null]);
  });

  it("falta 'from': 400 sin ejecutar SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/events/count?to=${TO}`,
    });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("falta 'to': 400 sin ejecutar SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/events/count?from=${FROM}`,
    });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("'from' con formato inválido: 400 sin ejecutar SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/events/count?from=not-a-date&to=${TO}`,
    });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("type existente y type inexistente devuelven respuestas coherentes", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ type: "chat.message", count: "5" }] })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });

    const existing = await app.inject({
      method: "GET",
      url: `/insight/events/count?from=${FROM}&to=${TO}&type=chat.message`,
    });
    const missing = await app.inject({
      method: "GET",
      url: `/insight/events/count?from=${FROM}&to=${TO}&type=inexistente.evento`,
    });

    expect(existing.json()).toEqual({
      total: "5",
      groupedByType: [{ type: "chat.message", count: "5" }],
    });
    expect(missing.json()).toEqual({ total: "0", groupedByType: [] });
  });

  it("error de base de datos: Fastify responde 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/events/count?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(500);
  });
});

// -------------------------------------------------------------------
// GET /insight/events/timeline
// -------------------------------------------------------------------

describe("GET /insight/events/timeline", () => {
  const FROM = "2026-08-01T00:00:00.000Z";
  const TO = "2026-08-02T00:00:00.000Z";

  interface FakeRow {
    id: string;
    event_uuid: string;
    type: string;
    v: number;
    ts: Date;
    received_at: Date;
    player_uuid: string | null;
    world: string | null;
    x: number | null;
    y: number | null;
    z: number | null;
    data: Record<string, unknown>;
  }

  function makeRow(id: string, overrides: Partial<FakeRow> = {}): FakeRow {
    return {
      id,
      event_uuid: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
      type: "chat.message",
      v: 1,
      ts: new Date(`2026-08-01T00:00:0${id}.000Z`),
      received_at: new Date(`2026-08-01T00:00:0${id}.010Z`),
      player_uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
      world: "world",
      x: 0,
      y: 64,
      z: 0,
      data: { content: `msg ${id}`, length: 5 },
      ...overrides,
    };
  }

  it("timeline vacía: 200 con array vacío", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/events/timeline?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("timeline con datos: devuelve todos los eventos serializados", async () => {
    const rows = [makeRow("1"), makeRow("2"), makeRow("3")];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/events/timeline?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(body).toHaveLength(3);
    expect((body[0] as { id: string }).id).toBe("1");
    expect((body[0] as { ts: string }).ts).toBe("2026-08-01T00:00:01.000Z");
  });

  it("orden cronológico ASC por (ts, id) en la SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/events/timeline?from=${FROM}&to=${TO}`,
    });

    const [sql] = query.mock.calls[0]!;
    expect(String(sql)).toMatch(/ORDER BY ts ASC, id ASC/i);
  });

  it("limit por defecto = 100 cuando no se especifica", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/events/timeline?from=${FROM}&to=${TO}`,
    });

    const [, params] = query.mock.calls[0]!;
    expect(params).toEqual([FROM, TO, 100]);
  });

  it("limit explícito: se respeta si es válido y < MAX", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/events/timeline?from=${FROM}&to=${TO}&limit=25`,
    });

    const [, params] = query.mock.calls[0]!;
    expect(params).toEqual([FROM, TO, 25]);
  });

  it("limit > MAX_TIMELINE_LIMIT (1000): se clampa a 1000", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/events/timeline?from=${FROM}&to=${TO}&limit=99999`,
    });

    const [, params] = query.mock.calls[0]!;
    expect(params).toEqual([FROM, TO, 1000]);
  });

  it("limit=0 o negativo o no-numérico: 400 (schema rechaza)", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    for (const bad of ["0", "-5", "abc", "1.5"]) {
      const res = await app.inject({
        method: "GET",
        url: `/insight/events/timeline?from=${FROM}&to=${TO}&limit=${bad}`,
      });
      expect(res.statusCode, `limit=${bad}`).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("falta 'from' o 'to': 400 sin ejecutar SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const noFrom = await app.inject({
      method: "GET",
      url: `/insight/events/timeline?to=${TO}`,
    });
    const noTo = await app.inject({
      method: "GET",
      url: `/insight/events/timeline?from=${FROM}`,
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
      url: `/insight/events/timeline?from=${FROM}&to=${TO}`,
    });

    expect(res.statusCode).toBe(500);
  });
});
