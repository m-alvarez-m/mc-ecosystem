import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { dlqRoutes } from "../src/routes/dlq";

// Suite de rutas admin DLQ (ADR-013 D5 + D7 + D8). Cubre:
//   - auth (503 sin token, 401 con token inválido, 200 con token OK).
//   - POST /admin/dlq · inserta vía repo, devuelve {inserted, id}.
//   - GET /admin/dlq/pending-count · devuelve {pending}.
//   - POST /admin/dlq/replay · replay_success + replay_failed.

type AjvPlugin = NonNullable<NonNullable<FastifyServerOptions["ajv"]>["plugins"]>[number];

interface FakeRow {
  id: string;
  event_id: string;
  event_uuid: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  reason: string;
  error_type: string;
  error_message: string;
  attempts: number;
  first_failed_at: string;
  last_failed_at: string;
  replayed_at: string | null;
  created_at: string;
}

// Fake pool minimalista que sólo entiende las 4-5 shapes de SQL que
// el repositorio emite. Vive en el test para no acoplar el runtime.
function makeFakePool(seed: FakeRow[] = []) {
  const rows = [...seed];
  let nextId = 1000;

  async function query(text: string, values: unknown[] = []) {
    if (/INSERT INTO dead_letter_events/i.test(text)) {
      const [event_id, event_uuid, event_type, payloadJson, reason, error_type, error_message, attempts, first_failed_at, last_failed_at] = values as unknown[];
      const conflict = rows.some((r) => r.event_uuid === event_uuid && r.reason === reason);
      if (conflict) return { rows: [] };
      const id = String(nextId++);
      rows.push({
        id,
        event_id: String(event_id),
        event_uuid: String(event_uuid),
        event_type: String(event_type),
        event_payload: JSON.parse(String(payloadJson)) as Record<string, unknown>,
        reason: String(reason),
        error_type: String(error_type),
        error_message: String(error_message),
        attempts: Number(attempts),
        first_failed_at: String(first_failed_at),
        last_failed_at: String(last_failed_at),
        replayed_at: null,
        created_at: new Date().toISOString(),
      });
      return { rows: [{ id }] };
    }
    if (/SELECT count\(\*\)/i.test(text)) {
      const n = rows.filter((r) => r.replayed_at === null).length;
      return { rows: [{ n }] };
    }
    if (/SELECT id::text AS id/i.test(text) && /FROM dead_letter_events/i.test(text)) {
      let out = rows.filter((r) => r.replayed_at === null);
      // Parser laxo de los WHERE que el repo compone.
      if (/id = \$1::bigint/.test(text)) {
        out = out.filter((r) => Number(r.id) === Number(values[0]));
      }
      if (/reason = \$/.test(text)) {
        const reasonIdx = values.findIndex((v) => typeof v === "string" && ["max_retries", "parse_error", "circuit_open", "replay_failed"].includes(String(v)));
        if (reasonIdx >= 0) out = out.filter((r) => r.reason === String(values[reasonIdx]));
      }
      return { rows: out };
    }
    if (/UPDATE dead_letter_events\s+SET replayed_at/i.test(text)) {
      const id = String(values[0]);
      const row = rows.find((r) => r.id === id);
      if (row) row.replayed_at = new Date().toISOString();
      return { rows: [] };
    }
    if (/UPDATE dead_letter_events\s+SET reason = 'replay_failed'/i.test(text)) {
      const id = String(values[0]);
      const errMsg = String(values[1]);
      const row = rows.find((r) => r.id === id);
      if (row) {
        row.reason = "replay_failed";
        row.error_message = errMsg;
        row.last_failed_at = new Date().toISOString();
        row.attempts++;
      }
      return { rows: [] };
    }
    throw new Error("fake pool: SQL no soportado: " + text.slice(0, 80));
  }

  return { query, rows };
}

async function makeApp(overrides: {
  adminToken?: string | null;
  seed?: FakeRow[];
  replayFn?: Parameters<typeof dlqRoutes>[1]["replayFn"];
} = {}) {
  const app = Fastify({
    ajv: { plugins: [addFormats as unknown as AjvPlugin] },
  });
  const pool = makeFakePool(overrides.seed ?? []);
  await app.register(dlqRoutes, {
    dlqPool: pool,
    adminToken: overrides.adminToken === undefined ? "secreto" : overrides.adminToken,
    replayFn: overrides.replayFn,
  });
  return { app, pool };
}

