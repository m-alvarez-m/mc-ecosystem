import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { computeLagMs, isFreshEvent } from "./freshness";

// ServerStoppedHandler: gemelo de ServerStartedHandler.
//
// Cubre el evento `server.stop` del catalogo (SERVER_STOPPED
// conceptual del roadmap Pulso). Se activa cuando el servidor de
// Minecraft se apaga ordenadamente (via stop-mc.bat / docker stop /
// EventCollector.onDisable).
//
// Handler de ESTADO (BUG-02A §3): el escenario reportado en BUG-02
// era exactamente este handler publicando "Servidor detenido" con el
// servidor arriba porque el plugin `storeDurable` reentrego un
// server.stop de la sesion anterior. Descarta obsoletos silenciosamente
// para bloquear ese modo de fallo.
//
// Defense-in-depth (BUG-02C): tras el chequeo de frescura, se consulta
// la maquina de estados `context.lifecycleState` para evitar publicar
// un DUPLICADO fresco:
//   - si el estado ya es "down", no publica y emite WARN "duplicado".
//   - si el estado es "unknown" o "up", publica y transiciona a "down".

const EVENT_TYPE = "server.stop";

// Mensaje minimo. Cuando se quiera mostrar `data.uptime_s` u otras
// metricas del catalogo, sesion propia para revisitar formato.
const TITLE = "Servidor detenido";
const BODY = "Servidor detenido correctamente.";

export class ServerStoppedHandler implements EventHandler {
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
          handler: "ServerStoppedHandler",
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
    if (priorState === "down") {
      context.logger.warn(
        {
          event_uuid: event.event_uuid,
          id: event.id,
          type: event.type,
          handler: "ServerStoppedHandler",
          ts: event.ts,
          received_at: event.received_at,
          prior_state: priorState,
          motivo: "duplicado_lifecycle",
        },
        "server.stop duplicado (estado ya DOWN): no se publica en Discord",
      );
      return;
    }
    await context.publisher.publish({
      title: TITLE,
      body: BODY,
      kind: "server_stopped",
    });
    context.lifecycleState.set("down");
  }
}
