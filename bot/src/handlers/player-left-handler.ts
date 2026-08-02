import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { MissingPlayerUuidError } from "./errors";
import { computeLagMs, isFreshEvent } from "./freshness";

// PlayerLeftHandler: publica cuando un jugador sale del servidor.
//
// Gemelo de PlayerJoinedHandler. Resuelve el nombre via
// context.playerNameResolver. Si el evento llega sin player_uuid,
// MissingPlayerUuidError; si el resolver falla, se propaga el error
// tipado.
//
// Handler de ESTADO (BUG-02A §3): el `session.end` es uno de los
// eventos que el plugin envia via `storeDurable` en el shutdown
// (`SessionListener.flushForShutdown`) — mismo mecanismo que produjo
// el BUG-02. Descarta obsoletos silenciosamente antes de resolver el
// nombre.

const EVENT_TYPE = "session.end";

const TITLE = "Jugador desconectado";

export class PlayerLeftHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    if (!isFreshEvent(event, context.freshnessThresholdMs)) {
      context.logger.warn(
        {
          event_uuid: event.event_uuid,
          id: event.id,
          type: event.type,
          handler: "PlayerLeftHandler",
          ts: event.ts,
          received_at: event.received_at,
          lag_ms: computeLagMs(event),
          threshold_ms: context.freshnessThresholdMs,
          motivo: "evento_obsoleto",
        },
        "Evento de estado obsoleto descartado: no se publica en Discord",
      );
      return;
    }
    if (event.player_uuid === null) {
      throw new MissingPlayerUuidError(EVENT_TYPE, event.event_uuid);
    }
    const name = await context.playerNameResolver.resolve(event.player_uuid);
    await context.publisher.publish({
      title: TITLE,
      body: `${name} ha salido del servidor.`,
      kind: "player_left",
    });
  }
}
