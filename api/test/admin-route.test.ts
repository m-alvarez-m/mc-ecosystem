import { describe, it, expect, vi } from "vitest";
import Fastify, { FastifyServerOptions } from "fastify";
import addFormats from "ajv-formats";
import { adminRoutes } from "../src/routes/admin";
import type { AdminRoutesDeps } from "../src/routes/admin";

type AjvPlugin = NonNullable<NonNullable<FastifyServerOptions["ajv"]>["plugins"]>[number];

// El pool y el B2 no importan para las semánticas de auth y contrato
// del endpoint; se inyectan fakes mínimos. La ejecución del prune real
// se cubre en prune.test.ts.

function makeFakePool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ min_ts: null }] }),
    connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }),
  };
}

async function makeApp(overrides: Partial<AdminRoutesDeps> = {}) {
  const app = Fastify({
    ajv: { plugins: [addFormats as unknown as AjvPlugin] },
  });
  await app.register(adminRoutes, {
    prunePool: makeFakePool(),
    b2: null,
    dryRun: true,
    retentionMonths: 24,
    b2Bucket: "test",
    b2ArchivePrefix: "archive/events",
    adminToken: "supersecret",
    now: () => new Date("2026-08-08T00:00:00Z"),
    ...overrides,
  });
  return app;
}

describe("POST /admin/events/prune · autenticación", () => {
  it("sin ADMIN_PRUNE_TOKEN configurado → 503", async () => {
    const app = await makeApp({ adminToken: null });
    const res = await app.inject({
      method: "POST",
      url: "/admin/events/prune",
      headers: { "x-admin-token": "cualquier-cosa" },
      payload: {},
    });
    expect(res.statusCode).toBe(503);
  });

  it("sin header X-Admin-Token → 401", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/events/prune",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("token incorrecto → 401", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/events/prune",
      headers: { "x-admin-token": "otro-valor" },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("token de longitud distinta → 401 (rechazo O(1) antes del timingSafeEqual)", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/events/prune",
      headers: { "x-admin-token": "corto" },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("token correcto → 200 con { dry_run: true, results: [] }", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/events/prune",
      headers: { "x-admin-token": "supersecret" },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ dry_run: true, results: [] });
  });
});

describe("POST /admin/events/prune · schema del body", () => {
  it("period con formato inválido → 400", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/events/prune",
      headers: { "x-admin-token": "supersecret" },
      payload: { period: "2024-13" }, // mes 13 no existe
    });
    expect(res.statusCode).toBe(400);
  });

  it("period 'YYYY-MM' válido → 200", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/events/prune",
      headers: { "x-admin-token": "supersecret" },
      payload: { period: "2024-05" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("body vacío (sin period) → 200 · procesa todos los meses vencidos", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/events/prune",
      headers: { "x-admin-token": "supersecret" },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ dry_run: true, results: [] });
  });
});
