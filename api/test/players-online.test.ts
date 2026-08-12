import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { playersOnlineRoutes } from "../src/routes/players-online";

// Tests de GET /players/online (B.1 · ADR-016).
//
// Mismo patrón que events-read.test.ts: pool fake vía Pick<Pool, "query">
// cumplido por vi.fn(). Cero Postgres real. Los rows del fake replican
// el shape que devuelve la query real (uuid string, name string,
// session_start_ts Date).

type AjvPlugin = NonNullable<
  NonNullable<FastifyServerOptions["ajv"]>["plugins"]
>[number];

interface OnlineRow {
  uuid: string;
  name: string;
  session_start_ts: Date;
}

async function makeApp(query: ReturnType<typeof vi.fn>) {
  const app = Fastify({
    ajv: { plugins: [addFormats as unknown as AjvPlugin] },
  });
  await app.register(playersOnlineRoutes, { pool: { query } });
  return app;
}

describe("GET /players/online", () => {
  it("sin jugadores online: responde 200 con players vacío", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp(query);

    const res = await app.inject({ method: "GET", url: "/players/online" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ players: [] });
  });

  it("con jugadores online: devuelve proyección {uuid, name, session_start_ts} en orden recibido", async () => {
    const rows: OnlineRow[] = [
      {
        uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
        name: "Vancorbus",
        session_start_ts: new Date("2026-08-11T14:20:00.000Z"),
      },
      {
        uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        name: "Pacman26",
        session_start_ts: new Date("2026-08-11T14:55:12.000Z"),
      },
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp(query);

    const res = await app.inject({ method: "GET", url: "/players/online" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      players: { uuid: string; name: string; session_start_ts: string }[];
    };
    expect(body.players).toHaveLength(2);
    expect(body.players[0]).toEqual({
      uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
      name: "Vancorbus",
      session_start_ts: "2026-08-11T14:20:00.000Z",
    });
    expect(body.players[1]!.name).toBe("Pacman26");
  });

  it("query SQL: filtra por type IN (session.start, session.end), joinea players, ordena ASC", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp(query);

    await app.inject({ method: "GET", url: "/players/online" });

    expect(query).toHaveBeenCalledOnce();
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toContain("'session.start'");
    expect(sql).toContain("'session.end'");
    expect(sql).toContain("JOIN players p");
    expect(sql).toContain("ORDER BY starts.last_start ASC");
    // El filtro clave: last_start > COALESCE(last_end, -infinity).
    expect(sql).toContain("HAVING");
    expect(sql).toContain("'-infinity'::timestamptz");
  });

  it("propaga errores del pool sin envolverlos (Fastify → 500 default)", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db offline"));
    const app = await makeApp(query);

    const res = await app.inject({ method: "GET", url: "/players/online" });

    expect(res.statusCode).toBe(500);
  });
});
