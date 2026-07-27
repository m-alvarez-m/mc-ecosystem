// Taxonomia de errores del DiscordPublisher.
//
// El publisher NO imprime nada: propaga via throw. Errores tipados
// con `.code` estable para filtrado / metricas del consumidor.

export abstract class DiscordPublisherError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * El canal indicado no se pudo resolver, no existe, o existe pero no
 * es utilizable para enviar mensajes (canal de voz, categoria, etc.).
 * Se agrupan bajo un mismo codigo porque desde el punto de vista del
 * consumidor la accion correcta es la misma: revisar la config.
 */
export class ChannelNotFoundError extends DiscordPublisherError {
  readonly code = "CHANNEL_NOT_FOUND";

  constructor(
    public readonly channelId: string,
    reason?: string,
  ) {
    const suffix = reason !== undefined && reason.length > 0 ? `: ${reason}` : "";
    super(`Canal Discord no accesible (id="${channelId}")${suffix}`);
  }
}

/**
 * El cliente Discord no esta listo (todavia no hizo handshake con el
 * Gateway, o esta desconectado). Publicar antes de "ready" no tiene
 * sentido: la libreria mantiene una cola interna pero preferimos
 * fallar explicitamente y que el llamante decida reintentar.
 */
export class ClientDisconnectedError extends DiscordPublisherError {
  readonly code = "CLIENT_DISCONNECTED";

  constructor() {
    super("Cliente Discord no esta listo (no conectado al Gateway)");
  }
}

/**
 * Discord rechazo el envio del mensaje (rate limit, permisos
 * insuficientes, red, error 5xx del API). `.cause` conserva el error
 * original que discord.js emitio.
 */
export class PublishError extends DiscordPublisherError {
  readonly code = "PUBLISH_FAILED";

  constructor(message: string, options?: ErrorOptions) {
    super(`Fallo al publicar en Discord: ${message}`, options);
  }
}

/**
 * El PublishPayload no cumple las restricciones minimas para poder
 * enviarse (body vacio, longitud combinada > 2000 caracteres). Se
 * valida client-side para evitar round trips que la api de Discord
 * rechazaria igualmente.
 */
export class InvalidPayloadError extends DiscordPublisherError {
  readonly code = "INVALID_PAYLOAD";

  constructor(message: string) {
    super(`Payload invalido: ${message}`);
  }
}
