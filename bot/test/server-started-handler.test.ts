import { describe, it, expect, vi } from "vitest";
import { ServerStartedHandler } from "../src/handlers/server-started-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher, PublishPayload } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";

// Tests de ServerStartedHandler.
// Sin Discord, sin red, sin filesystem: solo Publisher fake y contexto
// minimo. Verifica que el handler cumple el contrato EventHandler y
// que respeta la abstraccion (nada de imports de discord.js).

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

// Stub del resolver: este handler NO lo consume; si algo lo llamara
// el test detectaria el bug por el rejected error.
const NEVER_CALLED_RESOLVER = {
  resolve: vi.fn(async () => {
    throw new Error("PlayerNameResolver no debe usarse en server.start");
  }),
} as unknown as import("../src/players").PlayerNameResolver;

function fakeContext(
  publisher: Publisher,
  overrides?: {
    warn?: (obj: unknown, msg?: string) => void;
    freshnessThresholdMs?: number;
    lifecycleState?: {
      get: () => "unknown" | "up" | "down";
      set: (n: "unknown" | "up" | "down") => void;
    };
  },
): DispatchContext {
  return {
    publisher,
    playerNameResolver: NEVER_CALLED_RESOLVER,
    logger: { warn: overrides?.warn ?? (() => undefined) },
    freshnessThresholdMs: overrides?.freshnessThresholdMs ?? 120000,
    lifecycleState: overrides?.lifecycleState ?? { get: () => "unknown" as const, set: () => undefined },
  };
}

function fakeEvent(type: string): EventRecord {
  return {
    id: "42",
    event_uuid: "00000000-0000-4000-8000-000000000042",
    type,
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data: {},
  };
}

