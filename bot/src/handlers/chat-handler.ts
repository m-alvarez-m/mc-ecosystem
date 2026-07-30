import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { sanitizeDiscordMessage } from "../discord/sanitize-discord-message";
import { MissingPlayerUuidError } from "./errors";

// ChatHandler: publica cada mensaje de chat del servidor.
//
// Consume:
// - player_uuid (raiz, obligatorio) → resolver → nombre canonico.
// - data.content (obligatorio): contenido del mensaje.
//
// Politica de contenido:
// - NO se filtra el contenido del mensaje.
// - NO se truncan mensajes largos.
// - NO se interpretan comandos (aunque empiecen con "/").
// El mensaje viaja tal cual del payload al Publisher, que si tiene
// limites propios (Discord: 2000 chars) los aplicara con su propia
// politica de error.

const EVENT_TYPE = "chat.message";

const TITLE = "Chat";

/**
 * Error del handler cuando falta el contenido del mensaje. Se lanza
 * si `data.content` no existe, no es string, o es cadena vacia
 * (length 0). Whitespace-only SI se publica: es contenido, no ausencia.
 */
export class MissingChatMessageError extends Error {
  readonly code = "MISSING_CHAT_MESSAGE";

  constructor(public readonly eventUuid: string) {
    super(
      `chat.message sin campo data.content valido (event_uuid=${eventUuid})`,
    );
    this.name = "MissingChatMessageError";
  }
}

export class ChatHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    if (event.player_uuid === null) {
      throw new MissingPlayerUuidError(EVENT_TYPE, event.event_uuid);
    }
    const name = await context.playerNameResolver.resolve(event.player_uuid);
    const message = sanitizeDiscordMessage(extractChatMessage(event));

    await context.publisher.publish({
      title: TITLE,
      body: `${name}: ${message}`,
      kind: "chat",
    });
  }
}

/**
 * Contenido del mensaje. Viene en `data.content` segun el catalogo.
 * NO trimeamos: es contenido de usuario, no identificador. Solo
 * validamos que exista como string no-vacio. Whitespace-only ("   ")
 * es valido y se publica tal cual — el usuario decidio enviarlo asi.
 */
function extractChatMessage(event: EventRecord): string {
  const raw = event.data["content"];
  if (typeof raw !== "string") {
    throw new MissingChatMessageError(event.event_uuid);
  }
  if (raw.length === 0) {
    throw new MissingChatMessageError(event.event_uuid);
  }
  return raw;
}
