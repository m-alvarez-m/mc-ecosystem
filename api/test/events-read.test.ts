import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { eventRoutes, EventRoutesDeps } from "../src/routes/events";

// Tests de GET /events.
//
// El `pool` se inyecta como fake via el mismo mecanismo que ADR-009
// documenta para dependencias externas del bot: interfaz minima
// (Pick<Pool, "query">) cumplida estructuralmente por un vi.fn().
// Cero Postgres real, cero mock global, cero refactor especulativo.
//
// Los rows del fake replican EXACTAMENTE el shape que pg devuelve:
// - id ya viene como string por el cast `id::text` de la query.
// - ts / received_at son Date de JS (Fastify los serializa a ISO al
//   responder JSON).
// - data ya viene como object (pg parsea JSONB automaticamente).

type AjvPlugin = NonNullable<NonNullable<FastifyServerOptions["ajv"]>["plugins"]>[number];

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
    type: "session.start",
    v: 1,
    ts: new Date("2026-07-27T00:00:00.000Z"),
    received_at: new Date("2026-07-27T00:00:00.010Z"),
    player_uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
    world: "world",
    x: 0,
    y: 64,
    z: 0,
    data: { ip_hash: "abc" },
    ...overrides,
  };
}

// Construye una app Fastify con la misma config de ajv-formats que
// index.ts. Registra eventRoutes con el pool fake que se le pase.
async function makeApp(pool: EventRoutesDeps["pool"]) {
  const app = Fastify({
    ajv: { plugins: [addFormats as unknown as AjvPlugin] },
  });
  await app.register(eventRoutes, { pool });
  return app;
}

describe("GET /events", () => {
  it("sin parametros: devuelve hasta 100 eventos desde el inicio, orden asc por id", async () => {
    const rows = [makeRow("1"), makeRow("2"), makeRow("3")];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/events" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: unknown[]; last_id: string | null };
    expect(body.events).toHaveLength(3);
    expect(body.last_id).toBe("3");

    // Verifica que la SQL recibio los defaults: after_id="0", types=null, limit=100.
    expect(query).toHaveBeenCalledOnce();
    const params = query.mock.calls[0]![1] as [string, string[] | null, number];
    expect(params[0]).toBe("0");
    expect(params[1]).toBeNull();
    expect(params[2]).toBe(100);
  });

  it("after_id: se pasa como string BIGINT al primer parametro", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({ method: "GET", url: "/events?after_id=42" });

    const params = query.mock.calls[0]![1] as [string, string[] | null, number];
    expect(params[0]).toBe("42");
  });

  it("limit: clampeado al maximo (500) sin error", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/events?limit=1000" });

    expect(res.statusCode).toBe(200);
    const params = query.mock.calls[0]![1] as [string, string[] | null, number];
    expect(params[2]).toBe(500);
  });

  it("limit: valor razonable pasa tal cual", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({ method: "GET", url: "/events?limit=25" });

    const params = query.mock.calls[0]![1] as [string, string[] | null, number];
    expect(params[2]).toBe(25);
  });

  it("types: CSV se parsea a array y se pasa al filtro SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({
      method: "GET",
      url: "/events?types=session.start,chat.message",
    });

    const params = query.mock.calls[0]![1] as [string, string[] | null, number];
    expect(params[1]).toEqual(["session.start", "chat.message"]);
  });

  it("lote vacio: events [] y last_id null", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/events?after_id=9999" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [], last_id: null });
  });

  it("id se serializa como STRING en la respuesta (no number)", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [makeRow("12345")] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/events" });
    const body = res.json() as { events: Array<{ id: unknown }> };

    expect(typeof body.events[0]!.id).toBe("string");
    expect(body.events[0]!.id).toBe("12345");
  });

  it("last_id es el id del ultimo evento del batch (ya ordenado asc)", async () => {
    const rows = [makeRow("100"), makeRow("101"), makeRow("102")];
    const query = vi.fn().mockResolvedValue({ rows });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/events" });
    const body = res.json() as { last_id: string | null };

    expect(body.last_id).toBe("102");
  });

  it("orden ascendente: la SQL lleva ORDER BY id ASC", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    await app.inject({ method: "GET", url: "/events" });

    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toMatch(/ORDER BY\s+id\s+ASC/i);
  });

  it("after_id no numerico: 400 sin ejecutar SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/events?after_id=abc" });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("limit cero: 400 sin ejecutar SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/events?limit=0" });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("limit negativo: 400 sin ejecutar SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/events?limit=-5" });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("shape de un evento en la respuesta cumple el contrato del bot", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [makeRow("7")] });
    const app = await makeApp({ query });

    const res = await app.inject({ method: "GET", url: "/events" });
    const body = res.json() as { events: Array<Record<string, unknown>> };
    const evt = body.events[0]!;

    expect(typeof evt.id).toBe("string");
    expect(typeof evt.event_uuid).toBe("string");
    expect(typeof evt.type).toBe("string");
    expect(typeof evt.v).toBe("number");
    expect(typeof evt.ts).toBe("string"); // Fastify serializa Date a ISO
    expect(typeof evt.received_at).toBe("string");
    expect(typeof evt.player_uuid).toBe("string");
    expect(typeof evt.world).toBe("string");
    expect(typeof evt.x).toBe("number");
    expect(typeof evt.data).toBe("object");
    expect(evt.data).not.toBeNull();
  });
});
