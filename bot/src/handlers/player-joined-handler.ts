import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { MissingPlayerUuidError } from "./errors";
import { computeLagMs, isFreshEvent } from "./freshness";

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
//
// Handler de ESTADO (BUG-02A §3): anuncia "X se ha unido" en presente
// perfecto compuesto — mentira si el evento llega horas despues del
// login real (X ya salio hace tiempo). Descarta obsoletos silenciosamente.
// La validacion de frescura corre ANTES que el resolver: no gastar RTT
// resolviendo un nombre que no vamos a publicar.

const EVENT_TYPE = "session.start";

const TITLE = "Jugador conectado";

export class PlayerJoinedHandler implements EventHandler {
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
          handler: "PlayerJoinedHandler",
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
      body: `${name} se ha unido al servidor.`,
      kind: "player_joined",
    });
  }
}
