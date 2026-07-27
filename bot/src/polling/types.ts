import type { EventRecord, GetEventsParams, GetEventsResponse } from "../eventstore";

// Tipos publicos del motor de polling.
//
// El motor coordina Cursor Store + Event Store Client + callback del
// consumidor. Su unica responsabilidad es orquestar el ciclo; el
// procesamiento de cada evento vive fuera del motor (en el
// consumidor).

/**
 * Callback que el motor invoca con cada lote de eventos nuevos.
 * DEBE ser async: el motor espera a que resuelva antes de persistir
 * el cursor. Si lanza cualquier excepcion, el motor NO actualiza el
 * cursor y los mismos eventos vuelven en la proxima iteracion —
 * garantia de "al menos una entrega" (at-least-once), no exactamente
 * una. El consumidor tiene que ser idempotente (ADR-010 principio 4).
 */
export type PollingConsumer = (events: readonly EventRecord[]) => Promise<void>;

/**
 * Superficie minima que el motor requiere del cliente HTTP.
 * `EventStoreClient` la cumple estructuralmente; en tests se puede
 * inyectar cualquier fake compatible. Aisla el motor del resto de
 * capacidades futuras del cliente.
 */
export interface EventFetcher {
  getEvents(params?: GetEventsParams): Promise<GetEventsResponse>;
}
