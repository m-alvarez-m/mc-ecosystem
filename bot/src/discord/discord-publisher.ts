import { EmbedBuilder, type Client } from "discord.js";
import type { Publisher, PublishPayload } from "../publisher";
import { FOOTER_TEXT, colorForKind } from "./embed-theme";
import {
  ChannelNotFoundError,
  ClientDisconnectedError,
  InvalidPayloadError,
  PublishError,
} from "./errors";

// DiscordPublisher: adaptador entre la abstraccion Publisher (dominio)
// y discord.js (infraestructura).
//
// Responsabilidad UNICA: convertir `PublishPayload` en un mensaje de
// Discord y enviarlo al canal configurado. NO decide QUE publicar
// (eso lo hacen los handlers), NO conoce Minecraft, NO maneja slash
// commands.
//
// A partir de T6 v1.1 el mensaje de salida es un EmbedBuilder — el
// unico sitio del bot que conoce EmbedBuilder es esta clase (mas el
// tema en `./embed-theme`). Añadir iconos, thumbnails, campos o
// componentes futuros = editar aquí y el tema, cero cambios en
// handlers.
//
// Diseno:
// - Inyeccion de `Client` en el constructor (no lo instancia).
// - Canal por id previamente conocido (no lookup por nombre).
// - Formato de mensaje: embed unico con title, description, color
//   (por `kind`), timestamp automatico y footer uniforme del proyecto.

// Limites de embed segun docs de Discord (v10 API).
const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;
const DISCORD_EMBED_TITLE_LIMIT = 256;

export interface DiscordPublisherOptions {
  client: Client;
  channelId: string;
}

export class DiscordPublisher implements Publisher {
  private readonly client: Client;
  private readonly channelId: string;

  constructor(options: DiscordPublisherOptions) {
    this.client = options.client;
    this.channelId = options.channelId;
  }

  async publish(payload: PublishPayload): Promise<void> {
    if (!this.client.isReady()) {
      throw new ClientDisconnectedError();
    }

    // Validaciones client-side. Discord rechazaria igual, pero
    // fallar aqui evita el round trip y da mensaje diagnostico
    // preciso.
    if (payload.body.length === 0) {
      throw new InvalidPayloadError("body es requerido y no puede estar vacio");
    }
    if (payload.body.length > DISCORD_EMBED_DESCRIPTION_LIMIT) {
      throw new InvalidPayloadError(
        `descripcion del embed excede el limite de Discord (${payload.body.length} > ${DISCORD_EMBED_DESCRIPTION_LIMIT} chars)`,
      );
    }
    if (
      payload.title !== undefined &&
      payload.title.length > DISCORD_EMBED_TITLE_LIMIT
    ) {
      throw new InvalidPayloadError(
        `titulo del embed excede el limite de Discord (${payload.title.length} > ${DISCORD_EMBED_TITLE_LIMIT} chars)`,
      );
    }

    const embed = buildEmbed(payload);

    let channel;
    try {
      channel = await this.client.channels.fetch(this.channelId);
    } catch (err) {
      // Fallo al RESOLVER (permisos del bot, canal borrado, etc.). Es
      // distinto conceptualmente de un fallo al enviar (que llega mas
      // abajo). Ambos indican "el canal no esta accesible ahora".
      throw new ChannelNotFoundError(
        this.channelId,
        err instanceof Error ? err.message : String(err),
      );
    }
    if (channel === null) {
      throw new ChannelNotFoundError(this.channelId, "la api devolvio null");
    }
    if (!channel.isTextBased()) {
      throw new ChannelNotFoundError(
        this.channelId,
        "el canal no es text-based (voz, categoria, etc.)",
      );
    }
    // Defensa extra: algunos subtipos de canal text-based no exponen
    // .send. Chequeo runtime + cast al minimo shape que necesitamos.
    const sendable = channel as unknown as {
      send: (options: { embeds: EmbedBuilder[] }) => Promise<unknown>;
    };
    if (typeof sendable.send !== "function") {
      throw new ChannelNotFoundError(this.channelId, "canal sin metodo send()");
    }

    try {
      await sendable.send({ embeds: [embed] });
    } catch (err) {
      throw new PublishError(
        err instanceof Error ? err.message : String(err),
        err instanceof Error ? { cause: err } : undefined,
      );
    }
  }
}

/**
 * Convierte un PublishPayload en un EmbedBuilder aplicando el tema
 * unico (color por kind, footer uniforme, timestamp del momento del
 * publish). El titulo es opcional: si viene ausente o vacio, se omite.
 *
 * Puro (no toca IO). Aisla toda la logica visual del transporte HTTP
 * al canal Discord — facilita tests unitarios y evolucion futura del
 * layout sin tocar la lógica de envio.
 */
function buildEmbed(payload: PublishPayload): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(colorForKind(payload.kind))
    .setDescription(payload.body)
    .setTimestamp()
    .setFooter({ text: FOOTER_TEXT });

  if (payload.title !== undefined && payload.title.length > 0) {
    embed.setTitle(payload.title);
  }

  return embed;
}
