import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { MissingPlayerUuidError } from "./errors";

// PlayerLeftHandler: publica cuando un jugador sale del servidor.
//
// Gemelo de PlayerJoinedHandler. Resuelve el nombre via
// context.playerNameResolver. Si el evento llega sin player_uuid,
// MissingPlayerUuidError; si el resolver falla, se propaga el error
// tipado.

const EVENT_TYPE = "session.end";

const TITLE = "Jugador desconectado";

export class PlayerLeftHandler implements EventHandler {
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
      body: `${name} ha salido del servidor.`,
    });
  }
}
