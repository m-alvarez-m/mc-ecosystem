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

/**
 * Callback opcional invocado por cada evento entregado con exito a un
 * handler (handle() resolvio sin lanzar). Uso: instrumentacion. Si
 * lanza, el dispatcher swallow la excepcion — la observabilidad no
 * debe romper el dispatch.
 */
export type OnHandledEventCallback = (event: EventRecord) => void;

/**
 * Callback opcional invocado cuando un handler lanza. Recibe el
 * evento y el error CRUDO (antes de que el dispatcher lo envuelva en
 * HandlerExecutionError). Uso: instrumentacion. Si el propio callback
 * lanza, el dispatcher swallow: el error del handler se propaga igual
 * como HandlerExecutionError.
 */
export type OnHandlerFailedCallback = (event: EventRecord, err: unknown) => void;
