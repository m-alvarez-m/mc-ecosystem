// Taxonomia de errores del cliente HTTP del Event Store.
//
// El cliente NO imprime nada. Los errores viajan a quien llama, con
// suficiente contexto (`code`, campos propios) para decidir la
// politica de reintento, logueo o alerta. La jerarquia comparte una
// clase base para atrapar todo con un solo `instanceof` cuando conviene.

export abstract class EventStoreError extends Error {
  /** Codigo estable para logueo/metricas del consumidor. */
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // `new.target.name` da el nombre de la subclase concreta.
    this.name = new.target.name;
  }
}

/** La request no obtuvo respuesta antes del timeout configurado. */
export class TimeoutError extends EventStoreError {
  readonly code = "TIMEOUT";

  constructor(
    public readonly timeoutMs: number,
    options?: ErrorOptions,
  ) {
    super(`Request al Event Store excedio ${timeoutMs}ms sin respuesta`, options);
  }
}

/** Fallo a nivel de red (DNS, conexion rechazada, socket, TLS, etc.). */
export class NetworkError extends EventStoreError {
  readonly code = "NETWORK";

  constructor(message: string, options?: ErrorOptions) {
    super(`Fallo de red contactando el Event Store: ${message}`, options);
  }
}

/** La api respondio con status no exitoso (4xx / 5xx). */
export class HttpError extends EventStoreError {
  readonly code = "HTTP";

  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    // Truncamos el body para no volar los logs si la api devuelve un
    // stack trace enorme. El body completo queda en la propiedad.
    const preview = body.length > 200 ? `${body.slice(0, 200)}...` : body;
    super(`Event Store respondio HTTP ${status}: ${preview}`);
  }
}

/** La respuesta no era JSON parseable. */
export class InvalidJsonError extends EventStoreError {
  readonly code = "INVALID_JSON";

  constructor(message: string, options?: ErrorOptions) {
    super(`Event Store devolvio JSON invalido: ${message}`, options);
  }
}

/** El JSON parseo pero no cumple el schema esperado. */
export class UnexpectedResponseError extends EventStoreError {
  readonly code = "UNEXPECTED_RESPONSE";

  constructor(message: string) {
    super(`Respuesta del Event Store no cumple el schema esperado: ${message}`);
  }
}
