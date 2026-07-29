import { describe, it, expect, vi } from "vitest";
import { PlayerDeathHandler } from "../src/handlers/player-death-handler";
import { MissingPlayerNameError } from "../src/handlers/errors";
import type { DispatchContext } from "../src/context";
import type { Publisher, PublishPayload } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";

// Tests de PlayerDeathHandler.
// Sin Discord, sin red: publisher fake y contexto minimo.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

function fakeContext(publisher: Publisher): DispatchContext {
  return { publisher };
}

function playerDeathEvent(
  data: Record<string, unknown>,
  uuid = "aaaa",
): EventRecord {
  return {
    id: "42",
    event_uuid: `00000000-0000-4000-8000-${uuid.padStart(12, "0")}`,
    type: "player.death",
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
    world: "world",
    x: 0,
    y: 64,
    z: 0,
    data,
  };
}

describe("PlayerDeathHandler", () => {
  it("supports('player.death') true; otros false", () => {
    const h = new PlayerDeathHandler();
    expect(h.supports("player.death")).toBe(true);
    expect(h.supports("player.kill")).toBe(false);
    expect(h.supports("mob.kill")).toBe(false);
    expect(h.supports("player.leave")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("PLAYER.DEATH")).toBe(false);
  });

  it("publicacion correcta con causa: '<nombre> ha muerto por <causa>.'", async () => {
    const publisher = fakePublisher();
    const h = new PlayerDeathHandler();
    await h.handle(
      fakeContext(publisher),
      playerDeathEvent({ name: "Vancorbus", cause: "un Creeper" }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Jugador eliminado",
      body: "Vancorbus ha muerto por un Creeper.",
    });
  });

  it("publicacion correcta sin causa: '<nombre> ha muerto.'", async () => {
    const publisher = fakePublisher();
    const h = new PlayerDeathHandler();
    await h.handle(fakeContext(publisher), playerDeathEvent({ name: "Vancorbus" }));

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Jugador eliminado",
      body: "Vancorbus ha muerto.",
    });
  });

  it("cause vacia o solo whitespace: cae al mensaje corto", async () => {
    const publisher = fakePublisher();
    const h = new PlayerDeathHandler();

    await h.handle(fakeContext(publisher), playerDeathEvent({ name: "X", cause: "" }));
    await h.handle(fakeContext(publisher), playerDeathEvent({ name: "X", cause: "   " }));

    expect(publisher.publish.mock.calls[0]![0]).toEqual({
      title: "Jugador eliminado",
      body: "X ha muerto.",
    });
    expect(publisher.publish.mock.calls[1]![0]).toEqual({
      title: "Jugador eliminado",
      body: "X ha muerto.",
    });
  });

  it("cause no-string: cae al mensaje corto (no lanza)", async () => {
    const publisher = fakePublisher();
    const h = new PlayerDeathHandler();

    await h.handle(
      fakeContext(publisher),
      playerDeathEvent({ name: "X", cause: 42 }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Jugador eliminado",
      body: "X ha muerto.",
    });
  });

  it("trimea whitespace del nombre y de la causa", async () => {
    const publisher = fakePublisher();
    const h = new PlayerDeathHandler();
    await h.handle(
      fakeContext(publisher),
      playerDeathEvent({ name: "  Vancorbus  ", cause: "  caida al vacio  " }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Jugador eliminado",
      body: "Vancorbus ha muerto por caida al vacio.",
    });
  });

  it("data.name ausente: MissingPlayerNameError y NO publica", async () => {
    const publisher = fakePublisher();
    const h = new PlayerDeathHandler();

    await expect(
      h.handle(fakeContext(publisher), playerDeathEvent({ cause: "algo" })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.name no-string o vacio: MissingPlayerNameError", async () => {
    const publisher = fakePublisher();
    const h = new PlayerDeathHandler();

    await expect(
      h.handle(fakeContext(publisher), playerDeathEvent({ name: 42 })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    await expect(
      h.handle(fakeContext(publisher), playerDeathEvent({ name: "" })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    await expect(
      h.handle(fakeContext(publisher), playerDeathEvent({ name: "   " })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("MissingPlayerNameError incluye event_uuid y menciona player.death", async () => {
    const h = new PlayerDeathHandler();
    const event = playerDeathEvent({}, "cafecafecafe");
    const err = await h
      .handle(fakeContext(fakePublisher()), event)
      .catch((e) => e);
    expect(err).toBeInstanceOf(MissingPlayerNameError);
    expect((err as MissingPlayerNameError).eventUuid).toBe(event.event_uuid);
    expect((err as MissingPlayerNameError).code).toBe("MISSING_PLAYER_NAME");
    expect((err as MissingPlayerNameError).message).toContain("player.death");
  });

  it("publisher llamado exactamente una vez en caso feliz", async () => {
    const publisher = fakePublisher();
    const h = new PlayerDeathHandler();
    await h.handle(fakeContext(publisher), playerDeathEvent({ name: "X" }));
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("error del publisher se propaga tal cual", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const h = new PlayerDeathHandler();
    await expect(
      h.handle(fakeContext(publisher), playerDeathEvent({ name: "X" })),
    ).rejects.toBe(boom);
  });

  it("funciona con cualquier Publisher fake (no depende de Discord)", async () => {
    const seen: PublishPayload[] = [];
    const publisher: Publisher = {
      publish: async (p) => {
        seen.push(p);
      },
    };
    const h = new PlayerDeathHandler();
    await h.handle(
      fakeContext(publisher),
      playerDeathEvent({ name: "Vancorbus", cause: "un esqueleto" }),
    );
    expect(seen).toEqual([
      {
        title: "Jugador eliminado",
        body: "Vancorbus ha muerto por un esqueleto.",
      },
    ]);
  });
});
