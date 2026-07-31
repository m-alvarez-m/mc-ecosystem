import { describe, it, expect, afterEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Client } from "discord.js";
import type { Logger } from "pino";
import { startHealthServer } from "../src/health/server";
import { RuntimeState } from "../src/observability";
import type { EventRecord } from "../src/eventstore";

// Tests del Health Server (T7 v1.1).
//
// Arrancan el servidor real sobre puerto efimero (0), hacen GET /health
// via fetch, verifican status y shape. Cero mocks del propio server;
// unicos fakes: Client (isReady) y Logger (silencioso).

function silentLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  } as unknown as Logger;
}

function fakeClient(ready: boolean): Client {
  return {
    isReady: () => ready,
  } as unknown as Client;
}

function fakeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: overrides.id ?? "42",
    event_uuid: overrides.event_uuid ?? "00000000-0000-4000-8000-000000000042",
    type: overrides.type ?? "chat.message",
    v: 1,
    ts: "2026-07-30T00:00:00.000Z",
    received_at: "2026-07-30T00:00:00.010Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data: {},
  };
}

async function requestHealth(
  server: Server,
): Promise<{ status: number; body: unknown }> {
  const addr = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
  const body = (await res.json()) as unknown;
  return { status: res.status, body };
}

let openServers: Server[] = [];

function launch(client: Client, runtimeState: RuntimeState): Server {
  const server = startHealthServer({
    client,
    port: 0, // ephemeral: SO asigna un puerto libre
    logger: silentLogger(),
    runtimeState,
  });
  openServers.push(server);
  return server;
}

async function waitForListening(server: Server): Promise<void> {
  if (server.listening) return;
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
}

afterEach(async () => {
  await Promise.all(
    openServers.map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
        }),
    ),
  );
  openServers = [];
});

