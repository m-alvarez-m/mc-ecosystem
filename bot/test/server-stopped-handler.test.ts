import { describe, it, expect, vi } from "vitest";
import { ServerStoppedHandler } from "../src/handlers/server-stopped-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher, PublishPayload } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";

// Tests de ServerStoppedHandler.
// Sin Discord, sin red, sin filesystem: Publisher fake + contexto
// minimo. Verifica que el handler cumple EventHandler y respeta la
// abstraccion.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

const NEVER_CALLED_RESOLVER = {
  resolve: vi.fn(async () => {
    throw new Error("PlayerNameResolver no debe usarse en server.stop");
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

describe("ServerStoppedHandler", () => {
  it("supports('server.stop') devuelve true; otros tipos false", () => {
    const h = new ServerStoppedHandler();
    expect(h.supports("server.stop")).toBe(true);
    expect(h.supports("server.start")).toBe(false);
    expect(h.supports("session.end")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("SERVER.STOP")).toBe(false); // case-sensitive
  });

  it("handle() invoca publisher.publish() exactamente una vez", async () => {
    const publisher = fakePublisher();
    const h = new ServerStoppedHandler();
    await h.handle(fakeContext(publisher), fakeEvent("server.stop"));
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("handle() construye el PublishPayload esperado (title + body fijos)", async () => {
    const publisher = fakePublisher();
    const h = new ServerStoppedHandler();
    await h.handle(fakeContext(publisher), fakeEvent("server.stop"));
    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Servidor detenido",
      body: "Servidor detenido correctamente.",
      kind: "server_stopped",
    });
  });

  it("error del publisher se propaga tal cual (sin envolver)", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const h = new ServerStoppedHandler();
    await expect(
      h.handle(fakeContext(publisher), fakeEvent("server.stop")),
    ).rejects.toBe(boom);
  });

  it("funciona con cualquier Publisher fake (no depende de Discord)", async () => {
    const seen: PublishPayload[] = [];
    const publisher: Publisher = {
      publish: async (p) => {
        seen.push(p);
      },
    };
    const h = new ServerStoppedHandler();
    await h.handle(fakeContext(publisher), fakeEvent("server.stop"));
    expect(seen).toEqual([
      { title: "Servidor detenido", body: "Servidor detenido correctamente.", kind: "server_stopped" },
    ]);
  });

  // ---------- freshness (BUG-02B — el caso reportado) ----------

  it("evento fresco (lag <= threshold): publica normalmente", async () => {
    const publisher = fakePublisher();
    const h = new ServerStoppedHandler();
    const event: EventRecord = {
      ...fakeEvent("server.stop"),
      ts: "2026-08-02T07:00:00.000Z",
      received_at: "2026-08-02T07:00:00.500Z",
    };
    await h.handle(fakeContext(publisher), event);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("BUG-02: server.stop de ayer entregado hoy -> NO publica + WARN", async () => {
    // Escenario textual del bug: ts del stop anterior + received_at
    // del arranque de hoy = ~22 h de lag. Antes: bot decia "Servidor
    // detenido" con el servidor arriba. Ahora: silencio + WARN.
    const publisher = fakePublisher();
    const warn = vi.fn();
    const h = new ServerStoppedHandler();
    const event: EventRecord = {
      ...fakeEvent("server.stop"),
      event_uuid: "4fa12f2c-d645-4f7e-bd64-73149de1968a",
      id: "14082",
      ts: "2026-08-01T09:08:32.427Z",
      received_at: "2026-08-02T07:01:03.996Z",
    };
    await h.handle(fakeContext(publisher, { warn }), event);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const p = warn.mock.calls[0]![0] as Record<string, unknown>;
    expect(p.handler).toBe("ServerStoppedHandler");
    expect(p.motivo).toBe("evento_obsoleto");
    expect(p.type).toBe("server.stop");
    expect(p.threshold_ms).toBe(120000);
  });

  it("evento obsoleto: NO lanza excepcion (cursor puede avanzar)", async () => {
    const publisher = fakePublisher();
    const h = new ServerStoppedHandler();
    const event: EventRecord = {
      ...fakeEvent("server.stop"),
      ts: "2026-08-01T09:00:00.000Z",
      received_at: "2026-08-02T07:00:00.000Z",
    };
    await expect(
      h.handle(fakeContext(publisher), event),
    ).resolves.toBeUndefined();
  });

  it("payload del evento no modifica el mensaje", async () => {
    const publisher = fakePublisher();
    const h = new ServerStoppedHandler();

    const eventA: EventRecord = {
      ...fakeEvent("server.stop"),
      id: "1",
      data: { uptime_s: 3600 },
    };
    const eventB: EventRecord = {
      ...fakeEvent("server.stop"),
      id: "2",
      data: { uptime_s: 999999, extra: "foo" },
    };

    await h.handle(fakeContext(publisher), eventA);
    await h.handle(fakeContext(publisher), eventB);

    expect(publisher.publish.mock.calls[0]![0]).toEqual(
      publisher.publish.mock.calls[1]![0],
    );
  });

  // ---------- lifecycle state (BUG-02C · defense-in-depth) ----------

  it("estado=down + stop fresco: NO publica + WARN duplicado_lifecycle", async () => {
    const publisher = fakePublisher();
    const warn = vi.fn();
    let current: "unknown" | "up" | "down" = "down";
    const lifecycleState = {
      get: () => current,
      set: (n: "unknown" | "up" | "down") => {
        current = n;
      },
    };
    const h = new ServerStoppedHandler();
    const event: EventRecord = {
      ...fakeEvent("server.stop"),
      ts: "2026-08-02T07:00:00.000Z",
      received_at: "2026-08-02T07:00:00.500Z",
    };
    await h.handle(fakeContext(publisher, { warn, lifecycleState }), event);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.motivo).toBe("duplicado_lifecycle");
    expect(payload.prior_state).toBe("down");
  });

  it("stop fresco cuando estado != down: publica y transiciona a 'down'", async () => {
    const publisher = fakePublisher();
    let current: "unknown" | "up" | "down" = "up";
    const lifecycleState = {
      get: () => current,
      set: (n: "unknown" | "up" | "down") => {
        current = n;
      },
    };
    const h = new ServerStoppedHandler();
    const event: EventRecord = {
      ...fakeEvent("server.stop"),
      ts: "2026-08-02T07:00:00.000Z",
      received_at: "2026-08-02T07:00:00.500Z",
    };
    await h.handle(fakeContext(publisher, { lifecycleState }), event);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(current).toBe("down");
  });

  it("stop obsoleto NO transiciona el estado (freshness gana antes)", async () => {
    const publisher = fakePublisher();
    let current: "unknown" | "up" | "down" = "up";
    const lifecycleState = {
      get: () => current,
      set: (n: "unknown" | "up" | "down") => {
        current = n;
      },
    };
    const h = new ServerStoppedHandler();
    const event: EventRecord = {
      ...fakeEvent("server.stop"),
      ts: "2026-08-01T09:08:32.427Z",
      received_at: "2026-08-02T07:01:03.996Z", // ~22 h
    };
    await h.handle(fakeContext(publisher, { lifecycleState }), event);
    expect(publisher.publish).not.toHaveBeenCalled();
    // Estado permanece "up" — freshness descarto el evento antes.
    expect(current).toBe("up");
  });
});
