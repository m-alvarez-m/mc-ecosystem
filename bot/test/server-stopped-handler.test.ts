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
      { title: "Servidor detenido", body: "Servidor detenido correctamente." },
    ]);
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
});
