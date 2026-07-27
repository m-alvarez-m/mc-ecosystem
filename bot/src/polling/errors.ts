// Taxonomia de errores del Polling Engine.
//
// El motor NO imprime nada: propaga via onError o via throw sincrono
// segun el caso (usage error vs runtime error). Codigos estables en
// `.code` para filtrado / metricas del consumidor.

export abstract class PollingEngineError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Usage error: start() invocado cuando el motor ya esta corriendo.
 * Se lanza sincronicamente desde start(), no via onError.
 */
export class AlreadyRunningError extends PollingEngineError {
  readonly code = "ALREADY_RUNNING";

  constructor() {
    super("El polling engine ya esta corriendo (start() llamado dos veces)");
  }
}

/**
 * Fallo del Cursor Store al leer o escribir. `.cause` conserva el
 * error original (p. ej. CorruptCursorError, PermissionError, etc.).
 */
export class CursorAccessError extends PollingEngineError {
  readonly code = "CURSOR_ACCESS";

  constructor(
    public readonly operation: "load" | "save",
    options?: ErrorOptions,
  ) {
    super(
      `Fallo accediendo al cursor (${operation === "load" ? "lectura" : "escritura"})`,
      options,
    );
  }
}

/**
 * Fallo del cliente HTTP consultando el Event Store. `.cause` es
 * tipicamente un EventStoreError (Timeout, Network, Http, InvalidJson,
 * UnexpectedResponse).
 */
export class EventFetchError extends PollingEngineError {
  readonly code = "EVENT_FETCH";

  constructor(options?: ErrorOptions) {
    super("Fallo consultando el Event Store", options);
  }
}

/**
 * El callback del consumidor lanzo. `.cause` es la excepcion original.
 * Consecuencia: el cursor NO se actualiza, los eventos vuelven en la
 * proxima iteracion.
 */
export class ConsumerError extends PollingEngineError {
  readonly code = "CONSUMER";

  constructor(options?: ErrorOptions) {
    super("El callback del consumidor lanzo una excepcion", options);
  }
}

/**
 * El loop del motor se detuvo por una razon distinta a stop()
 * explicito. Defensivo: la implementacion actual atrapa todo lo que
 * pollOnce() lanza, pero mantenemos la clase como parte de la
 * taxonomia por si futuros cambios introducen caminos no cubiertos.
 */
export class UnexpectedStopError extends PollingEngineError {
  readonly code = "UNEXPECTED_STOP";

  constructor(options?: ErrorOptions) {
    super("El polling engine se detuvo inesperadamente", options);
  }
}
