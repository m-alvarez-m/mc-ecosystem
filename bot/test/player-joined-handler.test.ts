import { describe, it, expect, vi } from "vitest";
import {
  PlayerJoinedHandler,
  MissingPlayerNameError,
} from "../src/handlers/player-joined-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher, PublishPayload } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";

// Tests de PlayerJoinedHandler.
// Sin Discord, sin red: publisher fake y contexto minimo.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

function fakeContext(publisher: Publisher): DispatchContext {
  return { publisher };
}

function playerJoinEvent(data: Record<string, unknown>, uuid = "aaaa"): EventRecord {
  return {
    id: "42",
    event_uuid: `00000000-0000-4000-8000-${uuid.padStart(12, "0")}`,
    type: "player.join",
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
    world: null,
    x: null,
    y: null,
    z: null,
    data,
  };
}

describe("PlayerJoinedHandler", () => {
  it("supports('player.join') true; otros false", () => {
    const h = new PlayerJoinedHandler();
    expect(h.supports("player.join")).toBe(true);
    expect(h.supports("player.leave")).toBe(false);
    expect(h.supports("session.start")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("PLAYER.JOIN")).toBe(false);
  });

  it("publicacion correcta: publisher recibe title + body con el nombre interpolado", async () => {
    const publisher = fakePublisher();
    const h = new PlayerJoinedHandler();
    await h.handle(fakeContext(publisher), playerJoinEvent({ name: "Vancorbus" }));

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Jugador conectado",
      body: "Vancorbus se ha unido al servidor.",
    });
  });

  it("nombre correcto en el mensaje para distintos jugadores", async () => {
    const publisher = fakePublisher();
    const h = new PlayerJoinedHandler();
    await h.handle(fakeContext(publisher), playerJoinEvent({ name: "Pacman26" }));
    await h.handle(fakeContext(publisher), playerJoinEvent({ name: "Elrid" }));

    expect(publisher.publish.mock.calls[0]![0]).toEqual({
      title: "Jugador conectado",
      body: "Pacman26 se ha unido al servidor.",
    });
    expect(publisher.publish.mock.calls[1]![0]).toEqual({
      title: "Jugador conectado",
      body: "Elrid se ha unido al servidor.",
    });
  });

  it("trimea whitespace alrededor del nombre antes de publicar", async () => {
    const publisher = fakePublisher();
    const h = new PlayerJoinedHandler();
    await h.handle(fakeContext(publisher), playerJoinEvent({ name: "  Vancorbus  " }));

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Jugador conectado",
      body: "Vancorbus se ha unido al servidor.",
    });
  });

  it("data.name ausente: lanza MissingPlayerNameError y NO publica", async () => {
    const publisher = fakePublisher();
    const h = new PlayerJoinedHandler();

    await expect(
      h.handle(fakeContext(publisher), playerJoinEvent({})),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.name no-string: MissingPlayerNameError", async () => {
    const publisher = fakePublisher();
    const h = new PlayerJoinedHandler();

    await expect(
      h.handle(fakeContext(publisher), playerJoinEvent({ name: 42 })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.name vacio o solo whitespace: MissingPlayerNameError", async () => {
    const publisher = fakePublisher();
    const h = new PlayerJoinedHandler();

    await expect(
      h.handle(fakeContext(publisher), playerJoinEvent({ name: "" })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    await expect(
      h.handle(fakeContext(publisher), playerJoinEvent({ name: "   " })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("MissingPlayerNameError incluye event_uuid para debug", async () => {
    const h = new PlayerJoinedHandler();
    const event = playerJoinEvent({}, "cafecafecafe");
    const err = await h
      .handle(fakeContext(fakePublisher()), event)
      .catch((e) => e);
    expect(err).toBeInstanceOf(MissingPlayerNameError);
    expect((err as MissingPlayerNameError).eventUuid).toBe(event.event_uuid);
    expect((err as MissingPlayerNameError).code).toBe("MISSING_PLAYER_NAME");
  });

  it("publisher llamado exactamente una vez en caso feliz", async () => {
    const publisher = fakePublisher();
    const h = new PlayerJoinedHandler();
    await h.handle(fakeContext(publisher), playerJoinEvent({ name: "X" }));
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("error del publisher se propaga tal cual", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const h = new PlayerJoinedHandler();
    await expect(
      h.handle(fakeContext(publisher), playerJoinEvent({ name: "X" })),
    ).rejects.toBe(boom);
  });

  it("funciona con cualquier Publisher fake (no depende de Discord)", async () => {
    const seen: PublishPayload[] = [];
    const publisher: Publisher = {
      publish: async (p) => {
        seen.push(p);
      },
    };
    const h = new PlayerJoinedHandler();
    await h.handle(fakeContext(publisher), playerJoinEvent({ name: "Vancorbus" }));
    expect(seen).toEqual([
      { title: "Jugador conectado", body: "Vancorbus se ha unido al servidor." },
    ]);
  });
});
