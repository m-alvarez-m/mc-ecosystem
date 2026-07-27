import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";

// PlayerJoinedHandler: publica cuando un jugador se une al servidor.
//
// A diferencia de los handlers de server.start / server.stop, este
// consume el payload del evento (necesita el nombre del jugador para
// construir el mensaje). Si el payload no cumple lo minimo requerido,
// lanza MissingPlayerNameError y NO publica nada — mejor un error
// tipado propagable al dispatcher que un mensaje "undefined se ha
// unido al servidor" en Discord.

const EVENT_TYPE = "player.join";

const TITLE = "Jugador conectado";

/**
 * Error del handler cuando el payload del evento no permite construir
 * el mensaje. Propagado al dispatcher, que a su vez lo envuelve en
 * HandlerExecutionError y detiene el batch (el polling engine no
 * avanza el cursor y el evento vuelve a la proxima iteracion).
 */
export class MissingPlayerNameError extends Error {
  readonly code = "MISSING_PLAYER_NAME";

  constructor(public readonly eventUuid: string) {
    super(
      `player.join sin campo data.name valido (event_uuid=${eventUuid})`,
    );
    this.name = "MissingPlayerNameError";
  }
}

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
    throw new MissingPlayerNameError(event.event_uuid);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MissingPlayerNameError(event.event_uuid);
  }
  return trimmed;
}
