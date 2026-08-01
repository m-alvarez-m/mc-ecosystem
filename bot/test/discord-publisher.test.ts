import { describe, it, expect, vi } from "vitest";
import { EmbedBuilder, type Client } from "discord.js";
import { DiscordPublisher } from "../src/discord/discord-publisher";
import {
  ChannelNotFoundError,
  ClientDisconnectedError,
  InvalidPayloadError,
  PublishError,
} from "../src/discord/errors";
import { FOOTER_TEXT, KIND_COLORS, NEUTRAL_COLOR } from "../src/discord/embed-theme";
import type { Publisher } from "../src/publisher";

// Tests del DiscordPublisher.
// Sin red, sin token, sin discord.js real: se inyectan fakes que
// satisfacen la subsuperficie de Client que el publisher usa, con un
// cast puntual `as unknown as Client`.

interface SendOptions {
  embeds: EmbedBuilder[];
}

interface FakeChannel {
  isTextBased: () => boolean;
  send: (options: SendOptions) => Promise<unknown>;
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
    sendImpl: (options: SendOptions) => Promise<unknown>;
  }>,
): FakeChannel & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(behavior?.sendImpl ?? (async () => undefined));
  return {
    isTextBased: () => behavior?.isText ?? true,
    send,
  };
}

// Extrae el único embed del último send.
function lastEmbed(
  channel: { send: ReturnType<typeof vi.fn> },
): EmbedBuilder {
  const opts = channel.send.mock.calls[0]![0] as SendOptions;
  expect(opts.embeds).toBeDefined();
  expect(opts.embeds).toHaveLength(1);
  return opts.embeds[0]!;
}

const CHANNEL_ID = "987654321098765432";

