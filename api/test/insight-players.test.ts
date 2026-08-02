import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { insightRoutes, InsightRoutesDeps } from "../src/routes/insight";

// Tests de GET /insight/players y GET /insight/player/:uuid.

type AjvPlugin = NonNullable<
  NonNullable<FastifyServerOptions["ajv"]>["plugins"]
>[number];

const UUID = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";
const OTHER_UUID = "9d3a0000-0000-4000-8000-000000000abc";

async function makeApp(pool: InsightRoutesDeps["pool"]) {
  const app = Fastify({
    ajv: { plugins: [addFormats as unknown as AjvPlugin] },
  });
  await app.register(insightRoutes, { pool });
  return app;
}

// -------------------------------------------------------------------
// GET /insight/players
// -------------------------------------------------------------------

describe("GET /insight/players", () => {
  const FROM = "2026-08-01T00:00:00.000Z";

  it("devuelve los 4 conteos calculados por la SQL", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          total_players: "150",
          active_players: "42",
          new_players: "5",
          returning_players: "37",
        },
      ],
    });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/players?from=${FROM}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      totalPlayers: "150",
      activePlayers: "42",
      newPlayers: "5",
      returningPlayers: "37",
    });
  });

  it("servidor vacío: todos los conteos = '0'", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          total_players: "0",
          active_players: "0",
          new_players: "0",
          returning_players: "0",
        },
      ],
    });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/players?from=${FROM}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      totalPlayers: "0",
      activePlayers: "0",
      newPlayers: "0",
      returningPlayers: "0",
    });
  });

  it("SQL calcula las 4 subconsultas en un único query", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          total_players: "0",
          active_players: "0",
          new_players: "0",
          returning_players: "0",
        },
      ],
    });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: `/insight/players?from=${FROM}`,
    });

    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0]!;
    expect(String(sql)).toMatch(/FROM players/i);
    expect(params).toEqual([FROM]);
  });

  it("falta 'from': 400 sin ejecutar SQL", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/players`,
    });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("'from' con formato inválido: 400 sin ejecutar SQL", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/players?from=ayer`,
    });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/players?from=${FROM}`,
    });

    expect(res.statusCode).toBe(500);
  });
});

// -------------------------------------------------------------------
// GET /insight/player/:uuid
// -------------------------------------------------------------------

describe("GET /insight/player/:uuid", () => {
  it("jugador existente con historial completo: 200 con todos los campos", async () => {
    const playerRow = { uuid: UUID, name: "Vancorbus" };
    const nameHistoryRows = [
      { name: "Vancorbus", seen_at: new Date("2026-01-01T00:00:00.000Z") },
      { name: "Miguel862", seen_at: new Date("2026-03-15T00:00:00.000Z") },
    ];
    const firstEventRow = {
      id: "1",
      event_uuid: "aaaaaaaa-0000-4000-8000-000000000001",
      type: "session.start",
      ts: new Date("2026-01-01T10:00:00.000Z"),
    };
    const lastEventRow = {
      id: "9999",
      event_uuid: "aaaaaaaa-0000-4000-8000-000000009999",
      type: "chat.message",
      ts: new Date("2026-07-30T22:00:00.000Z"),
    };
    const groupedRows = [
      { type: "chat.message", count: "500" },
      { type: "block.place", count: "120" },
      { type: "player.death", count: "8" },
    ];

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [playerRow] }) // players
      .mockResolvedValueOnce({ rows: nameHistoryRows }) // player_names
      .mockResolvedValueOnce({ rows: [firstEventRow] }) // first event
      .mockResolvedValueOnce({ rows: [lastEventRow] }) // last event
      .mockResolvedValueOnce({ rows: groupedRows }); // grouped by type

    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/player/${UUID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      uuid: UUID,
      name: "Vancorbus",
      nameHistory: [
        { name: "Vancorbus", seen_at: "2026-01-01T00:00:00.000Z" },
        { name: "Miguel862", seen_at: "2026-03-15T00:00:00.000Z" },
      ],
      firstEvent: {
        id: "1",
        event_uuid: "aaaaaaaa-0000-4000-8000-000000000001",
        type: "session.start",
        ts: "2026-01-01T10:00:00.000Z",
      },
      lastEvent: {
        id: "9999",
        event_uuid: "aaaaaaaa-0000-4000-8000-000000009999",
        type: "chat.message",
        ts: "2026-07-30T22:00:00.000Z",
      },
      totalEvents: "628",
      eventsByType: [
        { type: "chat.message", count: "500" },
        { type: "block.place", count: "120" },
        { type: "player.death", count: "8" },
      ],
    });
  });

  it("jugador existente SIN eventos: firstEvent/lastEvent = null, totalEvents = '0'", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ uuid: OTHER_UUID, name: "Fantasma" }] })
      .mockResolvedValueOnce({ rows: [] }) // sin name history
      .mockResolvedValueOnce({ rows: [] }) // sin first event
      .mockResolvedValueOnce({ rows: [] }) // sin last event
      .mockResolvedValueOnce({ rows: [] }); // sin grouped

    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/player/${OTHER_UUID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      uuid: OTHER_UUID,
      name: "Fantasma",
      nameHistory: [],
      firstEvent: null,
      lastEvent: null,
      totalEvents: "0",
      eventsByType: [],
    });
  });

  it("jugador inexistente: 404 con {error: 'player_not_found'}", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/player/${UUID}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "player_not_found" });
    // Sólo la primera query (players) se ejecuta — no seguimos si no existe.
    expect(query).toHaveBeenCalledOnce();
  });

  it("UUID inválido: 400 sin ejecutar SQL", async () => {
    const query = vi.fn();
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/player/not-a-uuid`,
    });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("totalEvents suma con precisión BigInt (evita overflow de Number)", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ uuid: UUID, name: "N" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { type: "position.sample", count: "9007199254740992" }, // 2^53
          { type: "damage.minute", count: "10" },
        ],
      });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/player/${UUID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { totalEvents: string };
    expect(body.totalEvents).toBe("9007199254741002");
  });

  it("error de base de datos: 500", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/player/${UUID}`,
    });

    expect(res.statusCode).toBe(500);
  });

  it("proyección explícita del jugador: no filtra campos extra", async () => {
    // Aunque la SQL de I1 sólo selecciona {uuid, name}, verificamos que
    // si por accidente un fake incluye otros campos, no leaken al body.
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            uuid: UUID,
            name: "V",
            secret: "leak-attempt",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({
      method: "GET",
      url: `/insight/player/${UUID}`,
    });

    const body = res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("secret");
    expect(Object.keys(body).sort()).toEqual([
      "eventsByType",
      "firstEvent",
      "lastEvent",
      "nameHistory",
      "name",
      "totalEvents",
      "uuid",
    ].sort());
  });
});
