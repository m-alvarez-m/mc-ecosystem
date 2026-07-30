import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { eventRoutes, EventRoutesDeps } from "../src/routes/events";

// Tests de POST /events centrados en el path transaccional que la
// Etapa 1 añade para session.start con data.name (poblado canónico
// de players + player_names).
//
// El `pool` se inyecta como fake. El path plain usa `pool.query`; el
// path transaccional usa `pool.connect()` para obtener un client con
// su propio `query` y `release`. Cada test provee sólo lo que
// esperamos que la ruta consuma; llamadas inesperadas hacen fallar
// el test.

type AjvPlugin = NonNullable<NonNullable<FastifyServerOptions["ajv"]>["plugins"]>[number];

const PLAYER_UUID = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";

async function makeApp(pool: EventRoutesDeps["pool"]) {
  const app = Fastify({
    ajv: { plugins: [addFormats as unknown as AjvPlugin] },
  });
  await app.register(eventRoutes, { pool });
  return app;
}

// Body válido de session.start. `data.name` opcional para variar entre
// tests que activan el path transaccional y los que no.
function sessionStartBody(overrides: {
  eventUuid?: string;
  playerUuid?: string;
  data?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-000000000001",
    type: "session.start",
    v: 1,
    ts: "2026-07-30T00:00:00.000Z",
    player_uuid: overrides.playerUuid ?? PLAYER_UUID,
    data: overrides.data ?? { ip_hash: "abcd" },
  };
}

// Extrae la lista de SQL (o marcadores como "BEGIN") de un client fake,
// para verificar orden de ejecución sin depender del texto SQL exacto.
function queriesFrom(client: { query: ReturnType<typeof vi.fn> }): string[] {
  return client.query.mock.calls.map((c) => String(c[0]));
}