describe("DiscordPublisher", () => {
  it("implementa la interfaz Publisher", () => {
    const client = makeFakeClient({ ready: true, channel: makeChannel() });
    const publisher: Publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });
    expect(typeof publisher.publish).toBe("function");
  });

  it("publica: envía embeds:[EmbedBuilder] con description, footer y timestamp", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await publisher.publish({ body: "hola mundo", kind: "chat" });

    expect(channel.send).toHaveBeenCalledOnce();
    const embed = lastEmbed(channel);
    expect(embed).toBeInstanceOf(EmbedBuilder);
    expect(embed.data.description).toBe("hola mundo");
    expect(embed.data.footer?.text).toBe(FOOTER_TEXT);
    expect(embed.data.timestamp).toBeDefined();
  });

  it("aplica el color por kind (chat = azul)", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await publisher.publish({ body: "hola", kind: "chat" });

    expect(lastEmbed(channel).data.color).toBe(KIND_COLORS.chat);
  });

  it.each([
    ["server_started", KIND_COLORS.server_started],
    ["server_stopped", KIND_COLORS.server_stopped],
    ["player_joined", KIND_COLORS.player_joined],
    ["player_left", KIND_COLORS.player_left],
    ["player_death", KIND_COLORS.player_death],
    ["advancement", KIND_COLORS.advancement],
    ["chat", KIND_COLORS.chat],
    ["tps_degraded", KIND_COLORS.tps_degraded],
    ["backup", KIND_COLORS.backup],
    ["dimension_first_enter", KIND_COLORS.dimension_first_enter],
    ["server_milestone", KIND_COLORS.server_milestone],
    ["boss_kill", KIND_COLORS.boss_kill],
  ] as const)("cada tipo usa el color esperado: %s", async (kind, expected) => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await publisher.publish({ body: "x", kind });

    expect(lastEmbed(channel).data.color).toBe(expected);
  });

  it("payload sin kind: color neutral por default (retrocompat)", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await publisher.publish({ body: "sin kind" });

    expect(lastEmbed(channel).data.color).toBe(NEUTRAL_COLOR);
  });

  it("preserva title cuando viene", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await publisher.publish({
      title: "Servidor iniciado",
      body: "Servidor iniciado correctamente.",
      kind: "server_started",
    });

    const embed = lastEmbed(channel);
    expect(embed.data.title).toBe("Servidor iniciado");
    expect(embed.data.description).toBe("Servidor iniciado correctamente.");
  });

  it("sin title: no setea title en el embed", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await publisher.publish({ body: "sin titulo", kind: "chat" });

    expect(lastEmbed(channel).data.title).toBeUndefined();
  });

  it("title vacio (string vacio): se ignora y no se setea title", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await publisher.publish({ title: "", body: "solo body", kind: "chat" });

    expect(lastEmbed(channel).data.title).toBeUndefined();
  });

  it("timestamp presente y parseable como ISO 8601", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    const t0 = Date.now();
    await publisher.publish({ body: "x", kind: "chat" });
    const t1 = Date.now();

    const ts = lastEmbed(channel).data.timestamp;
    expect(typeof ts).toBe("string");
    const parsed = new Date(ts as string).getTime();
    expect(Number.isFinite(parsed)).toBe(true);
    // El timestamp cae dentro del intervalo de la llamada (con margen
    // holgado para clock jitter).
    expect(parsed).toBeGreaterThanOrEqual(t0 - 1000);
    expect(parsed).toBeLessThanOrEqual(t1 + 1000);
  });

  it("footer del proyecto presente en todo embed", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await publisher.publish({ body: "x", kind: "chat" });
    expect(lastEmbed(channel).data.footer?.text).toBe(FOOTER_TEXT);
  });

  it("cliente desconectado: lanza ClientDisconnectedError y no fetchea canal", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: false, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await expect(
      publisher.publish({ body: "algo", kind: "chat" }),
    ).rejects.toBeInstanceOf(ClientDisconnectedError);
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("canal null: lanza ChannelNotFoundError con el id", async () => {
    const client = makeFakeClient({ ready: true, channel: null });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    const err = await publisher.publish({ body: "algo", kind: "chat" }).catch((e) => e);
    expect(err).toBeInstanceOf(ChannelNotFoundError);
    expect((err as ChannelNotFoundError).channelId).toBe(CHANNEL_ID);
  });

  it("canal no text-based: lanza ChannelNotFoundError", async () => {
    const channel = makeChannel({ isText: false });
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    const err = await publisher.publish({ body: "algo", kind: "chat" }).catch((e) => e);
    expect(err).toBeInstanceOf(ChannelNotFoundError);
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("fetch del canal falla: lanza ChannelNotFoundError con el error original en el mensaje", async () => {
    const original = new Error("Missing permissions");
    const client = makeFakeClient({ ready: true, fetchThrows: original });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    const err = await publisher.publish({ body: "algo", kind: "chat" }).catch((e) => e);
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

    const err = await publisher.publish({ body: "algo", kind: "chat" }).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).cause).toBe(original);
  });

  it("body vacio: lanza InvalidPayloadError sin llamar a la api de Discord", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    await expect(
      publisher.publish({ body: "", kind: "chat" }),
    ).rejects.toBeInstanceOf(InvalidPayloadError);
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("description excede 4096 chars (limite embed): InvalidPayloadError sin round trip", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    const body = "x".repeat(4097);
    const err = await publisher.publish({ body, kind: "chat" }).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidPayloadError);
    expect((err as InvalidPayloadError).message).toContain("4097");
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("description exactamente 4096 chars: se envia sin error", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    const body = "y".repeat(4096);
    await publisher.publish({ body, kind: "chat" });
    expect(channel.send).toHaveBeenCalledOnce();
    expect(lastEmbed(channel).data.description).toHaveLength(4096);
  });

  it("title excede 256 chars (limite embed): InvalidPayloadError sin round trip", async () => {
    const channel = makeChannel();
    const client = makeFakeClient({ ready: true, channel });
    const publisher = new DiscordPublisher({ client, channelId: CHANNEL_ID });

    const title = "t".repeat(257);
    const err = await publisher.publish({ title, body: "x", kind: "chat" }).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidPayloadError);
    expect((err as InvalidPayloadError).message).toContain("257");
    expect(channel.send).not.toHaveBeenCalled();
  });
});
