import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { computeLagMs, isFreshEvent } from "./freshness";

// TpsHandler: emite alerta cuando el TPS del servidor baja del umbral
// configurado (T2 del backlog v1.1).
//
// Filosofía: los samples sanos son silencio. Un canal de Discord que
// recibe "TPS actual: 19.85" cada 60s es inservible. El handler
// publica sólo cuando hay que enterarse — TPS estrictamente por
// debajo del umbral se traduce en un mensaje que comunica
// degradación clara.
//
// Handler de ESTADO (BUG-02A §3): una alerta de degradacion tiene
// sentido AHORA, no de ayer. Los server.tps_sample tambien pasan por
// buffer del plugin (24 casos delayed observados en la DB); si un
// muestreo antiguo indicaba TPS 5 pero llegan 30 min tarde, publicar
// "Servidor lento" es mentir. Se descarta silenciosamente.
//
// La decisión vive AQUI, dentro del handler. Sin middleware, sin
// filtro en el dispatcher, sin lógica en el polling. Otros handlers
// no se ven afectados.

const EVENT_TYPE = "server.tps_sample";

const ALERT_TITLE = "Rendimiento degradado";

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

export interface TpsHandlerOptions {
  /**
   * Umbral debajo del cual se publica alerta (`tps < alertThreshold`).
   * Igual o mayor al umbral = silencio. Se acepta cualquier número
   * finito positivo (permite decimales: 18, 17.5, 15.8...).
   */
  alertThreshold: number;
}

export class TpsHandler implements EventHandler {
  private readonly alertThreshold: number;

  constructor(options: TpsHandlerOptions) {
    this.alertThreshold = options.alertThreshold;
  }

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
          handler: "TpsHandler",
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
    const tps = extractTps(event);
    if (tps >= this.alertThreshold) {
      // Sample sano: silencio absoluto. No publish, no log, no error.
      return;
    }
    await context.publisher.publish({
      title: ALERT_TITLE,
      body: `El servidor está lento: TPS ${String(tps)} (umbral ${String(this.alertThreshold)}).`,
      kind: "tps_degraded",
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
