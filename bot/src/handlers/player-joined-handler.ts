import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { MissingPlayerUuidError } from "./errors";

// PlayerJoinedHandler: publica cuando un jugador se une al servidor.
//
// Resuelve el nombre por `context.playerNameResolver.resolve(uuid)`.
// El nombre NO se lee del payload del evento — el catalogo v1 no lo
// emite en `data`. La identidad canonica vive en la tabla `players`
// del api (poblada por session.start con data.name), y el resolver la
// obtiene por HTTP con cache (Etapa 4 del plan P0-2).
//
// Si el evento llega sin player_uuid a nivel raiz, lanza
// MissingPlayerUuidError. Si el resolver falla (404, timeout, etc.),
// el error tipado se propaga: mejor cursor stuck que "undefined se ha
// unido al servidor" en Discord.

const EVENT_TYPE = "session.start";

const TITLE = "Jugador conectado";

export class PlayerJoinedHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    if (event.player_uuid === null) {
      throw new MissingPlayerUuidError(EVENT_TYPE, event.event_uuid);
    }
    const name = await context.playerNameResolver.resolve(event.player_uuid);
    await context.publisher.publish({
      title: TITLE,
      body: `${name} se ha unido al servidor.`,
    });
  }
}
