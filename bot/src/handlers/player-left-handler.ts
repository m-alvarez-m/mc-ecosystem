import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { MissingPlayerNameError } from "./errors";

// PlayerLeftHandler: publica cuando un jugador sale del servidor.
//
// Gemelo de PlayerJoinedHandler: consume `event.data.name`, valida,
// construye mensaje. Si el payload no cumple lo minimo, lanza
// MissingPlayerNameError (compartido en ./errors) y NO publica.

const EVENT_TYPE = "player.leave";

const TITLE = "Jugador desconectado";

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
    throw new MissingPlayerNameError(EVENT_TYPE, event.event_uuid);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MissingPlayerNameError(EVENT_TYPE, event.event_uuid);
  }
  return trimmed;
}
