import { describe, it, expect, vi } from "vitest";
import { PlayerLeftHandler } from "../src/handlers/player-left-handler";
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
  overrides?: { warn?: (obj: unknown, msg?: string) => void; freshnessThresholdMs?: number },
): DispatchContext {
  return {
    publisher,
    playerNameResolver: resolver,
    logger: { warn: overrides?.warn ?? (() => undefined) },
    freshnessThresholdMs: overrides?.freshnessThresholdMs ?? 120000,
  };
}

const VANCORBUS = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";

function playerLeaveEvent(
  overrides: { playerUuid?: string | null; eventUuid?: string; data?: Record<string, unknown> } = {},
): EventRecord {
  return {
    id: "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-000000000001",
    type: "session.end",
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? VANCORBUS : overrides.playerUuid,
    world: null,
    x: null,
    y: null,
    z: null,
    data: overrides.data ?? { duration_s: 600, reason: "quit" },
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

  it("caso feliz: resolver devuelve nombre, publisher recibe body interpolado", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new PlayerLeftHandler();

    await h.handle(fakeContext(publisher, resolver), playerLeaveEvent());

    expect(resolver.resolve).toHaveBeenCalledWith(VANCORBUS);
    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Jugador desconectado",
      body: "Vancorbus ha salido del servidor.",
      kind: "player_left",
    });
  });

  it("distintos player_uuid resuelven a distintos nombres", async () => {
    const other = "8a80a72d-fb01-3e17-9a96-2b801d16f82d";
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({
      [VANCORBUS]: "Vancorbus",
      [other]: "Elrid",
    });
    const h = new PlayerLeftHandler();

    await h.handle(fakeContext(publisher, resolver), playerLeaveEvent());
    await h.handle(
      fakeContext(publisher, resolver),
      playerLeaveEvent({ playerUuid: other, eventUuid: "00000000-0000-4000-8000-000000000002" }),
    );

    expect(publisher.publish.mock.calls[0]![0]).toEqual({
      title: "Jugador desconectado",
      body: "Vancorbus ha salido del servidor.",
      kind: "player_left",
    });
    expect(publisher.publish.mock.calls[1]![0]).toEqual({
      title: "Jugador desconectado",
      body: "Elrid ha salido del servidor.",
      kind: "player_left",
    });
  });

  it("player_uuid null: MissingPlayerUuidError, resolver NO se llama, publisher NO se llama", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({});
    const h = new PlayerLeftHandler();
    const event = playerLeaveEvent({ playerUuid: null, eventUuid: "00000000-0000-4000-8000-cafecafecafe" });

    const err = await h
      .handle(fakeContext(publisher, resolver), event)
      .catch((e) => e);

    expect(err).toBeInstanceOf(MissingPlayerUuidError);
    expect((err as MissingPlayerUuidError).eventUuid).toBe(event.event_uuid);
    expect((err as MissingPlayerUuidError).code).toBe("MISSING_PLAYER_UUID");
    expect((err as MissingPlayerUuidError).message).toContain("session.end");
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("resolver lanza PlayerNotFoundError: se propaga, publisher NO se llama", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({});
    const h = new PlayerLeftHandler();

    await expect(
      h.handle(fakeContext(publisher, resolver), playerLeaveEvent()),
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
    const h = new PlayerLeftHandler();

    const err = await h
      .handle(fakeContext(publisher, resolver), playerLeaveEvent())
      .catch((e) => e);
    expect(err).toBe(httpError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("publisher llamado exactamente una vez en caso feliz", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "X" });
    const h = new PlayerLeftHandler();
    await h.handle(fakeContext(publisher, resolver), playerLeaveEvent());
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
    const h = new PlayerLeftHandler();
    await expect(
      h.handle(fakeContext(publisher, resolver), playerLeaveEvent()),
    ).rejects.toBe(boom);
  });

  // ---------- freshness (BUG-02B — session.end via storeDurable) ----------

  it("session.end fresco: publica normalmente", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new PlayerLeftHandler();
    const event: EventRecord = {
      ...playerLeaveEvent(),
      ts: "2026-08-02T07:00:00.000Z",
      received_at: "2026-08-02T07:00:00.500Z",
    };
    await h.handle(fakeContext(publisher, resolver), event);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("session.end obsoleto (flushForShutdown reentregado): NO publica + WARN", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const warn = vi.fn();
    const h = new PlayerLeftHandler();
    const event: EventRecord = {
      ...playerLeaveEvent(),
      ts: "2026-08-01T09:08:00.000Z",
      received_at: "2026-08-02T07:01:00.000Z", // ~22h
    };
    await h.handle(fakeContext(publisher, resolver, { warn }), event);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect((resolver as unknown as { resolve: ReturnType<typeof vi.fn> }).resolve)
      .not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const p = warn.mock.calls[0]![0] as Record<string, unknown>;
    expect(p.handler).toBe("PlayerLeftHandler");
    expect(p.motivo).toBe("evento_obsoleto");
    expect(p.type).toBe("session.end");
  });

  it("evento obsoleto: NO lanza excepcion (cursor avanza)", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new PlayerLeftHandler();
    const event: EventRecord = {
      ...playerLeaveEvent(),
      ts: "2026-08-01T00:00:00.000Z",
      received_at: "2026-08-02T00:00:00.000Z",
    };
    await expect(
      h.handle(fakeContext(publisher, resolver), event),
    ).resolves.toBeUndefined();
  });

  it("funciona con cualquier Publisher fake (no depende de Discord)", async () => {
    const seen: PublishPayload[] = [];
    const publisher: Publisher = {
      publish: async (p) => {
        seen.push(p);
      },
    };
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new PlayerLeftHandler();
    await h.handle(fakeContext(publisher, resolver), playerLeaveEvent());
    expect(seen).toEqual([
      { title: "Jugador desconectado", body: "Vancorbus ha salido del servidor.", kind: "player_left" },
    ]);
  });
});
