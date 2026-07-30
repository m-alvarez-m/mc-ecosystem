// Taxonomia de errores de la resolucion de identidad.
//
// PlayerNameResolver NUNCA imprime. Los errores viajan al caller
// (typicamente el handler que pidio el nombre) con `.code` estable
// para clasificar en logs / metricas / branches. La jerarquia comparte
// clase base para atrapar todo con un solo `instanceof` cuando conviene
// (p. ej. en un `onError` del polling engine).
//
// Consistente en forma con EventStoreClient/errors.ts.

export abstract class PlayerNameResolverError extends Error {
  /** Codigo estable para logueo/metricas del consumidor. */
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** La api respondio 404: no hay identidad registrada para ese uuid. */
export class PlayerNotFoundError extends PlayerNameResolverError {
  readonly code = "PLAYER_NOT_FOUND";

  constructor(public readonly uuid: string) {
    super(`No hay identidad registrada para player_uuid=${uuid}`);
  }
}

/** Timeout: la api no respondio en el tiempo configurado. */
export class PlayerLookupTimeoutError extends PlayerNameResolverError {
  readonly code = "TIMEOUT";

  constructor(
    public readonly uuid: string,
    public readonly timeoutMs: number,
    options?: ErrorOptions,
  ) {
    super(
      `Lookup de player_uuid=${uuid} excedio ${timeoutMs}ms sin respuesta`,
      options,
    );
  }
}

/** Fallo de red antes de recibir respuesta (DNS, conexion, TLS, etc.). */
export class PlayerLookupNetworkError extends PlayerNameResolverError {
  readonly code = "NETWORK";

  constructor(
    public readonly uuid: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(
      `Fallo de red resolviendo player_uuid=${uuid}: ${message}`,
      options,
    );
  }
}

/** Api respondio con status no exitoso distinto de 404. */
export class PlayerLookupHttpError extends PlayerNameResolverError {
  readonly code = "HTTP";

  constructor(
    public readonly uuid: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    const preview = body.length > 200 ? `${body.slice(0, 200)}...` : body;
    super(
      `Api respondio HTTP ${status} para player_uuid=${uuid}: ${preview}`,
    );
  }
}

/** La respuesta no era JSON parseable. */
export class PlayerLookupInvalidJsonError extends PlayerNameResolverError {
  readonly code = "INVALID_JSON";

  constructor(
    public readonly uuid: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(
      `Api devolvio JSON invalido para player_uuid=${uuid}: ${message}`,
      options,
    );
  }
}

/** JSON parseable pero no cumple el schema esperado (falta `name` string). */
export class PlayerLookupUnexpectedResponseError extends PlayerNameResolverError {
  readonly code = "UNEXPECTED_RESPONSE";

  constructor(public readonly uuid: string, message: string) {
    super(
      `Respuesta de /players/${uuid} no cumple el schema esperado: ${message}`,
    );
  }
}
