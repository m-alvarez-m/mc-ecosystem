import { describe, it, expect, vi } from "vitest";
import { PlayerLeftHandler } from "../src/handlers/player-left-handler";
import { MissingPlayerNameError } from "../src/handlers/errors";
import type { DispatchContext } from "../src/context";
import type { Publisher, PublishPayload } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";

// Tests de PlayerLeftHandler.
// Sin Discord, sin red: publisher fake y contexto minimo.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

function fakeContext(publisher: Publisher): DispatchContext {
  return { publisher };
}

function playerLeaveEvent(
  data: Record<string, unknown>,
  uuid = "aaaa",
): EventRecord {
  return {
    id: "42",
    event_uuid: `00000000-0000-4000-8000-${uuid.padStart(12, "0")}`,
    type: "session.end",
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

describe("PlayerLeftHandler", () => {
  it("supports('session.end') true; otros false", () => {
    const h = new PlayerLeftHandler();
    expect(h.supports("session.end")).toBe(true);
    expect(h.supports("session.start")).toBe(false);
    expect(h.supports("player.death")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("SESSION.END")).toBe(false);
  });

  it("publicacion correcta: publisher recibe title + body con nombre", async () => {
    const publisher = fakePublisher();
    const h = new PlayerLeftHandler();
    await h.handle(fakeContext(publisher), playerLeaveEvent({ name: "Vancorbus" }));

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Jugador desconectado",
      body: "Vancorbus ha salido del servidor.",
    });
  });

  it("mensaje esperado para varios jugadores", async () => {
    const publisher = fakePublisher();
    const h = new PlayerLeftHandler();
    await h.handle(fakeContext(publisher), playerLeaveEvent({ name: "Pacman26" }));
    await h.handle(fakeContext(publisher), playerLeaveEvent({ name: "Elrid" }));

    expect(publisher.publish.mock.calls[0]![0]).toEqual({
      title: "Jugador desconectado",
      body: "Pacman26 ha salido del servidor.",
    });
    expect(publisher.publish.mock.calls[1]![0]).toEqual({
      title: "Jugador desconectado",
      body: "Elrid ha salido del servidor.",
    });
  });

  it("trimea whitespace del nombre", async () => {
    const publisher = fakePublisher();
    const h = new PlayerLeftHandler();
    await h.handle(
      fakeContext(publisher),
      playerLeaveEvent({ name: "  Vancorbus  " }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Jugador desconectado",
      body: "Vancorbus ha salido del servidor.",
    });
  });

  it("data.name ausente: lanza MissingPlayerNameError y NO publica", async () => {
    const publisher = fakePublisher();
    const h = new PlayerLeftHandler();

    await expect(
      h.handle(fakeContext(publisher), playerLeaveEvent({})),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.name no-string: MissingPlayerNameError", async () => {
    const publisher = fakePublisher();
    const h = new PlayerLeftHandler();

    await expect(
      h.handle(fakeContext(publisher), playerLeaveEvent({ name: 42 })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.name vacio o solo whitespace: MissingPlayerNameError", async () => {
    const publisher = fakePublisher();
    const h = new PlayerLeftHandler();

    await expect(
      h.handle(fakeContext(publisher), playerLeaveEvent({ name: "" })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    await expect(
      h.handle(fakeContext(publisher), playerLeaveEvent({ name: "   " })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("MissingPlayerNameError incluye event_uuid y menciona session.end", async () => {
    const h = new PlayerLeftHandler();
    const event = playerLeaveEvent({}, "cafecafecafe");
    const err = await h
      .handle(fakeContext(fakePublisher()), event)
      .catch((e) => e);
    expect(err).toBeInstanceOf(MissingPlayerNameError);
    expect((err as MissingPlayerNameError).eventUuid).toBe(event.event_uuid);
    expect((err as MissingPlayerNameError).code).toBe("MISSING_PLAYER_NAME");
    expect((err as MissingPlayerNameError).message).toContain("session.end");
  });

  it("publisher llamado exactamente una vez en caso feliz", async () => {
    const publisher = fakePublisher();
    const h = new PlayerLeftHandler();
    await h.handle(fakeContext(publisher), playerLeaveEvent({ name: "X" }));
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("error del publisher se propaga tal cual", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const h = new PlayerLeftHandler();
    await expect(
      h.handle(fakeContext(publisher), playerLeaveEvent({ name: "X" })),
    ).rejects.toBe(boom);
  });

  it("funciona con cualquier Publisher fake (no depende de Discord)", async () => {
    const seen: PublishPayload[] = [];
    const publisher: Publisher = {
      publish: async (p) => {
        seen.push(p);
      },
    };
    const h = new PlayerLeftHandler();
    await h.handle(
      fakeContext(publisher),
      playerLeaveEvent({ name: "Vancorbus" }),
    );
    expect(seen).toEqual([
      { title: "Jugador desconectado", body: "Vancorbus ha salido del servidor." },
    ]);
  });
});
