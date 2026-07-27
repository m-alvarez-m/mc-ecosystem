// Taxonomia de errores del dispatcher.
//
// El dispatcher NO imprime nada: propaga via throw (los tres tipos
// aparecen en distintos puntos del ciclo de vida — registro vs
// dispatch). Codigos estables en `.code` para filtrado / metricas.

export abstract class DispatcherError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * register() invocado dos veces con el mismo `eventType`. Politica:
 * rechazar. Registrar dos handlers para el mismo tipo es casi siempre
 * un bug (dos capas del codigo pisandose); mejor fallar ruidosamente
 * que sobrescribir un handler critico en silencio. Si en el futuro
 * se necesita reemplazar, primero unregister() y luego register().
 */
export class DuplicateHandlerError extends DispatcherError {
  readonly code = "DUPLICATE_HANDLER";

  constructor(public readonly eventType: string) {
    super(`Ya existe un handler registrado para el tipo "${eventType}"`);
  }
}

/**
 * El objeto pasado a register() no cumple la interfaz EventHandler,
 * o su supports() devuelve false sobre el `eventType` bajo el que se
 * intenta registrar.
 */
export class InvalidHandlerError extends DispatcherError {
  readonly code = "INVALID_HANDLER";

  constructor(message: string) {
    super(`Handler invalido: ${message}`);
  }
}

/**
 * handler.handle() lanzo una excepcion. El dispatcher detiene el
 * procesamiento del lote y propaga: el consumidor (tipicamente el
 * polling engine via su callback) NO avanza el cursor. `.cause`
 * conserva la excepcion original.
 */
export class HandlerExecutionError extends DispatcherError {
  readonly code = "HANDLER_EXECUTION";

  constructor(
    public readonly eventType: string,
    public readonly eventId: string,
    options?: ErrorOptions,
  ) {
    super(
      `Handler para "${eventType}" lanzo al procesar el evento id=${eventId}`,
      options,
    );
  }
}
