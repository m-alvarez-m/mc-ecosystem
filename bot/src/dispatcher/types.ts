import type { EventRecord } from "../eventstore";

// Tipos publicos del modulo dispatcher.
//
// El dispatcher no genera logs. Cuando llega un evento sin handler
// registrado, invoca este callback opcional para que el consumidor
// (metricas, observabilidad, alerta) haga lo que corresponda. Si no
// se provee, el evento se descarta silenciosamente sin ruido.

/**
 * Callback opcional invocado cuando el dispatcher recibe un evento
 * cuyo `type` no tiene handler registrado. El dispatcher continua con
 * el siguiente evento del lote (no aborta el batch).
 */
export type OnUnknownEventCallback = (event: EventRecord) => void;
