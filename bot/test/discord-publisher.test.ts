import { describe, it, expect, vi } from "vitest";
import type { Client } from "discord.js";
import { DiscordPublisher } from "../src/discord/discord-publisher";
import {
  ChannelNotFoundError,
  ClientDisconnectedError,
  InvalidPayloadError,
  PublishError,
} from "../src/discord/errors";
import type { Publisher } from "../src/publisher";

// Tests del DiscordPublisher.
// Sin red, sin token, sin discord.js real: se inyectan fakes que
// satisfacen la subsuperficie de Client que el publisher usa, con un
// cast puntual `as unknown as Client`.

interface FakeChannel {
  isTextBased: () => boolean;
  send: (options: { content: string }) => Promise<unknown>;
}

interface FakeClientOptions {
  ready?: boolean;
  channel?: FakeChannel | null;
  fetchThrows?: Error;
}

function makeFakeClient(opts: FakeClientOptions): Client {
  const fake = {
    isReady: (): boolean => opts.ready ?? true,
    channels: {
      fetch: async (_id: string): Promise<FakeChannel | null> => {
        if (opts.fetchThrows) throw opts.fetchThrows;
        return opts.channel === undefined ? null : opts.channel;
      },
    },
  };
  return fake as unknown as Client;
}

function makeChannel(
  behavior?: Partial<{
    isText: boolean;
    sendImpl: (options: { content: string }) => Promise<unknown>;
  }>,
): FakeChannel & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(behavior?.sendImpl ?? (async () => undefined));
  return {
    isTextBased: () => behavior?.isText ?? true,
    send,
  };
}

const CHANNEL_ID = "987654321098765432";

describe("DiscordPublisher", () => {
  it("implementa la interfaz Publisher", () => {
    const client = makeFakeClient({ ready: true, channel: makeChannel() });
    const publisher: Publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });
    expect(typeof publisher.publish).toBe("function");
  });

  it("publica correctamente cuando cliente listo y canal valido", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await publisher.publish({ body: "hola mundo" });

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send).toHaveBeenCalledWith({ content: "hola mundo" });
  });

  it("publica solo body cuando no hay title", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await publisher.publish({ body: "sin titulo" });

    expect(channel.send).toHaveBeenCalledWith({ content: "sin titulo" });
  });

  it("formatea title + body como `**title**\\nbody`", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await publisher.publish({ title: "Nuevo evento", body: "Vancorbus se conecto" });

    expect(channel.send).toHaveBeenCalledWith({
      content: "**Nuevo evento**\nVancorbus se conecto",
    });
  });

  it("title vacio (string vacio) se ignora y solo va body", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await publisher.publish({ title: "", body: "solo body" });

    expect(channel.send).toHaveBeenCalledWith({ content: "solo body" });
  });

  it("cliente desconectado: lanza ClientDisconnectedError y no fetchea canal", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: false, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await expect(publisher.publish({ body: "algo" })).rejects.toBeInstanceOf(
      ClientDisconnectedError,
    );
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("canal null: lanza ChannelNotFoundError con el id", async () => {
    const client = makeFakeClient({ ready: true, channel: null });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    const err = await publisher.publish({ body: "algo" }).catch((e) => e);
    expect(err).toBeInstanceOf(ChannelNotFoundError);
    expect((err as ChannelNotFoundError).channelId).toBe(CHANNEL_ID);
  });

  it("canal no text-based: lanza ChannelNotFoundError", async () => {
    const channel = makeChannel({ isText: false });
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    const err = await publisher.publish({ body: "algo" }).catch((e) => e);
    expect(err).toBeInstanceOf(ChannelNotFoundError);
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("fetch del canal falla: lanza ChannelNotFoundError con .cause del error original en el mensaje", async () => {
    const original = new Error("Missing permissions");
    const client = makeFakeClient({ ready: true, fetchThrows: original });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    const err = await publisher.publish({ body: "algo" }).catch((e) => e);
    expect(err).toBeInstanceOf(ChannelNotFoundError);
    expect((err as ChannelNotFoundError).message).toContain("Missing permissions");
  });

  it("channel.send falla: lanza PublishError con causa original preservada", async () => {
    const original = new Error("rate limited");
    const channel = makeChannel({
      sendImpl: async () => {
        throw original;
      },
    });
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    const err = await publisher.publish({ body: "algo" }).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).cause).toBe(original);
  });

  it("body vacio: lanza InvalidPayloadError sin llamar a la api de Discord", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await expect(publisher.publish({ body: "" })).rejects.toBeInstanceOf(
      InvalidPayloadError,
    );
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("mensaje formateado excede 2000 chars: InvalidPayloadError sin round trip", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    // body de 2001 chars supera el limite duro.
    const body = "x".repeat(2001);

    const err = await publisher.publish({ body }).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidPayloadError);
    expect((err as InvalidPayloadError).message).toContain("2001");
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("mensaje formateado exactamente 2000 chars: se envia sin error", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    const body = "y".repeat(2000);
    await publisher.publish({ body });
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect((channel.send.mock.calls[0]![0] as { content: string }).content).toHaveLength(2000);
  });
});
