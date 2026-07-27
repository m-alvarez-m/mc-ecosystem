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

function fakeContext(publisher: Publisher): DispatchContext {
  return { publisher };
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
      { title: "Servidor iniciado", body: "Servidor iniciado correctamente." },
    ]);
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
});
