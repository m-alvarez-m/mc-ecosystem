import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { MissingPlayerNameError } from "./errors";

// ChatHandler: publica cada mensaje de chat del servidor.
//
// Dos campos REQUERIDOS del payload:
// - `data.name`: nombre del jugador.
// - `data.message`: contenido del mensaje.
//
// Politica de contenido:
// - NO se filtra el contenido del mensaje.
// - NO se truncan mensajes largos.
// - NO se interpretan comandos (aunque empiecen con "/").
// El mensaje viaja tal cual del payload al Publisher, que si tiene
// limites propios (Discord: 2000 chars) los aplicara con su propia
// politica de error.

const EVENT_TYPE = "player.chat";

const TITLE = "Chat";

/**
 * Error del handler cuando falta el mensaje. Se lanza si
 * `data.message` no existe, no es string, o es cadena vacia (length 0).
 * Whitespace-only SI se publica: es contenido, no ausencia.
 */
export class MissingChatMessageError extends Error {
  readonly code = "MISSING_CHAT_MESSAGE";

  constructor(public readonly eventUuid: string) {
    super(
      `player.chat sin campo data.message valido (event_uuid=${eventUuid})`,
    );
    this.name = "MissingChatMessageError";
  }
}

export class ChatHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const name = extractPlayerName(event);
    const message = extractChatMessage(event);

    await context.publisher.publish({
      title: TITLE,
      body: `${name}: ${message}`,
    });
  }
}

/**
 * Nombre del jugador. Identificador: trimeamos whitespace antes de
 * validar (misma politica que en los otros handlers). Vacio -> error.
 */
function extractPlayerName(event: EventRecord): string {
  const raw = event.data["name"];
  if (typeof raw !== "string") {
    throw new MissingPlayerNameError(EVENT_TYPE, event.event_uuid);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MissingPlayerNameError(EVENT_TYPE, event.event_uuid);
  }
  return trimmed;
}

/**
 * Contenido del mensaje. NO trimeamos: es contenido de usuario, no
 * identificador. Solo validamos que exista como string no-vacio.
 * Whitespace-only ("   ") es valido y se publica tal cual — el
 * usuario decidio enviarlo asi.
 */
function extractChatMessage(event: EventRecord): string {
  const raw = event.data["message"];
  if (typeof raw !== "string") {
    throw new MissingChatMessageError(event.event_uuid);
  }
  if (raw.length === 0) {
    throw new MissingChatMessageError(event.event_uuid);
  }
  return raw;
}
