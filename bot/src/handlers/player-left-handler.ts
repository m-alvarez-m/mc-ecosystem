import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";

// PlayerLeftHandler: publica cuando un jugador sale del servidor.
//
// Gemelo de PlayerJoinedHandler: consume `event.data.name`, valida,
// construye mensaje. Si el payload no cumple lo minimo, lanza
// MissingPlayerNameError y NO publica — mejor error tipado propagable
// al dispatcher que un "undefined ha salido del servidor" en Discord.

const EVENT_TYPE = "player.leave";

const TITLE = "Jugador desconectado";

/**
 * Error del handler cuando el payload no permite construir el mensaje.
 * Propagado al dispatcher, que lo envuelve en HandlerExecutionError y
 * detiene el batch (el polling engine no avanza el cursor).
 */
export class MissingPlayerNameError extends Error {
  readonly code = "MISSING_PLAYER_NAME";

  constructor(public readonly eventUuid: string) {
    super(
      `player.leave sin campo data.name valido (event_uuid=${eventUuid})`,
    );
    this.name = "MissingPlayerNameError";
  }
}

export class PlayerLeftHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const name = extractPlayerName(event);
    await context.publisher.publish({
      title: TITLE,
      body: `${name} ha salido del servidor.`,
    });
  }
}

/**
 * Extrae el nombre del jugador desde `event.data.name`. Lanza
 * MissingPlayerNameError si falta, no es string, o es vacio/whitespace.
 */
function extractPlayerName(event: EventRecord): string {
  const raw = event.data["name"];
  if (typeof raw !== "string") {
    throw new MissingPlayerNameError(event.event_uuid);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MissingPlayerNameError(event.event_uuid);
  }
  return trimmed;
}
