import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { MissingPlayerNameError } from "./errors";

// PlayerJoinedHandler: publica cuando un jugador se une al servidor.
//
// A diferencia de los handlers de server.start / server.stop, este
// consume el payload del evento (necesita el nombre del jugador para
// construir el mensaje). Si el payload no cumple lo minimo requerido,
// lanza MissingPlayerNameError (definido en ./errors, compartido con
// otros handlers) y NO publica nada — mejor un error tipado propagable
// al dispatcher que un mensaje "undefined se ha unido al servidor" en
// Discord.

const EVENT_TYPE = "player.join";

const TITLE = "Jugador conectado";

export class PlayerJoinedHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const name = extractPlayerName(event);
    await context.publisher.publish({
      title: TITLE,
      body: `${name} se ha unido al servidor.`,
    });
  }
}

/**
 * Extrae el nombre del jugador desde `event.data.name`. Lanza
 * MissingPlayerNameError si:
 *  - `data.name` no existe;
 *  - no es un string;
 *  - es un string vacio (o solo whitespace).
 *
 * Whitespace-only tambien se rechaza: publicar " se ha unido al
 * servidor." delata un bug aguas arriba mejor que enmascararlo.
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