describe("POST /events · path transaccional (session.start con data.name)", () => {
  it("jugador nuevo: SELECT vacio → UPSERT → INSERT player_names → INSERT events → COMMIT", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT: nuevo jugador
        .mockResolvedValueOnce({ rows: [] }) // UPSERT players
        .mockResolvedValueOnce({ rows: [] }) // INSERT player_names
        .mockResolvedValueOnce({
          rows: [{ id: "42", received_at: "2026-07-30T00:00:00.010Z" }],
        }) // INSERT events
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(client),
    };
    const app = await makeApp(pool);

    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: sessionStartBody({ data: { ip_hash: "abcd", name: "Vancorbus" } }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: "42", received_at: "2026-07-30T00:00:00.010Z" });

    const q = queriesFrom(client);
    expect(q[0]).toBe("BEGIN");
    expect(q[1]).toMatch(/SELECT name FROM players WHERE uuid/);
    expect(q[2]).toMatch(/INSERT INTO players/);
    expect(q[3]).toMatch(/INSERT INTO player_names/);
    expect(q[4]).toMatch(/INSERT INTO events/);
    expect(q[5]).toBe("COMMIT");

    // Verificar que UPSERT y player_names recibieron uuid + name correctos.
    expect(client.query.mock.calls[2]![1]).toEqual([PLAYER_UUID, "Vancorbus"]);
    expect(client.query.mock.calls[3]![1]).toEqual([PLAYER_UUID, "Vancorbus"]);

    expect(client.release).toHaveBeenCalledOnce();
    // pool.query NO se usó — el path transaccional va todo por el client.
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("jugador existente con MISMO nombre: NO inserta en player_names", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ name: "Vancorbus" }] }) // SELECT: mismo nombre
        .mockResolvedValueOnce({ rows: [] }) // UPSERT
        .mockResolvedValueOnce({
          rows: [{ id: "43", received_at: "2026-07-30T00:01:00.000Z" }],
        }) // INSERT events
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(client),
    };
    const app = await makeApp(pool);

    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: sessionStartBody({
        eventUuid: "00000000-0000-4000-8000-000000000002",
        data: { ip_hash: "abcd", name: "Vancorbus" },
      }),
    });

    expect(res.statusCode).toBe(201);
    const q = queriesFrom(client);
    // Exactamente 5 queries: BEGIN, SELECT, UPSERT, INSERT events, COMMIT.
    expect(q).toHaveLength(5);
    expect(q.some((s) => /INSERT INTO player_names/.test(s))).toBe(false);
    expect(q[q.length - 1]).toBe("COMMIT");
  });

  it("jugador existente con NOMBRE DISTINTO (rename): SÍ inserta en player_names con el nuevo nombre", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ name: "OldName" }] }) // SELECT: nombre anterior
        .mockResolvedValueOnce({ rows: [] }) // UPSERT
        .mockResolvedValueOnce({ rows: [] }) // INSERT player_names
        .mockResolvedValueOnce({
          rows: [{ id: "44", received_at: "2026-07-30T00:02:00.000Z" }],
        }) // INSERT events
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(client),
    };
    const app = await makeApp(pool);

    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: sessionStartBody({
        eventUuid: "00000000-0000-4000-8000-000000000003",
        data: { ip_hash: "abcd", name: "NewName" },
      }),
    });

    expect(res.statusCode).toBe(201);
    const q = queriesFrom(client);
    const namesIdx = q.findIndex((s) => /INSERT INTO player_names/.test(s));
    const eventsIdx = q.findIndex((s) => /INSERT INTO events/.test(s));
    expect(namesIdx).toBeGreaterThan(-1);
    expect(namesIdx).toBeLessThan(eventsIdx); // player_names antes que events
    // El nombre insertado en el histórico es el NUEVO.
    expect(client.query.mock.calls[namesIdx]![1]).toEqual([PLAYER_UUID, "NewName"]);
  });

  it("INSERT events falla con 23505 (retry duplicado): ROLLBACK + client.release + responde 409", async () => {
    const dupError = Object.assign(new Error("duplicate key"), { code: "23505" });
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT
        .mockResolvedValueOnce({ rows: [] }) // UPSERT
        .mockResolvedValueOnce({ rows: [] }) // INSERT player_names
        .mockRejectedValueOnce(dupError) // INSERT events falla
        .mockResolvedValueOnce({ rows: [] }), // ROLLBACK
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(client),
    };
    const app = await makeApp(pool);

    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: sessionStartBody({
        eventUuid: "00000000-0000-4000-8000-000000000004",
        data: { ip_hash: "abcd", name: "Vancorbus" },
      }),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "event_uuid ya registrado" });

    const q = queriesFrom(client);
    expect(q[q.length - 1]).toBe("ROLLBACK");
    // No hubo COMMIT.
    expect(q.some((s) => s === "COMMIT")).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("SELECT falla con error genérico: ROLLBACK + release + Fastify responde 500", async () => {
    const boom = new Error("db unreachable");
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(boom) // SELECT falla
        .mockResolvedValueOnce({ rows: [] }), // ROLLBACK
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(client),
    };
    const app = await makeApp(pool);

    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: sessionStartBody({
        eventUuid: "00000000-0000-4000-8000-000000000005",
        data: { ip_hash: "abcd", name: "Vancorbus" },
      }),
    });

    expect(res.statusCode).toBe(500);
    const q = queriesFrom(client);
    expect(q[0]).toBe("BEGIN");
    expect(q).toContain("ROLLBACK");
    expect(q).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe("POST /events · path plain (sin activar la transacción)", () => {
  it("session.start SIN data.name: usa pool.query, NO llama pool.connect", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: "50", received_at: "2026-07-30T00:10:00.000Z" }],
      }),
      connect: vi.fn(),
    };
    const app = await makeApp(pool);

    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: sessionStartBody({
        eventUuid: "00000000-0000-4000-8000-000000000050",
        data: { ip_hash: "abcd" }, // sin name
      }),
    });

    expect(res.statusCode).toBe(201);
    expect(pool.query).toHaveBeenCalledOnce();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("session.start con data.name en whitespace: se trata como ausente → path plain", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: "51", received_at: "2026-07-30T00:11:00.000Z" }],
      }),
      connect: vi.fn(),
    };
    const app = await makeApp(pool);

    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: sessionStartBody({
        eventUuid: "00000000-0000-4000-8000-000000000051",
        data: { ip_hash: "abcd", name: "   " },
      }),
    });

    expect(res.statusCode).toBe(201);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("session.start con data.name no-string: se trata como ausente → path plain", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: "52", received_at: "2026-07-30T00:12:00.000Z" }],
      }),
      connect: vi.fn(),
    };
    const app = await makeApp(pool);

    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: sessionStartBody({
        eventUuid: "00000000-0000-4000-8000-000000000052",
        data: { ip_hash: "abcd", name: 42 },
      }),
    });

    expect(res.statusCode).toBe(201);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("chat.message con data.name presente: NO activa transacción (solo session.start la activa)", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: "53", received_at: "2026-07-30T00:13:00.000Z" }],
      }),
      connect: vi.fn(),
    };
    const app = await makeApp(pool);

    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        event_uuid: "00000000-0000-4000-8000-000000000053",
        type: "chat.message",
        v: 1,
        ts: "2026-07-30T00:13:00.000Z",
        player_uuid: PLAYER_UUID,
        data: { content: "hola", length: 4, name: "Vancorbus" },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(pool.query).toHaveBeenCalledOnce();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("server.start (sin player_uuid): path plain", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: "54", received_at: "2026-07-30T00:14:00.000Z" }],
      }),
      connect: vi.fn(),
    };
    const app = await makeApp(pool);

    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        event_uuid: "00000000-0000-4000-8000-000000000054",
        type: "server.start",
        v: 1,
        ts: "2026-07-30T00:14:00.000Z",
        data: { mc_version: "1.20.4", plugins: [] },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("path plain con 23505: responde 409", async () => {
    const dupError = Object.assign(new Error("dup"), { code: "23505" });
    const pool = {
      query: vi.fn().mockRejectedValue(dupError),
      connect: vi.fn(),
    };
    const app = await makeApp(pool);

    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        event_uuid: "00000000-0000-4000-8000-000000000055",
        type: "chat.message",
        v: 1,
        ts: "2026-07-30T00:15:00.000Z",
        player_uuid: PLAYER_UUID,
        data: { content: "hola", length: 4 },
      },
    });

    expect(res.statusCode).toBe(409);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
