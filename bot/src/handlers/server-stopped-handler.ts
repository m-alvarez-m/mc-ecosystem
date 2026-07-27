import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";

// ServerStoppedHandler: gemelo de ServerStartedHandler.
//
// Cubre el evento `server.stop` del catalogo (SERVER_STOPPED
// conceptual del roadmap Pulso). Se activa cuando el servidor de
// Minecraft se apaga ordenadamente (via stop-mc.bat / docker stop /
// EventCollector.onDisable).
//
// El handler solo depende de context.publisher (interfaz Publisher).
// No conoce Discord, no conoce Minecraft, no conoce dispatcher ni
// polling engine.

const EVENT_TYPE = "server.stop";

// Mensaje minimo. Cuando se quiera mostrar `data.uptime_s` u otras
// metricas del catalogo, sesion propia para revisitar formato.
const TITLE = "Servidor detenido";
const BODY = "Servidor detenido correctamente.";

export class ServerStoppedHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, _event: EventRecord): Promise<void> {
    // `_event` disponible por contrato; v1 no consume nada del payload.
    await context.publisher.publish({
      title: TITLE,
      body: BODY,
    });
  }
}
