import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { insightRoutes, InsightRoutesDeps } from "../src/routes/insight";

// Tests de GET /insight/server.

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

describe("GET /insight/server", () => {
  it("servidor con eventos: todos los campos poblados", async () => {
    const summaryRow = {
      total_events: "14030",
      distinct_types: "18",
      latest_id: "14030",
    };
    const firstRow = {
      id: "1",
      event_uuid: "aaaaaaaa-0000-4000-8000-000000000001",
      type: "server.start",
      ts: new Date("2026-01-01T00:00:00.000Z"),
    };
    const lastRow = {
      id: "14030",
      event_uuid: "bbbbbbbb-0000-4000-8000-000000014030",
      type: "chat.message",
      ts: new Date("2026-08-01T07:00:00.000Z"),
    };

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [summaryRow] })
      .mockResolvedValueOnce({ rows: [firstRow] })
      .mockResolvedValueOnce({ rows: [lastRow] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/insight/server" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      firstEvent: {
        id: "1",
        event_uuid: "aaaaaaaa-0000-4000-8000-000000000001",
        type: "server.start",
        ts: "2026-01-01T00:00:00.000Z",
      },
      lastEvent: {
        id: "14030",
        event_uuid: "bbbbbbbb-0000-4000-8000-000000014030",
        type: "chat.message",
        ts: "2026-08-01T07:00:00.000Z",
      },
      totalEvents: "14030",
      distinctTypes: "18",
      latestId: "14030",
      timeRangeStart: "2026-01-01T00:00:00.000Z",
      timeRangeEnd: "2026-08-01T07:00:00.000Z",
    });
  });

  it("tabla events vacía: firstEvent y lastEvent = null, contadores = '0'", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            total_events: "0",
            distinct_types: "0",
            latest_id: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/insight/server" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      firstEvent: null,
      lastEvent: null,
      totalEvents: "0",
      distinctTypes: "0",
      latestId: null,
      timeRangeStart: null,
      timeRangeEnd: null,
    });
  });

  it("ejecuta 3 queries: summary + firstEvent + lastEvent", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          { total_events: "0", distinct_types: "0", latest_id: null },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({ method: "GET", url: "/insight/server" });

    expect(query).toHaveBeenCalledTimes(3);
    const sqls = query.mock.calls.map((c) => String(c[0]));
    // La primera es la summary combinada (una sola query con 3 subconsultas).
    expect(sqls[0]).toMatch(/COUNT\(\*\)[\s\S]*COUNT\(DISTINCT type\)[\s\S]*MAX\(id\)/i);
    // La segunda es el primer evento (ORDER BY id ASC LIMIT 1).
    expect(sqls[1]).toMatch(/ORDER BY id ASC[\s\S]*LIMIT 1/i);
    // La tercera es el último evento (ORDER BY id DESC LIMIT 1).
    expect(sqls[2]).toMatch(/ORDER BY id DESC[\s\S]*LIMIT 1/i);
  });

  it("timeRangeStart/End se derivan de first/last event.ts (mismo valor)", async () => {
    const firstTs = new Date("2026-03-01T12:00:00.000Z");
    const lastTs = new Date("2026-08-01T10:00:00.000Z");
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          { total_events: "100", distinct_types: "5", latest_id: "100" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "1", event_uuid: "u1", type: "server.start", ts: firstTs }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "100", event_uuid: "u100", type: "chat.message", ts: lastTs }],
      });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/insight/server" });
    const body = res.json() as {
      firstEvent: { ts: string };
      lastEvent: { ts: string };
      timeRangeStart: string;
      timeRangeEnd: string;
    };

    expect(body.timeRangeStart).toBe(body.firstEvent.ts);
    expect(body.timeRangeEnd).toBe(body.lastEvent.ts);
    expect(body.timeRangeStart).toBe("2026-03-01T12:00:00.000Z");
    expect(body.timeRangeEnd).toBe("2026-08-01T10:00:00.000Z");
  });

  it("endpoint idempotente: dos llamadas devuelven mismo resultado", async () => {
    const summary = { total_events: "5", distinct_types: "2", latest_id: "5" };
    const first = {
      id: "1",
      event_uuid: "u1",
      type: "server.start",
      ts: new Date("2026-01-01T00:00:00.000Z"),
    };
    const last = {
      id: "5",
      event_uuid: "u5",
      type: "chat.message",
      ts: new Date("2026-01-02T00:00:00.000Z"),
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [summary] })
      .mockResolvedValueOnce({ rows: [first] })
      .mockResolvedValueOnce({ rows: [last] })
      .mockResolvedValueOnce({ rows: [summary] })
      .mockResolvedValueOnce({ rows: [first] })
      .mockResolvedValueOnce({ rows: [last] });
    const app = await makeApp({ query });

    const a = await app.inject({ method: "GET", url: "/insight/server" });
    const b = await app.inject({ method: "GET", url: "/insight/server" });

    expect(a.json()).toEqual(b.json());
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/insight/server" });

    expect(res.statusCode).toBe(500);
  });
});
