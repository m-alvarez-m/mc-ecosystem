import { describe, it, expect, vi } from "vitest";
import {
  AdvancementHandler,
  MissingAdvancementNameError,
} from "../src/handlers/advancement-handler";
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

function advancementEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-000000000001",
    type: "advancement.done",
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? VANCORBUS : overrides.playerUuid,
    world: "world",
    x: 0,
    y: 64,
    z: 0,
    data: overrides.data ?? { advancement: "Enter the Nether" },
  };
}

describe("AdvancementHandler", () => {
  it("supports('advancement.done') true; otros false", () => {
    const h = new AdvancementHandler();
    expect(h.supports("advancement.done")).toBe(true);
    expect(h.supports("milestone.first")).toBe(false);
    expect(h.supports("player.death")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("ADVANCEMENT.DONE")).toBe(false);
  });

  it("caso feliz: advancement conocido en catálogo → publica el título traducido", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new AdvancementHandler();

    await h.handle(
      fakeContext(publisher, resolver),
      advancementEvent({ data: { advancement: "minecraft:story/mine_stone" } }),
    );

    expect(resolver.resolve).toHaveBeenCalledWith(VANCORBUS);
    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Nuevo avance",
      body: "Vancorbus ha conseguido el avance: Edad de Piedra.",
    });
  });

  it("advancement conocido: publica el título oficial en español", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new AdvancementHandler();

    await h.handle(
      fakeContext(publisher, resolver),
      advancementEvent({ data: { advancement: "minecraft:story/enter_the_end" } }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Nuevo avance",
      body: "Vancorbus ha conseguido el avance: El End... ¿Otra vez?.",
    });
  });

  it("advancement desconocido: fallback al ID crudo (sin lanzar)", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new AdvancementHandler();

    // ID de un datapack custom / mod / advancement no vanilla:
    // el handler debe publicar sin traducir, no lanzar excepción.
    await h.handle(
      fakeContext(publisher, resolver),
      advancementEvent({ data: { advancement: "customdatapack:tourney/win_gold" } }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Nuevo avance",
      body:
        "Vancorbus ha conseguido el avance: customdatapack:tourney/win_gold.",
    });
  });

  it("distintos player_uuid resuelven a distintos nombres", async () => {
    const other = "8a80a72d-fb01-3e17-9a96-2b801d16f82d";
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({
      [VANCORBUS]: "Pacman26",
      [other]: "Elrid",
    });
    const h = new AdvancementHandler();

    await h.handle(
      fakeContext(publisher, resolver),
      advancementEvent({ data: { advancement: "minecraft:story/mine_diamond" } }),
    );
    await h.handle(
      fakeContext(publisher, resolver),
      advancementEvent({
        playerUuid: other,
        eventUuid: "00000000-0000-4000-8000-000000000002",
        data: { advancement: "minecraft:end/kill_dragon" },
      }),
    );

    expect(publisher.publish.mock.calls[0]![0]).toEqual({
      title: "Nuevo avance",
      body: "Pacman26 ha conseguido el avance: ¡Diamantes!.",
    });
    expect(publisher.publish.mock.calls[1]![0]).toEqual({
      title: "Nuevo avance",
      body: "Elrid ha conseguido el avance: Libera al End.",
    });
  });

  it("trimea whitespace del advancement (el nombre viene del resolver)", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "V" });
    const h = new AdvancementHandler();
    await h.handle(
      fakeContext(publisher, resolver),
      advancementEvent({ data: { advancement: "  Getting an Upgrade  " } }),
    );

    // Fallback: el catálogo no conoce "Getting an Upgrade" (nombre EN),
    // así que publica el ID trimeado tal cual — sin cambiar el resto
    // del mensaje.
    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Nuevo avance",
      body: "V ha conseguido el avance: Getting an Upgrade.",
    });
  });

  it("player_uuid null: MissingPlayerUuidError, resolver NO se llama, publisher NO se llama", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({});
    const h = new AdvancementHandler();
    const event = advancementEvent({ playerUuid: null, eventUuid: "00000000-0000-4000-8000-cafecafecafe" });

    const err = await h
      .handle(fakeContext(publisher, resolver), event)
      .catch((e) => e);

    expect(err).toBeInstanceOf(MissingPlayerUuidError);
    expect((err as MissingPlayerUuidError).eventUuid).toBe(event.event_uuid);
    expect((err as MissingPlayerUuidError).code).toBe("MISSING_PLAYER_UUID");
    expect((err as MissingPlayerUuidError).message).toContain("advancement.done");
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.advancement ausente / no-string / vacio: MissingAdvancementNameError", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "V" });
    const h = new AdvancementHandler();

    await expect(
      h.handle(
        fakeContext(publisher, resolver),
        advancementEvent({ eventUuid: "00000000-0000-4000-8000-000000000010", data: {} }),
      ),
    ).rejects.toBeInstanceOf(MissingAdvancementNameError);
    await expect(
      h.handle(
        fakeContext(publisher, resolver),
        advancementEvent({ eventUuid: "00000000-0000-4000-8000-000000000011", data: { advancement: 42 } }),
      ),
    ).rejects.toBeInstanceOf(MissingAdvancementNameError);
    await expect(
      h.handle(
        fakeContext(publisher, resolver),
        advancementEvent({ eventUuid: "00000000-0000-4000-8000-000000000012", data: { advancement: "" } }),
      ),
    ).rejects.toBeInstanceOf(MissingAdvancementNameError);
    await expect(
      h.handle(
        fakeContext(publisher, resolver),
        advancementEvent({ eventUuid: "00000000-0000-4000-8000-000000000013", data: { advancement: "   " } }),
      ),
    ).rejects.toBeInstanceOf(MissingAdvancementNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("resolver lanza PlayerNotFoundError: se propaga, publisher NO se llama", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({});
    const h = new AdvancementHandler();

    await expect(
      h.handle(fakeContext(publisher, resolver), advancementEvent()),
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
    const h = new AdvancementHandler();

    const err = await h
      .handle(fakeContext(publisher, resolver), advancementEvent())
      .catch((e) => e);
    expect(err).toBe(httpError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("publisher llamado exactamente una vez en caso feliz", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "X" });
    const h = new AdvancementHandler();
    await h.handle(fakeContext(publisher, resolver), advancementEvent());
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
    const h = new AdvancementHandler();
    await expect(
      h.handle(fakeContext(publisher, resolver), advancementEvent()),
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
    const h = new AdvancementHandler();
    await h.handle(
      fakeContext(publisher, resolver),
      advancementEvent({ data: { advancement: "Enter the Nether" } }),
    );
    expect(seen).toEqual([
      {
        title: "Nuevo avance",
        body: "Vancorbus ha conseguido el avance: Enter the Nether.",
      },
    ]);
  });
});
