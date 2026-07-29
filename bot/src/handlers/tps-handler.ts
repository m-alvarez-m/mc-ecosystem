import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";

// TpsHandler: publica el TPS (ticks per second) actual del servidor
// cuando llega un evento de muestreo.
//
// El handler es "puro reporte": no calcula promedios, no aplica
// umbrales, no clasifica el valor como bueno o malo. Muestra el
// numero tal cual. Si en el futuro se quiere alertar de TPS bajos,
// vive fuera (handler propio con umbral configurable, dashboard,
// alerta externa).

const EVENT_TYPE = "server.tps_sample";

const TITLE = "Estado del servidor";

/**
 * Error del handler cuando el payload no permite construir el mensaje.
 * Cubre "TPS faltante" y "TPS invalido" (no numerico, NaN, Infinity)
 * en una misma clase — desde el punto de vista del consumidor la
 * accion es la misma: revisar el productor que emitio el evento.
 */
export class InvalidTpsError extends Error {
  readonly code = "INVALID_TPS";

  constructor(public readonly eventUuid: string) {
    super(
      `server.tps_sample sin campo data.tps_1m numerico valido (event_uuid=${eventUuid})`,
    );
    this.name = "InvalidTpsError";
  }
}

export class TpsHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const tps = extractTps(event);
    await context.publisher.publish({
      title: TITLE,
      body: `TPS actual: ${String(tps)}`,
    });
  }
}

/**
 * TPS del payload. Viene en `data.tps_1m` (media del ultimo minuto)
 * segun el catalogo. Requerido y numerico. Number.isFinite rechaza:
 * - undefined / null (typeof !== "number")
 * - NaN
 * - Infinity / -Infinity
 * Aceptamos negativos y ceros porque tecnicamente son valores validos
 * del sensor (aunque raros); NO es nuestra funcion clasificar.
 */
function extractTps(event: EventRecord): number {
  const raw = event.data["tps_1m"];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new InvalidTpsError(event.event_uuid);
  }
  return raw;
}