describe("ServerStartedHandler", () => {
  it("supports('server.start') devuelve true", () => {
    const h = new ServerStartedHandler();
    expect(h.supports("server.start")).toBe(true);
  });

  it("supports() devuelve false para otros tipos", () => {
    const h = new ServerStartedHandler();
    expect(h.supports("server.stop")).toBe(false);
    expect(h.supports("session.start")).toBe(false);
    expect(h.supports("block.break")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("SERVER.START")).toBe(false); // case-sensitive
  });

  it("handle() invoca publisher.publish() exactamente una vez", async () => {
    const publisher = fakePublisher();
    const h = new ServerStartedHandler();
    await h.handle(fakeContext(publisher), fakeEvent("server.start"));
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("handle() construye el PublishPayload esperado (title + body fijos)", async () => {
    const publisher = fakePublisher();
    const h = new ServerStartedHandler();
    await h.handle(fakeContext(publisher), fakeEvent("server.start"));
    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Servidor iniciado",
      body: "Servidor iniciado correctamente.",
      kind: "server_started",
    });
  });

  it("error del publisher se propaga tal cual (sin envolver)", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const h = new ServerStartedHandler();
    await expect(
      h.handle(fakeContext(publisher), fakeEvent("server.start")),
    ).rejects.toBe(boom);
  });

  it("no depende de Discord: funciona con cualquier Publisher que cumpla la interfaz", async () => {
    // Publisher casero que acumula payloads en un array. Prueba que
    // el handler depende SOLO del contrato Publisher, no de detalles
    // de la implementacion Discord.
    const seen: PublishPayload[] = [];
    const publisher: Publisher = {
      publish: async (p) => {
        seen.push(p);
      },
    };
    const h = new ServerStartedHandler();
    await h.handle(fakeContext(publisher), fakeEvent("server.start"));
    expect(seen).toEqual([
      { title: "Servidor iniciado", body: "Servidor iniciado correctamente.", kind: "server_started" },
    ]);
  });

  // ---------- freshness (BUG-02B) ----------

  it("evento fresco (lag <= threshold): publica normalmente", async () => {
    const publisher = fakePublisher();
    const h = new ServerStartedHandler();
    const event: EventRecord = {
      ...fakeEvent("server.start"),
      ts: "2026-08-02T07:00:00.000Z",
      received_at: "2026-08-02T07:00:00.500Z", // 500 ms
    };
    await h.handle(fakeContext(publisher), event);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("evento obsoleto (lag > threshold): NO publica y emite WARN estructurado", async () => {
    const publisher = fakePublisher();
    const warn = vi.fn();
    const h = new ServerStartedHandler();
    const event: EventRecord = {
      ...fakeEvent("server.start"),
      ts: "2026-08-01T09:00:00.000Z",
      received_at: "2026-08-02T07:00:00.000Z", // ~22h de lag
    };
    await h.handle(fakeContext(publisher, { warn }), event);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const [payload, msg] = warn.mock.calls[0]!;
    const p = payload as Record<string, unknown>;
    expect(p.event_uuid).toBe(event.event_uuid);
    expect(p.id).toBe(event.id);
    expect(p.type).toBe("server.start");
    expect(p.handler).toBe("ServerStartedHandler");
    expect(p.ts).toBe(event.ts);
    expect(p.received_at).toBe(event.received_at);
    expect(typeof p.lag_ms).toBe("number");
    expect(p.threshold_ms).toBe(120000);
    expect(p.motivo).toBe("evento_obsoleto");
    expect(typeof msg).toBe("string");
  });

  it("evento obsoleto: NO lanza excepcion (cursor puede avanzar)", async () => {
    const publisher = fakePublisher();
    const h = new ServerStartedHandler();
    const event: EventRecord = {
      ...fakeEvent("server.start"),
      ts: "2026-08-01T09:00:00.000Z",
      received_at: "2026-08-02T07:00:00.000Z",
    };
    await expect(
      h.handle(fakeContext(publisher), event),
    ).resolves.toBeUndefined();
  });

  it("no lee campos del evento (payload no afecta la publicacion)", async () => {
    // Verificamos que el mensaje es el mismo independientemente del
    // contenido del evento: el handler v1 no consume nada del payload.
    const publisher = fakePublisher();
    const h = new ServerStartedHandler();

    const eventA: EventRecord = { ...fakeEvent("server.start"), id: "1", data: { foo: "bar" } };
    const eventB: EventRecord = { ...fakeEvent("server.start"), id: "2", data: { mc_version: "26.1.2" } };

    await h.handle(fakeContext(publisher), eventA);
    await h.handle(fakeContext(publisher), eventB);

    expect(publisher.publish.mock.calls[0]![0]).toEqual(publisher.publish.mock.calls[1]![0]);
  });

  // ---------- lifecycle state (BUG-02C · defense-in-depth) ----------

  it("estado=up + start fresco: NO publica + WARN duplicado_lifecycle", async () => {
    const publisher = fakePublisher();
    const warn = vi.fn();
    let current: "unknown" | "up" | "down" = "up";
    const lifecycleState = {
      get: () => current,
      set: (n: "unknown" | "up" | "down") => {
        current = n;
      },
    };
    const h = new ServerStartedHandler();
    const event: EventRecord = {
      ...fakeEvent("server.start"),
      ts: "2026-08-02T07:00:00.000Z",
      received_at: "2026-08-02T07:00:00.500Z",
    };
    await h.handle(fakeContext(publisher, { warn, lifecycleState }), event);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.motivo).toBe("duplicado_lifecycle");
    expect(payload.prior_state).toBe("up");
  });

  it("start fresco cuando estado != up: publica y transiciona a 'up'", async () => {
    const publisher = fakePublisher();
    let current: "unknown" | "up" | "down" = "down";
    const lifecycleState = {
      get: () => current,
      set: (n: "unknown" | "up" | "down") => {
        current = n;
      },
    };
    const h = new ServerStartedHandler();
    const event: EventRecord = {
      ...fakeEvent("server.start"),
      ts: "2026-08-02T07:00:00.000Z",
      received_at: "2026-08-02T07:00:00.500Z",
    };
    await h.handle(fakeContext(publisher, { lifecycleState }), event);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(current).toBe("up");
  });

  it("start fresco desde 'unknown' publica y transiciona a 'up'", async () => {
    const publisher = fakePublisher();
    let current: "unknown" | "up" | "down" = "unknown";
    const lifecycleState = {
      get: () => current,
      set: (n: "unknown" | "up" | "down") => {
        current = n;
      },
    };
    const h = new ServerStartedHandler();
    const event: EventRecord = {
      ...fakeEvent("server.start"),
      ts: "2026-08-02T07:00:00.000Z",
      received_at: "2026-08-02T07:00:00.500Z",
    };
    await h.handle(fakeContext(publisher, { lifecycleState }), event);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(current).toBe("up");
  });
});
