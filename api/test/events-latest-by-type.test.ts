import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { eventRoutes, EventRoutesDeps } from "../src/routes/events";

// Tests de GET /events/latest_by_type (B.1 · ADR-016).

type AjvPlugin = NonNullable<
  NonNullable<FastifyServerOptions["ajv"]>["plugins"]
>[number];

async function makeApp(pool: Pick<EventRoutesDeps["pool"], "query">) {
  const app = Fastify({
    ajv: { plugins: [addFormats as unknown as AjvPlugin] },
  });
  await app.register(eventRoutes, {
    pool: {
      query: pool.query,
      connect: vi.fn() as unknown as EventRoutesDeps["pool"]["connect"],
    },
  });
  return app;
}

describe("GET /events/latest_by_type", () => {
  it("sin type: responde 400 (type es required)", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: "/events/latest_by_type",
    });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("con type válido y sin limit: query usa limit 1 default y ORDER BY id DESC", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: "/events/latest_by_type?type=server.tps_sample",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [] });
    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("ORDER BY id DESC");
    expect(sql).toContain("LIMIT $2::int");
    expect(params).toEqual(["server.tps_sample", 1]);
  });

  it("con limit válido: clampa a MAX_LIMIT=100 y pasa el int al query", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: "/events/latest_by_type?type=server.tps_sample&limit=50",
    });
    expect(query.mock.calls[0]![1]).toEqual(["server.tps_sample", 50]);

    await app.inject({
      method: "GET",
      url: "/events/latest_by_type?type=server.tps_sample&limit=500",
    });
    // Clamp a 100.
    expect(query.mock.calls[1]![1]).toEqual(["server.tps_sample", 100]);
  });

  it("con rows: devuelve la proyección estándar dentro de {events: [...]}", async () => {
    const rows = [
      {
        id: "42",
        event_uuid: "00000000-0000-4000-8000-000000000042",
        type: "server.tps_sample",
        v: 1,
        ts: new Date("2026-08-11T14:22:15.000Z"),
        received_at: new Date("2026-08-11T14:22:15.010Z"),
        player_uuid: null,
        world: null,
        x: null,
        y: null,
        z: null,
        data: { tps_1m: 19.84 },
      },
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: "/events/latest_by_type?type=server.tps_sample&limit=1",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: unknown[] };
    expect(body.events).toHaveLength(1);
    expect((body.events[0] as { id: string; type: string }).id).toBe("42");
    expect((body.events[0] as { type: string }).type).toBe("server.tps_sample");
  });
});
