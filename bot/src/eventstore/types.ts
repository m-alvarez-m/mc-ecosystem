// Tipos del contrato de lectura del Event Store expuesto por la api.
// Refleja el schema definido en docs/event-catalog.md (v1) y los
// parametros que ADR-010 fija para el consumo por cursor sobre `id`.

/**
 * BIGINT sequential `id` de la tabla `events`. Se transporta como
 * string en JSON para evitar perdida de precision: Number solo
 * garantiza enteros hasta 2^53, mientras que BIGINT llega hasta 2^63.
 * El consumidor lo trata opacamente (compara igualdad, lo envia en la
 * proxima query como `after_id`), no como numero para aritmetica.
 */
export type EventId = string;

/**
 * Tipo del evento (p. ej. "session.start", "block.break"). Se deja
 * como string abierto: el catalogo evoluciona sin obligar a cambios
 * en el cliente. Los consumidores que necesiten valores concretos
 * hacen su propia constante o union.
 */
export type EventType = string;

/**
 * Evento tal como lo expone la api HTTP. Los campos comunes viven
 * como columnas top-level; `data` lleva el payload especifico del
 * tipo (ver catalogo).
 */
export interface EventRecord {
  id: EventId;
  event_uuid: string;
  type: EventType;
  v: number;
  ts: string;             // ISO 8601 UTC (lo pone el productor)
  received_at: string;    // ISO 8601 UTC (lo pone la DB al insertar)
  player_uuid: string | null;
  world: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  data: Record<string, unknown>;
}

/**
 * Parametros de consulta para GET /events. Todos opcionales:
 * - after_id: cursor exclusivo (`id > after_id`). Ausente = desde el
 *   principio de la tabla o desde la politica de cursor inicial del
 *   consumidor.
 * - limit: cota superior de eventos devueltos. La api aplica un tope
 *   duro por su cuenta; este limit es una preferencia del cliente.
 * - types: filtro por tipo. Ausente / vacio = sin filtro (la api
 *   devolvera todos los tipos, con el coste que eso implica).
 */
export interface GetEventsParams {
  after_id?: EventId;
  limit?: number;
  types?: readonly string[];
}

/**
 * Respuesta de GET /events. `events` viene ordenado ascendentemente
 * por `id`. `last_id` es el `id` del ultimo evento del batch, listo
 * para pasarlo como `after_id` en la proxima query. `null` cuando el
 * batch salio vacio (no hay eventos nuevos): el consumidor conserva
 * su cursor previo.
 */
export interface GetEventsResponse {
  events: readonly EventRecord[];
  last_id: EventId | null;
}
