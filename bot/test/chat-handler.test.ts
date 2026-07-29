import { describe, it, expect, vi } from "vitest";
import {
  ChatHandler,
  MissingChatMessageError,
} from "../src/handlers/chat-handler";
import { MissingPlayerNameError } from "../src/handlers/errors";
import type { DispatchContext } from "../src/context";
import type { Publisher, PublishPayload } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";

// Tests de ChatHandler.
// Sin Discord, sin red: publisher fake y contexto minimo.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

function fakeContext(publisher: Publisher): DispatchContext {
  return { publisher };
}

function chatEvent(
  data: Record<string, unknown>,
  uuid = "aaaa",
): EventRecord {
  return {
    id: "42",
    event_uuid: `00000000-0000-4000-8000-${uuid.padStart(12, "0")}`,
    type: "player.chat",
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

describe("ChatHandler", () => {
  it("supports('player.chat') true; otros false", () => {
    const h = new ChatHandler();
    expect(h.supports("player.chat")).toBe(true);
    expect(h.supports("chat.message")).toBe(false); // el del catalogo real
    expect(h.supports("player.join")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("PLAYER.CHAT")).toBe(false);
  });

  it("publicacion correcta con nombre y mensaje", async () => {
    const publisher = fakePublisher();
    const h = new ChatHandler();
    await h.handle(
      fakeContext(publisher),
      chatEvent({ name: "Vancorbus", message: "hola mundo" }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Chat",
      body: "Vancorbus: hola mundo",
    });
  });

  it("mensaje esperado para varios usuarios", async () => {
    const publisher = fakePublisher();
    const h = new ChatHandler();
    await h.handle(
      fakeContext(publisher),
      chatEvent({ name: "Pacman26", message: "por aqui" }),
    );
    await h.handle(
      fakeContext(publisher),
      chatEvent({ name: "Elrid", message: "voy" }),
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

  it("trimea whitespace del nombre pero NO del mensaje", async () => {
    const publisher = fakePublisher();
    const h = new ChatHandler();
    await h.handle(
      fakeContext(publisher),
      chatEvent({ name: "  Vancorbus  ", message: "  hola  " }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Chat",
      body: "Vancorbus:   hola  ",
    });
  });

  it("no filtra contenido: mensajes que parecen comandos se publican tal cual", async () => {
    const publisher = fakePublisher();
    const h = new ChatHandler();
    await h.handle(
      fakeContext(publisher),
      chatEvent({ name: "V", message: "/tp Vancorbus" }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Chat",
      body: "V: /tp Vancorbus",
    });
  });

  it("no trunca mensajes largos: se publica el mensaje completo", async () => {
    const publisher = fakePublisher();
    const h = new ChatHandler();
    const longMessage = "x".repeat(5000);
    await h.handle(
      fakeContext(publisher),
      chatEvent({ name: "V", message: longMessage }),
    );

    const call = publisher.publish.mock.calls[0]![0] as PublishPayload;
    expect(call.body).toBe(`V: ${longMessage}`);
    expect(call.body.length).toBe(5000 + 3); // "V: " (3 chars) + 5000
  });

  it("mensaje solo con whitespace es contenido valido y se publica", async () => {
    const publisher = fakePublisher();
    const h = new ChatHandler();
    await h.handle(fakeContext(publisher), chatEvent({ name: "V", message: "   " }));

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Chat",
      body: "V:    ",
    });
  });

  it("data.name ausente: MissingPlayerNameError y NO publica", async () => {
    const publisher = fakePublisher();
    const h = new ChatHandler();

    await expect(
      h.handle(fakeContext(publisher), chatEvent({ message: "hola" })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.name no-string o vacio: MissingPlayerNameError", async () => {
    const publisher = fakePublisher();
    const h = new ChatHandler();

    await expect(
      h.handle(fakeContext(publisher), chatEvent({ name: 42, message: "hola" })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    await expect(
      h.handle(fakeContext(publisher), chatEvent({ name: "  ", message: "hola" })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.message ausente: MissingChatMessageError y NO publica", async () => {
    const publisher = fakePublisher();
    const h = new ChatHandler();

    await expect(
      h.handle(fakeContext(publisher), chatEvent({ name: "V" })),
    ).rejects.toBeInstanceOf(MissingChatMessageError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.message no-string o vacio (length 0): MissingChatMessageError", async () => {
    const publisher = fakePublisher();
    const h = new ChatHandler();

    await expect(
      h.handle(fakeContext(publisher), chatEvent({ name: "V", message: 42 })),
    ).rejects.toBeInstanceOf(MissingChatMessageError);
    await expect(
      h.handle(fakeContext(publisher), chatEvent({ name: "V", message: "" })),
    ).rejects.toBeInstanceOf(MissingChatMessageError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("errores incluyen event_uuid y mencionan player.chat", async () => {
    const h = new ChatHandler();

    const eventA = chatEvent({ message: "x" }, "aaaa1111aaaa");
    const errA = await h
      .handle(fakeContext(fakePublisher()), eventA)
      .catch((e) => e);
    expect(errA).toBeInstanceOf(MissingPlayerNameError);
    expect((errA as MissingPlayerNameError).eventUuid).toBe(eventA.event_uuid);
    expect((errA as MissingPlayerNameError).message).toContain("player.chat");

    const eventB = chatEvent({ name: "V" }, "bbbb2222bbbb");
    const errB = await h
      .handle(fakeContext(fakePublisher()), eventB)
      .catch((e) => e);
    expect(errB).toBeInstanceOf(MissingChatMessageError);
    expect((errB as MissingChatMessageError).eventUuid).toBe(eventB.event_uuid);
    expect((errB as MissingChatMessageError).message).toContain("player.chat");
  });

  it("publisher llamado exactamente una vez en caso feliz", async () => {
    const publisher = fakePublisher();
    const h = new ChatHandler();
    await h.handle(fakeContext(publisher), chatEvent({ name: "V", message: "hola" }));
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("error del publisher se propaga tal cual", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const h = new ChatHandler();
    await expect(
      h.handle(fakeContext(publisher), chatEvent({ name: "V", message: "hola" })),
    ).rejects.toBe(boom);
  });

  it("funciona con cualquier Publisher fake (no depende de Discord)", async () => {
    const seen: PublishPayload[] = [];
    const publisher: Publisher = {
      publish: async (p) => {
        seen.push(p);
      },
    };
    const h = new ChatHandler();
    await h.handle(
      fakeContext(publisher),
      chatEvent({ name: "Vancorbus", message: "hola mundo minecraft" }),
    );
    expect(seen).toEqual([
      { title: "Chat", body: "Vancorbus: hola mundo minecraft" },
    ]);
  });
});
