import { describe, it, expect, vi } from "vitest";
import { TpsHandler, InvalidTpsError } from "../src/handlers/tps-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher, PublishPayload } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";

// Tests de TpsHandler.
// Sin Discord, sin red: publisher fake y contexto minimo.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

function fakeContext(publisher: Publisher): DispatchContext {
  return { publisher };
}

function tpsEvent(data: Record<string, unknown>, uuid = "aaaa"): EventRecord {
  return {
    id: "42",
    event_uuid: `00000000-0000-4000-8000-${uuid.padStart(12, "0")}`,
    type: "server.tps",
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data,
  };
}

describe("TpsHandler", () => {
  it("supports('server.tps') true; otros false", () => {
    const h = new TpsHandler();
    expect(h.supports("server.tps")).toBe(true);
    expect(h.supports("server.tps_sample")).toBe(false); // el del catalogo real
    expect(h.supports("server.start")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("SERVER.TPS")).toBe(false);
  });

  it("publicacion correcta con TPS entero: '<title>' + 'TPS actual: 20'", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler();
    await h.handle(fakeContext(publisher), tpsEvent({ tps: 20 }));

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Estado del servidor",
      body: "TPS actual: 20",
    });
  });

  it("publicacion correcta con TPS decimal", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler();
    await h.handle(fakeContext(publisher), tpsEvent({ tps: 19.85 }));

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Estado del servidor",
      body: "TPS actual: 19.85",
    });
  });

  it("acepta cero (no clasifica como malo)", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler();
    await h.handle(fakeContext(publisher), tpsEvent({ tps: 0 }));

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Estado del servidor",
      body: "TPS actual: 0",
    });
  });

  it("acepta negativos (aunque raros, no es nuestra funcion clasificar)", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler();
    await h.handle(fakeContext(publisher), tpsEvent({ tps: -1.5 }));

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Estado del servidor",
      body: "TPS actual: -1.5",
    });
  });

  it("data.tps ausente: InvalidTpsError y NO publica", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler();

    await expect(
      h.handle(fakeContext(publisher), tpsEvent({})),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.tps no numerico: InvalidTpsError", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler();

    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps: "20" })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps: null })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps: true })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps: [20] })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.tps NaN o Infinity: InvalidTpsError", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler();

    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps: Number.NaN })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps: Number.POSITIVE_INFINITY })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps: Number.NEGATIVE_INFINITY })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("InvalidTpsError incluye event_uuid y menciona server.tps", async () => {
    const h = new TpsHandler();
    const event = tpsEvent({}, "cafecafecafe");
    const err = await h
      .handle(fakeContext(fakePublisher()), event)
      .catch((e) => e);
    expect(err).toBeInstanceOf(InvalidTpsError);
    expect((err as InvalidTpsError).eventUuid).toBe(event.event_uuid);
    expect((err as InvalidTpsError).code).toBe("INVALID_TPS");
    expect((err as InvalidTpsError).message).toContain("server.tps");
  });

  it("publisher llamado exactamente una vez en caso feliz", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler();
    await h.handle(fakeContext(publisher), tpsEvent({ tps: 20 }));
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("error del publisher se propaga tal cual", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const h = new TpsHandler();
    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps: 20 })),
    ).rejects.toBe(boom);
  });

  it("funciona con cualquier Publisher fake (no depende de Discord)", async () => {
    const seen: PublishPayload[] = [];
    const publisher: Publisher = {
      publish: async (p) => {
        seen.push(p);
      },
    };
    const h = new TpsHandler();
    await h.handle(fakeContext(publisher), tpsEvent({ tps: 19.87 }));
    expect(seen).toEqual([
      { title: "Estado del servidor", body: "TPS actual: 19.87" },
    ]);
  });
});