describe("startHealthServer · /health", () => {
  it("cliente ready + runtime vacio: 200 con status ok y runtime en cero", async () => {
    const runtime = new RuntimeState();
    const server = launch(fakeClient(true), runtime);
    await waitForListening(server);

    const { status, body } = await requestHealth(server);

    expect(status).toBe(200);
    const b = body as { status: string; runtime: Record<string, unknown> };
    expect(b.status).toBe("ok");
    expect(b.runtime).toBeDefined();
    expect(b.runtime.processedEventsTotal).toBe(0);
    expect(b.runtime.unknownEventsTotal).toBe(0);
    expect(b.runtime.handlerErrorsTotal).toBe(0);
    expect(b.runtime.pollingErrorsTotal).toBe(0);
    expect(b.runtime.lastPollAt).toBeNull();
    expect(b.runtime.lastSuccessfulPollAt).toBeNull();
    expect(b.runtime.lastError).toBeNull();
    expect(b.runtime.lastEventProcessed).toBeNull();
    expect(b.runtime.processedByType).toEqual({});
  });

  it("cliente NO ready: 503 con status not-ready pero incluye runtime igualmente", async () => {
    const runtime = new RuntimeState();
    runtime.recordEventProcessed(fakeEvent({ type: "chat.message" }));
    const server = launch(fakeClient(false), runtime);
    await waitForListening(server);

    const { status, body } = await requestHealth(server);

    expect(status).toBe(503);
    const b = body as { status: string; runtime: Record<string, unknown> };
    expect(b.status).toBe("not-ready");
    expect(b.runtime).toBeDefined();
    expect(b.runtime.processedEventsTotal).toBe(1);
  });

  it("processedEventsTotal y processedByType reflejan el estado actual", async () => {
    const runtime = new RuntimeState();
    runtime.recordEventProcessed(fakeEvent({ id: "1", type: "chat.message" }));
    runtime.recordEventProcessed(fakeEvent({ id: "2", type: "chat.message" }));
    runtime.recordEventProcessed(fakeEvent({ id: "3", type: "session.start" }));

    const server = launch(fakeClient(true), runtime);
    await waitForListening(server);
    const { body } = await requestHealth(server);

    const b = body as { runtime: Record<string, unknown> };
    expect(b.runtime.processedEventsTotal).toBe(3);
    expect(b.runtime.processedByType).toEqual({
      "chat.message": 2,
      "session.start": 1,
    });
  });

  it("unknownEventsTotal se refleja", async () => {
    const runtime = new RuntimeState();
    runtime.recordUnknownEvent(fakeEvent({ type: "unknown.a" }));
    runtime.recordUnknownEvent(fakeEvent({ type: "unknown.b" }));

    const server = launch(fakeClient(true), runtime);
    await waitForListening(server);
    const { body } = await requestHealth(server);

    expect((body as { runtime: { unknownEventsTotal: number } }).runtime.unknownEventsTotal).toBe(
      2,
    );
  });

  it("handlerErrorsTotal se refleja", async () => {
    const runtime = new RuntimeState();
    runtime.recordHandlerFailure(
      fakeEvent({ type: "chat.message" }),
      Object.assign(new Error("boom"), { code: "BOOM" }),
    );

    const server = launch(fakeClient(true), runtime);
    await waitForListening(server);
    const { body } = await requestHealth(server);

    expect(
      (body as { runtime: { handlerErrorsTotal: number } }).runtime.handlerErrorsTotal,
    ).toBe(1);
  });

  it("pollingErrorsTotal se refleja", async () => {
    const runtime = new RuntimeState();
    runtime.recordPollFailed(
      Object.assign(new Error("timeout"), { code: "TIMEOUT" }),
    );

    const server = launch(fakeClient(true), runtime);
    await waitForListening(server);
    const { body } = await requestHealth(server);

    expect(
      (body as { runtime: { pollingErrorsTotal: number } }).runtime.pollingErrorsTotal,
    ).toBe(1);
  });

  it("lastPollAt y lastSuccessfulPollAt se reflejan como ISO 8601", async () => {
    const runtime = new RuntimeState();
    runtime.recordPollStarted();
    runtime.recordPollCompleted();

    const server = launch(fakeClient(true), runtime);
    await waitForListening(server);
    const { body } = await requestHealth(server);

    const r = (body as { runtime: { lastPollAt: string; lastSuccessfulPollAt: string } })
      .runtime;
    expect(typeof r.lastPollAt).toBe("string");
    expect(typeof r.lastSuccessfulPollAt).toBe("string");
    expect(new Date(r.lastPollAt).getTime()).toBeGreaterThan(0);
    expect(new Date(r.lastSuccessfulPollAt).getTime()).toBeGreaterThan(0);
  });

  it("lastError se refleja con scope, code, message, timestamp, eventUuid, eventType", async () => {
    const runtime = new RuntimeState();
    const err = Object.assign(new Error("uuid no existe"), {
      code: "PLAYER_NOT_FOUND",
    });
    runtime.recordHandlerFailure(
      fakeEvent({ type: "chat.message", event_uuid: "aabb-ccdd" }),
      err,
    );

    const server = launch(fakeClient(true), runtime);
    await waitForListening(server);
    const { body } = await requestHealth(server);

    const lastError = (
      body as {
        runtime: {
          lastError: {
            scope: string;
            code: string;
            message: string;
            timestamp: string;
            eventType: string;
            eventUuid: string;
          };
        };
      }
    ).runtime.lastError;

    expect(lastError.scope).toBe("handler");
    expect(lastError.code).toBe("PLAYER_NOT_FOUND");
    expect(lastError.message).toBe("uuid no existe");
    expect(new Date(lastError.timestamp).getTime()).toBeGreaterThan(0);
    expect(lastError.eventType).toBe("chat.message");
    expect(lastError.eventUuid).toBe("aabb-ccdd");
  });

  it("lastError es null cuando nunca ha habido errores", async () => {
    const runtime = new RuntimeState();
    runtime.recordEventProcessed(fakeEvent());

    const server = launch(fakeClient(true), runtime);
    await waitForListening(server);
    const { body } = await requestHealth(server);

    expect((body as { runtime: { lastError: unknown } }).runtime.lastError).toBeNull();
  });

  it("mutar el runtime tras la request NO afecta al snapshot ya enviado", async () => {
    // Verifica el aislamiento: snapshot copia; el response ya se
    // serializo. El estado interno puede evolucionar sin retropropagar.
    const runtime = new RuntimeState();
    const server = launch(fakeClient(true), runtime);
    await waitForListening(server);

    const first = await requestHealth(server);
    expect(
      (first.body as { runtime: { processedEventsTotal: number } }).runtime
        .processedEventsTotal,
    ).toBe(0);

    // Inspeccion adicional: el runtime evoluciona.
    runtime.recordEventProcessed(fakeEvent());

    // Segunda request refleja el nuevo estado.
    const second = await requestHealth(server);
    expect(
      (second.body as { runtime: { processedEventsTotal: number } }).runtime
        .processedEventsTotal,
    ).toBe(1);

    // El primer response NO cambio retroactivamente (los objetos JSON
    // parseados son independientes).
    expect(
      (first.body as { runtime: { processedEventsTotal: number } }).runtime
        .processedEventsTotal,
    ).toBe(0);
  });

  it("snapshot expuesto es inmutable en la fuente (paranoid: mutarlo lanza)", async () => {
    // La invariante clave para consumidores: el snapshot es un objeto
    // congelado — quien lo reciba directamente por API programatica
    // no puede corromper el estado.
    const runtime = new RuntimeState();
    runtime.recordEventProcessed(fakeEvent({ type: "chat.message" }));
    const snap = runtime.snapshot();
    expect(() => {
      (snap.processedByType as Record<string, number>)["chat.message"] = 999;
    }).toThrow();
  });

  it("responde 404 en rutas desconocidas", async () => {
    const server = launch(fakeClient(true), new RuntimeState());
    await waitForListening(server);

    const addr = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/otra-cosa`);
    expect(res.status).toBe(404);
  });

  it("responde 404 tambien a POST /health (solo GET)", async () => {
    const server = launch(fakeClient(true), new RuntimeState());
    await waitForListening(server);

    const addr = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/health`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("Content-Type de la respuesta es application/json", async () => {
    const server = launch(fakeClient(true), new RuntimeState());
    await waitForListening(server);

    const addr = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
