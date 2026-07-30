import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";

// ServerStartedHandler: primer EventHandler real de Pulso.
//
// Anuncia que el servidor de Minecraft ha iniciado. En el catalogo
// (docs/event-catalog.md) el tipo del evento es `server.start`; en el
// roadmap de Pulso este handler cubre el concepto SERVER_STARTED.
//
// El handler SOLO depende de context.publisher (interfaz Publisher).
// No conoce Discord, no conoce Minecraft, no conoce el Dispatcher ni
// el Polling Engine. Es intercambiable, testeable, y sustituible por
// otra implementacion sin tocar el resto del bot.

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

  async handle(context: DispatchContext, _event: EventRecord): Promise<void> {
    // `_event` esta disponible por contrato del EventHandler; este
    // handler no consume nada del payload por ahora. Cuando llegue el
    // caso (mostrar version, uptime del arranque previo, etc.), se
    // documenta el nuevo uso aqui.
    await context.publisher.publish({
      title: TITLE,
      body: BODY,
      kind: "server_started",
    });
  }
}
