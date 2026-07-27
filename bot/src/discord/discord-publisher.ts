import type { Client } from "discord.js";
import type { Publisher, PublishPayload } from "../publisher";
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
// Discord y enviarlo al canal configurado. No decide QUE publicar
// (eso lo hacen los handlers), no construye embeds complejos, no
// conoce Minecraft, no maneja slash commands.
//
// Diseno:
// - Inyeccion de `Client` en el constructor (no lo instancia). Testear
//   sin Discord real es trivial: pasar un objeto que satisfaga la
//   subsuperficie que usamos y castear.
// - Canal por id previamente conocido (no lookup por nombre, no scan
//   de servidores). Ver ADR-008 y el racional del design doc de
//   Pulso.
// - Formato minimo: `**title**\n body`, o `body` solo. Sin embed
//   rico, sin componentes, sin markdown avanzado. Todo eso vive en
//   sesiones posteriores como Publisher especializado o como decorator.

// Limite duro del content field de Discord (2000 chars). Validamos
// client-side para evitar round trips que la API rechazaria igual.
const DISCORD_CONTENT_LIMIT = 2000;

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

    const content = formatContent(payload);
    if (content.length === 0) {
      throw new InvalidPayloadError("body es requerido y no puede estar vacio");
    }
    if (content.length > DISCORD_CONTENT_LIMIT) {
      throw new InvalidPayloadError(
        `mensaje excede el limite de Discord (${content.length} > ${DISCORD_CONTENT_LIMIT} chars)`,
      );
    }

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
    // .send (raro pero posible en versiones de discord.js). Chequeo
    // runtime + cast al minimo shape que necesitamos usar.
    const sendable = channel as unknown as {
      send: (options: { content: string }) => Promise<unknown>;
    };
    if (typeof sendable.send !== "function") {
      throw new ChannelNotFoundError(this.channelId, "canal sin metodo send()");
    }

    try {
      await sendable.send({ content });
    } catch (err) {
      throw new PublishError(
        err instanceof Error ? err.message : String(err),
        err instanceof Error ? { cause: err } : undefined,
      );
    }
  }
}

/**
 * Convierte PublishPayload en el string que va al campo `content` del
 * mensaje. `title` opcional se antepone en negrita con salto de linea.
 * No es negociable con el catalogo: es la unica decision de formato
 * que este adapter toma. Si se quiere mas riqueza, sesion propia
 * para un Publisher que use embeds.
 */
function formatContent(payload: PublishPayload): string {
  if (payload.title !== undefined && payload.title.length > 0) {
    return `**${payload.title}**\n${payload.body}`;
  }
  return payload.body;
}