describe("ADR-013 · auth (mismo requireToken en las 3 rutas)", () => {
  it("GET /admin/dlq/pending-count sin ADMIN_DLQ_TOKEN → 503", async () => {
    const { app } = await makeApp({ adminToken: null });
    const res = await app.inject({
      method: "GET",
      url: "/admin/dlq/pending-count",
      headers: { "x-admin-token": "cualquiera" },
    });
    expect(res.statusCode).toBe(503);
  });
  it("GET /admin/dlq/pending-count con token inválido → 401", async () => {
    // Fastify valida body ANTES del handler, así que POST /admin/dlq
    // con body vacío devuelve 400 antes de tocar el auth. Se prueba
    // la auth por la ruta sin body-schema, que ejerce el mismo
    // requireToken.
    const { app } = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/dlq/pending-count",
      headers: { "x-admin-token": "otro" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("ADR-013 · POST /admin/dlq · insert", () => {
  it("inserta fila válida y responde {inserted:true, id}", async () => {
    const { app, pool } = await makeApp();
    const body = {
      event_id: "14173",
      event_uuid: "b6e93a41-1e9d-4dd0-9719-443caf701dbe",
      event_type: "backup.done",
      event_payload: { ok: true, kind: "world", size_mb: 223 },
      reason: "max_retries",
      error_type: "discord_missing_permissions",
      error_message: "Missing Permissions",
      attempts: 5,
      first_failed_at: "2026-08-09T20:00:00.000Z",
      last_failed_at: "2026-08-09T20:00:06.000Z",
    };
    const res = await app.inject({
      method: "POST",
      url: "/admin/dlq",
      headers: { "x-admin-token": "secreto" },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const j = res.json();
    expect(j.inserted).toBe(true);
    expect(j.id).toBeDefined();
    expect(pool.rows).toHaveLength(1);
  });

  it("mismo (event_uuid, reason) dos veces → segundo no-op {inserted:false}", async () => {
    const { app } = await makeApp();
    const body = {
      event_id: "14173",
      event_uuid: "b6e93a41-1e9d-4dd0-9719-443caf701dbe",
      event_type: "backup.done",
      event_payload: {},
      reason: "max_retries",
      error_type: "discord_missing_permissions",
      error_message: "Missing Permissions",
      attempts: 5,
      first_failed_at: "2026-08-09T20:00:00.000Z",
      last_failed_at: "2026-08-09T20:00:06.000Z",
    };
    await app.inject({ method: "POST", url: "/admin/dlq", headers: { "x-admin-token": "secreto" }, payload: body });
    const res2 = await app.inject({
      method: "POST", url: "/admin/dlq", headers: { "x-admin-token": "secreto" }, payload: body,
    });
    expect(res2.statusCode).toBe(201);
    expect(res2.json().inserted).toBe(false);
  });
});

describe("ADR-013 · GET /admin/dlq/pending-count", () => {
  it("devuelve {pending: N} de filas replayed_at IS NULL", async () => {
    const { app } = await makeApp({
      seed: [
        makeRow("1", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        makeRow("2", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
      ],
    });
    const res = await app.inject({
      method: "GET", url: "/admin/dlq/pending-count", headers: { "x-admin-token": "secreto" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pending: 2 });
  });
});

describe("ADR-013 · POST /admin/dlq/replay · replay_success", () => {
  it("replayFn devuelve ok:true → row marcado replayed_at + response {replayed, still_failing:[]}", async () => {
    const seed = [makeRow("10", "10101010-1010-1010-1010-101010101010")];
    const { app, pool } = await makeApp({
      seed,
      replayFn: vi.fn().mockResolvedValue({ ok: true }),
    });
    const res = await app.inject({
      method: "POST", url: "/admin/dlq/replay",
      headers: { "x-admin-token": "secreto" }, payload: {},
    });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.replayed).toBe(1);
    expect(j.still_failing).toEqual([]);
    expect(pool.rows[0]!.replayed_at).not.toBeNull();
  });
});

describe("ADR-013 · POST /admin/dlq/replay · replay_failed", () => {
  it("replayFn devuelve ok:false → row reclasificado replay_failed + response.still_failing tiene la entrada", async () => {
    const seed = [makeRow("20", "20202020-2020-2020-2020-202020202020")];
    const { app, pool } = await makeApp({
      seed,
      replayFn: vi.fn().mockResolvedValue({
        ok: false,
        error: "Discord 500",
        errorType: "discord_5xx",
      }),
    });
    const res = await app.inject({
      method: "POST", url: "/admin/dlq/replay",
      headers: { "x-admin-token": "secreto" }, payload: {},
    });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.replayed).toBe(0);
    expect(j.still_failing).toHaveLength(1);
    expect(j.still_failing[0].error_type).toBe("discord_5xx");
    expect(pool.rows[0]!.reason).toBe("replay_failed");
    expect(pool.rows[0]!.attempts).toBe(6); // 5 originales + 1 del replay fallido
    expect(pool.rows[0]!.replayed_at).toBeNull();
  });
});

describe("ADR-013 · POST /admin/dlq/replay · sin replayFn", () => {
  it("responde 200 con lista de candidatos y note explicativa", async () => {
    const seed = [makeRow("30", "30303030-3030-3030-3030-303030303030")];
    const { app } = await makeApp({ seed });
    const res = await app.inject({
      method: "POST", url: "/admin/dlq/replay",
      headers: { "x-admin-token": "secreto" }, payload: {},
    });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.replayed).toBe(0);
    expect(j.candidates).toHaveLength(1);
    expect(j.note).toMatch(/replayFn no configurado/);
  });
});

// -------- helpers --------

function makeRow(id: string, uuid: string): FakeRow {
  return {
    id,
    event_id: id,
    event_uuid: uuid,
    event_type: "chat.message",
    event_payload: { text: "hola" },
    reason: "max_retries",
    error_type: "discord_5xx",
    error_message: "boom",
    attempts: 5,
    first_failed_at: "2026-08-09T10:00:00Z",
    last_failed_at: "2026-08-09T10:00:06Z",
    replayed_at: null,
    created_at: "2026-08-09T10:00:07Z",
  };
}
