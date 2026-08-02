import type { EventRecord } from "../eventstore";

// Contrato de freshness para handlers de "estado".
//
// Un evento es fresco si el retardo entre ocurrencia (`ts`, marcado por
// el plugin) y llegada a la DB (`received_at`, marcado por postgres) es
// menor o igual al umbral. Los eventos obsoletos existen en el Event
// Store — no se borran ni se transforman —, pero los handlers que
// anuncian ESTADO ACTUAL (server.start, server.stop, session.start,
// session.end, server.tps_sample) los descartan silenciosamente para no
// mentirle al usuario ("Servidor detenido" con el servidor arriba).
//
// Ver BUG-02 / BUG-02A: el plugin `storeDurable` puede reentregar un
// server.stop de ayer al arrancar hoy; el orden por `id` en la api hace
// que el evento salga POSTERIOR al server.start fresco, y el bot lo
// publicaba como transición actual.
//
// Diseño:
// - Cálculo puramente derivado de campos del EventRecord — sin
//   `Date.now()`, sin estado persistente, sin dependencia del reloj del
//   bot. Determinista: dos réplicas ante el mismo registro deciden igual.
// - Fail-open ante timestamps mal formados: si no se puede parsear
//   `ts` o `received_at`, se trata como fresco. La validación estricta
//   de forma vive en el EventStoreClient; aquí no re-litigamos schema.

/**
 * Default: 2 minutos. Cota fundamentada en BUG-02A §7:
 * - > 30s: cubre el ciclo `RETRY_PERIOD_TICKS` del plugin (evita
 *   descartar reintentos benignos tras un hiccup HTTP).
 * - < 5min: captura todos los casos obsoletos observados en el Event
 *   Store (mínimo lag real ≥ 6min).
 */
export const DEFAULT_FRESHNESS_THRESHOLD_MS = 120_000;

/**
 * Diferencia `received_at - ts` en milisegundos. Devuelve `null` si
 * cualquiera de los dos timestamps no parsea (ambos deberían venir
 * validados por el EventStoreClient, pero el helper es defensivo).
 */
export function computeLagMs(event: EventRecord): number | null {
  const tsMs = Date.parse(event.ts);
  const receivedMs = Date.parse(event.received_at);
  if (!Number.isFinite(tsMs) || !Number.isFinite(receivedMs)) {
    return null;
  }
  return receivedMs - tsMs;
}

/**
 * `true` si el evento es fresco (lag <= threshold) o si el lag no se
 * puede calcular (fail-open). `false` sólo cuando hay una lectura clara
 * y ésta supera el umbral.
 */
export function isFreshEvent(
  event: EventRecord,
  thresholdMs: number,
): boolean {
  const lagMs = computeLagMs(event);
  if (lagMs === null) return true;
  return lagMs <= thresholdMs;
}
