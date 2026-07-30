import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { playerRoutes, PlayerRoutesDeps } from "../src/routes/players";

// Tests de GET /players/:uuid.
//
// Endpoint sólo lectura. `pool.query` se inyecta como fake — cero DB
// real. Mismo patrón que los tests de events-read.test.ts.

type AjvPlugin = NonNullable<NonNullable<FastifyServerOptions["ajv"]>["plugins"]>[number];

const PLAYER_UUID = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";

async function makeApp(pool: PlayerRoutesDeps["pool"]) {
  const app = Fastify({
    ajv: { plugins: [addFormats as unknown as AjvPlugin] },
  });
  await app.register(playerRoutes, { pool });
  return app;
}

describe("GET /players/:uuid", () => {
  it("jugador existente: 200 con {uuid, name, first_seen, last_seen}", async () => {
    const row = {
      uuid: PLAYER_UUID,
      name: "Vancorbus",
      first_seen: new Date("2026-07-26T23:25:52.787Z"),
      last_seen: new Date("2026-07-30T00:00:00.000Z"),
    };
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: `/players/${PLAYER_UUID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      uuid: PLAYER_UUID,
      name: "Vancorbus",
      first_seen: "2026-07-26T23:25:52.787Z",
      last_seen: "2026-07-30T00:00:00.000Z",
    });

    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0]!;
    expect(String(sql)).toMatch(/SELECT[\s\S]*FROM players[\s\S]*WHERE uuid/i);
    expect(params).toEqual([PLAYER_UUID]);
  });

  it("jugador inexistente: 404 con {error: 'player_not_found'}", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: `/players/${PLAYER_UUID}` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "player_not_found" });
    // Se consultó la DB (no es un 404 por ruta inexistente).
    expect(query).toHaveBeenCalledOnce();
  });

  it("UUID inválido (no cumple formato): 400 sin ejecutar SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/players/not-a-uuid" });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("error de base de datos: Fastify responde 500", async () => {
    const boom = new Error("db down");
    const query = vi.fn().mockRejectedValue(boom);
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: `/players/${PLAYER_UUID}` });

    expect(res.statusCode).toBe(500);
    expect(query).toHaveBeenCalledOnce();
  });

  it("contrato de respuesta: sólo los 4 campos canónicos (proyección explícita)", async () => {
    // Simula un futuro en el que la tabla players gane columnas: el
    // handler proyecta explícitamente, ninguna columna extra escapa.
    const row = {
      uuid: PLAYER_UUID,
      name: "Vancorbus",
      first_seen: new Date("2026-07-26T23:25:52.787Z"),
      last_seen: new Date("2026-07-30T00:00:00.000Z"),
      internal_secret: "no-debe-filtrarse",
      admin_flag: true,
    };
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: `/players/${PLAYER_UUID}` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["first_seen", "last_seen", "name", "uuid"]);
    expect(body).not.toHaveProperty("internal_secret");
    expect(body).not.toHaveProperty("admin_flag");
  });

  it("path con uuid vacío (/players/): AJV rechaza → 400 sin ejecutar SQL", async () => {
    // Fastify matchea /players/:uuid con uuid="" y AJV rechaza el
    // string vacío por no cumplir el format uuid. No llega al handler.
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/players/" });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});
