import { describe, it, expect, vi } from "vitest";
import {
  ChatHandler,
  MissingChatMessageError,
} from "../src/handlers/chat-handler";
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

function chatEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-000000000001",
    type: "chat.message",
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? VANCORBUS : overrides.playerUuid,
    world: null,
    x: null,
    y: null,
    z: null,
    data: overrides.data ?? { content: "hola mundo", length: 10 },
  };
}

describe("ChatHandler", () => {
  it("supports('chat.message') true; otros false", () => {
    const h = new ChatHandler();
    expect(h.supports("chat.message")).toBe(true);
    expect(h.supports("session.start")).toBe(false);
    expect(h.supports("player.death")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("CHAT.MESSAGE")).toBe(false);
  });

  it("caso feliz: resolver + content → body '<nombre>: <mensaje>'", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new ChatHandler();

    await h.handle(
      fakeContext(publisher, resolver),
      chatEvent({ data: { content: "hola mundo" } }),
    );

    expect(resolver.resolve).toHaveBeenCalledWith(VANCORBUS);
    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Chat",
      body: "Vancorbus: hola mundo",
    });
  });

  it("distintos player_uuid resuelven a distintos nombres", async () => {
    const other = "8a80a72d-fb01-3e17-9a96-2b801d16f82d";
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({
      [VANCORBUS]: "Pacman26",
      [other]: "Elrid",
    });
    const h = new ChatHandler();

    await h.handle(
      fakeContext(publisher, resolver),
      chatEvent({ data: { content: "por aqui" } }),
    );
    await h.handle(
      fakeContext(publisher, resolver),
      chatEvent({
        playerUuid: other,
        eventUuid: "00000000-0000-4000-8000-000000000002",
        data: { content: "voy" },
      }),
    );

    expect(publisher.publish.mock.calls[0]![0]).toEqual({
      title: "Chat",
      body: "Pacman26: por aqui",
    });
    expect(publisher.publish.mock.calls[1]![0]).toEqual({
      title: "Chat",
      body: "Elrid: voy",
    });
  });

  it("NO trimea el content (es contenido de usuario)", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new ChatHandler();
    await h.handle(
      fakeContext(publisher, resolver),
      chatEvent({ data: { content: "  hola  " } }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Chat",
      body: "Vancorbus:   hola  ",
    });
  });

  it("no filtra contenido: mensajes que parecen comandos se publican tal cual", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "V" });
    const h = new ChatHandler();
    await h.handle(
      fakeContext(publisher, resolver),
      chatEvent({ data: { content: "/tp Vancorbus" } }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Chat",
      body: "V: /tp Vancorbus",
    });
  });

  it("no trunca mensajes largos", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "V" });
    const h = new ChatHandler();
    const longMessage = "x".repeat(5000);
    await h.handle(
      fakeContext(publisher, resolver),
      chatEvent({ data: { content: longMessage } }),
    );

    const call = publisher.publish.mock.calls[0]![0] as PublishPayload;
    expect(call.body).toBe(`V: ${longMessage}`);
    expect(call.body.length).toBe(5000 + 3);
  });

  it("content solo whitespace es contenido valido y se publica", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "V" });
    const h = new ChatHandler();
    await h.handle(
      fakeContext(publisher, resolver),
      chatEvent({ data: { content: "   " } }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Chat",
      body: "V:    ",
    });
  });

  it("player_uuid null: MissingPlayerUuidError, resolver NO se llama, publisher NO se llama", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({});
    const h = new ChatHandler();
    const event = chatEvent({ playerUuid: null, eventUuid: "00000000-0000-4000-8000-cafecafecafe" });

    const err = await h
      .handle(fakeContext(publisher, resolver), event)
      .catch((e) => e);

    expect(err).toBeInstanceOf(MissingPlayerUuidError);
    expect((err as MissingPlayerUuidError).eventUuid).toBe(event.event_uuid);
    expect((err as MissingPlayerUuidError).code).toBe("MISSING_PLAYER_UUID");
    expect((err as MissingPlayerUuidError).message).toContain("chat.message");
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.content ausente / no-string / vacio: MissingChatMessageError", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "V" });
    const h = new ChatHandler();

    await expect(
      h.handle(
        fakeContext(publisher, resolver),
        chatEvent({ eventUuid: "00000000-0000-4000-8000-000000000010", data: {} }),
      ),
    ).rejects.toBeInstanceOf(MissingChatMessageError);
    await expect(
      h.handle(
        fakeContext(publisher, resolver),
        chatEvent({ eventUuid: "00000000-0000-4000-8000-000000000011", data: { content: 42 } }),
      ),
    ).rejects.toBeInstanceOf(MissingChatMessageError);
    await expect(
      h.handle(
        fakeContext(publisher, resolver),
        chatEvent({ eventUuid: "00000000-0000-4000-8000-000000000012", data: { content: "" } }),
      ),
    ).rejects.toBeInstanceOf(MissingChatMessageError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("resolver lanza PlayerNotFoundError: se propaga, publisher NO se llama", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({});
    const h = new ChatHandler();

    await expect(
      h.handle(fakeContext(publisher, resolver), chatEvent()),
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
    const h = new ChatHandler();

    const err = await h
      .handle(fakeContext(publisher, resolver), chatEvent())
      .catch((e) => e);
    expect(err).toBe(httpError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("publisher llamado exactamente una vez en caso feliz", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "V" });
    const h = new ChatHandler();
    await h.handle(fakeContext(publisher, resolver), chatEvent());
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("error del publisher se propaga tal cual", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "V" });
    const h = new ChatHandler();
    await expect(
      h.handle(fakeContext(publisher, resolver), chatEvent()),
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
    const h = new ChatHandler();
    await h.handle(
      fakeContext(publisher, resolver),
      chatEvent({ data: { content: "hola mundo minecraft" } }),
    );
    expect(seen).toEqual([
      { title: "Chat", body: "Vancorbus: hola mundo minecraft" },
    ]);
  });

  it("sanitiza menciones de Discord antes de publicar (T1)", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new ChatHandler();
    await h.handle(
      fakeContext(publisher, resolver),
      chatEvent({
        data: {
          content: "hola @everyone y @here, <@1> <@!2> <@&3>",
        },
      }),
    );

    const body = publisher.publish.mock.calls[0]![0].body as string;
    // El texto contiene los tokens neutralizados; no queda ninguna
    // mención parseable por Discord.
    expect(body).toContain("Vancorbus: ");
    expect(body).not.toMatch(/@everyone|@here|<@[!&]?\d+>/);
    // Y el nombre resuelto NO se sanitiza como si fuese texto de usuario:
    // "Vancorbus" no contiene ZWSP.
    expect(body.startsWith("Vancorbus: ")).toBe(true);
  });
});
