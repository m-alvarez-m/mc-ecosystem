// Taxonomia de errores del Cursor Store.
//
// El store NO imprime nada: propaga errores tipados a quien llama,
// que decide politica (logueo, reintento, alerta, reset...). Codigos
// estables en `.code` para metricas y filtrado del consumidor.
//
// "Archivo inexistente" NO figura aqui: no es un error, es un caso
// normal que load() representa devolviendo null y exists() como false.

export abstract class CursorStoreError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * El archivo existe pero su contenido no cumple el schema esperado:
 * archivo vacio, JSON invalido, o JSON parseable pero con estructura
 * incorrecta. El consumidor tipicamente resetea y arranca fresco.
 */
export class CorruptCursorError extends CursorStoreError {
  readonly code = "CORRUPT_CURSOR";

  constructor(message: string, options?: ErrorOptions) {
    super(`Cursor corrupto: ${message}`, options);
  }
}

/** Fallo de IO al leer (distinto de EACCES y ENOENT). */
export class ReadError extends CursorStoreError {
  readonly code = "READ_ERROR";

  constructor(message: string, options?: ErrorOptions) {
    super(`Error de lectura del cursor: ${message}`, options);
  }
}

/** Fallo de IO al escribir (distinto de EACCES). */
export class WriteError extends CursorStoreError {
  readonly code = "WRITE_ERROR";

  constructor(message: string, options?: ErrorOptions) {
    super(`Error de escritura del cursor: ${message}`, options);
  }
}

/** Permisos insuficientes del proceso para leer o escribir. */
export class PermissionError extends CursorStoreError {
  readonly code = "PERMISSION";

  constructor(
    public readonly operation: "read" | "write",
    options?: ErrorOptions,
  ) {
    super(
      `Permisos insuficientes para ${operation === "read" ? "leer" : "escribir"} el cursor`,
      options,
    );
  }
}
