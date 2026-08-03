import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { computeLagMs, isFreshEvent } from "./freshness";

// ServerStartedHandler: primer EventHandler real de Pulso.
//
// Anuncia que el servidor de Minecraft ha iniciado. En el catalogo
// (docs/event-catalog.md) el tipo del evento es `server.start`; en el
// roadmap de Pulso este handler cubre el concepto SERVER_STARTED.
//
// Handler de ESTADO (BUG-02A §3): descarta silenciosamente eventos
// obsoletos (`received_at - ts > context.freshnessThresholdMs`) para
// no anunciar un arranque que ocurrio hace horas. El evento sigue en
// el Event Store; el cursor avanza igual.
//
// Defense-in-depth (BUG-02C): tras el chequeo de frescura, se consulta
// la maquina de estados `context.lifecycleState` para evitar publicar
// un DUPLICADO fresco:
//   - si el estado ya es "up", no publica y emite WARN "duplicado".
//   - si el estado es "unknown" o "down", publica y transiciona a "up".
//
// El handler SOLO depende de context.publisher (interfaz Publisher) y,
// para la validacion de frescura, de context.logger + freshnessThresholdMs
// + lifecycleState. No conoce Discord, no conoce Minecraft, no conoce
// el Dispatcher ni el Polling Engine.

const EVENT_TYPE = "server.start";

// Mensaje intencionalmente pobre en v1. Cuando se defina el tono
// editorial de Pulso (o se anadan datos utiles como version de MC,
// plugins cargados, etc.), sesion propia para revisitar formato.
const TITLE = "Servidor iniciado";
const BODY = "Servidor iniciado correctamente.";

export class ServerStartedHandler implements EventHandler {
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
          handler: "ServerStartedHandler",
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
    const priorState = context.lifecycleState.get();
    if (priorState === "up") {
      context.logger.warn(
        {
          event_uuid: event.event_uuid,
          id: event.id,
          type: event.type,
          handler: "ServerStartedHandler",
          ts: event.ts,
          received_at: event.received_at,
          prior_state: priorState,
          motivo: "duplicado_lifecycle",
        },
        "server.start duplicado (estado ya UP): no se publica en Discord",
      );
      return;
    }
    await context.publisher.publish({
      title: TITLE,
      body: BODY,
      kind: "server_started",
    });
    context.lifecycleState.set("up");
  }
}
