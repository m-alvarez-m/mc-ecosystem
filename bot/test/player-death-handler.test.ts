import { describe, it, expect, vi } from "vitest";
import { PlayerDeathHandler } from "../src/handlers/player-death-handler";
import { MissingPlayerUuidError } from "../src/handlers/errors";
import type { DispatchContext } from "../src/context";
import type { Publisher, PublishPayload } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";
import {
  PlayerNameResolver,
  PlayerNotFoundError,
  PlayerLookupHttpError,
} from "../src/players";

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

function fakeResolverFromMap(
  map: Record<string, string>,
): PlayerNameResolver & { resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn(async (uuid: string) => {
    if (uuid in map) return map[uuid]!;
    throw new PlayerNotFoundError(uuid);
  });
  return { resolve } as unknown as PlayerNameResolver & {
    resolve: ReturnType<typeof vi.fn>;
  };
}

function fakeContext(
  publisher: Publisher,
  resolver: PlayerNameResolver,
): DispatchContext {
  return { publisher, playerNameResolver: resolver };
}

const VANCORBUS = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";

function playerDeathEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-000000000001",
    type: "player.death",
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? VANCORBUS : overrides.playerUuid,
    world: "world",
    x: 0,
    y: 64,
    z: 0,
    data: overrides.data ?? { cause: "un Creeper", message: "Vancorbus was blown up" },
  };
}

describe("PlayerDeathHandler", () => {
  it("supports('player.death') true; otros false", () => {
    const h = new PlayerDeathHandler();
    expect(h.supports("player.death")).toBe(true);
    expect(h.supports("player.kill")).toBe(false);
    expect(h.supports("mob.kill")).toBe(false);
    expect(h.supports("session.end")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("PLAYER.DEATH")).toBe(false);
  });

  it("caso feliz con causa: '<nombre> ha muerto por <causa>.'", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new PlayerDeathHandler();

    await h.handle(fakeContext(publisher, resolver), playerDeathEvent({ data: { cause: "un Creeper" } }));

    expect(resolver.resolve).toHaveBeenCalledWith(VANCORBUS);
    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Jugador eliminado",
      body: "Vancorbus ha muerto por un Creeper.",
      kind: "player_death",
    });
  });

  it("caso feliz sin causa: mensaje corto", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new PlayerDeathHandler();

    await h.handle(fakeContext(publisher, resolver), playerDeathEvent({ data: {} }));

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Jugador eliminado",
      body: "Vancorbus ha muerto.",
      kind: "player_death",
    });
  });

  it("cause vacia, whitespace o no-string: cae al mensaje corto (no lanza)", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "X" });
    const h = new PlayerDeathHandler();

    await h.handle(
      fakeContext(publisher, resolver),
      playerDeathEvent({ eventUuid: "00000000-0000-4000-8000-000000000001", data: { cause: "" } }),
    );
    await h.handle(
      fakeContext(publisher, resolver),
      playerDeathEvent({ eventUuid: "00000000-0000-4000-8000-000000000002", data: { cause: "   " } }),
    );
    await h.handle(
      fakeContext(publisher, resolver),
      playerDeathEvent({ eventUuid: "00000000-0000-4000-8000-000000000003", data: { cause: 42 } }),
    );

    expect(publisher.publish.mock.calls[0]![0]).toEqual({
      title: "Jugador eliminado",
      body: "X ha muerto.",
      kind: "player_death",
    });
    expect(publisher.publish.mock.calls[1]![0]).toEqual({
      title: "Jugador eliminado",
      body: "X ha muerto.",
      kind: "player_death",
    });
    expect(publisher.publish.mock.calls[2]![0]).toEqual({
      title: "Jugador eliminado",
      body: "X ha muerto.",
      kind: "player_death",
    });
  });

  it("trimea whitespace de la causa (el nombre viene del resolver)", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new PlayerDeathHandler();
    await h.handle(
      fakeContext(publisher, resolver),
      playerDeathEvent({ data: { cause: "  caida al vacio  " } }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Jugador eliminado",
      body: "Vancorbus ha muerto por caida al vacio.",
      kind: "player_death",
    });
  });

  it("player_uuid null: MissingPlayerUuidError, resolver NO se llama, publisher NO se llama", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({});
    const h = new PlayerDeathHandler();
    const event = playerDeathEvent({ playerUuid: null, eventUuid: "00000000-0000-4000-8000-cafecafecafe" });

    const err = await h
      .handle(fakeContext(publisher, resolver), event)
      .catch((e) => e);

    expect(err).toBeInstanceOf(MissingPlayerUuidError);
    expect((err as MissingPlayerUuidError).eventUuid).toBe(event.event_uuid);
    expect((err as MissingPlayerUuidError).code).toBe("MISSING_PLAYER_UUID");
    expect((err as MissingPlayerUuidError).message).toContain("player.death");
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("resolver lanza PlayerNotFoundError: se propaga, publisher NO se llama", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({});
    const h = new PlayerDeathHandler();

    await expect(
      h.handle(fakeContext(publisher, resolver), playerDeathEvent()),
    ).rejects.toBeInstanceOf(PlayerNotFoundError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("resolver lanza HttpError: se propaga tal cual", async () => {
    const publisher = fakePublisher();
    const httpError = new PlayerLookupHttpError(VANCORBUS, 500, "boom");
    const resolver = {
      resolve: vi.fn(async () => {
        throw httpError;
      }),
    } as unknown as PlayerNameResolver;
    const h = new PlayerDeathHandler();

    const err = await h
      .handle(fakeContext(publisher, resolver), playerDeathEvent())
      .catch((e) => e);
    expect(err).toBe(httpError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("publisher llamado exactamente una vez en caso feliz", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "X" });
    const h = new PlayerDeathHandler();
    await h.handle(fakeContext(publisher, resolver), playerDeathEvent());
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("error del publisher se propaga tal cual", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "X" });
    const h = new PlayerDeathHandler();
    await expect(
      h.handle(fakeContext(publisher, resolver), playerDeathEvent()),
    ).rejects.toBe(boom);
  });

  it("funciona con cualquier Publisher fake (no depende de Discord)", async () => {
    const seen: PublishPayload[] = [];
    const publisher: Publisher = {
      publish: async (p) => {
        seen.push(p);
      },
    };
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new PlayerDeathHandler();
    await h.handle(
      fakeContext(publisher, resolver),
      playerDeathEvent({ data: { cause: "un esqueleto" } }),
    );
    expect(seen).toEqual([
      { title: "Jugador eliminado", body: "Vancorbus ha muerto por un esqueleto.", kind: "player_death" },
    ]);
  });
});
