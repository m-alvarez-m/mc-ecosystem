// Logger estructurado del D4 · emite una línea JSON por intento
// fallido con los 14 campos obligatorios.
//
// El logger acepta un `pino` (o cualquier objeto con `.warn/.error`)
// para reusar la infraestructura existente del bot. La línea se emite
// con nivel WARN si will_retry=true, ERROR si el intento fue final
// (max_retries alcanzado o circuit_open o parse_error).

import type { CircuitState, ErrorType } from "./types.js";

export interface StructuredErrorFields {
  correlation_id: string;
  event_id: string;
  event_type: string;
  attempt: number;
  max_attempts: number;
  error_type: ErrorType;
  error_message: string;
  duration_ms: number;
  circuit_state: CircuitState;
  will_retry: boolean;
  retry_in_ms?: number;
  ts_first_attempt: string; // ISO-8601
  ts_this_attempt: string; // ISO-8601
  bot_version: string;
}

export interface Sink {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export class StructuredErrorLogger {
  private readonly sink: Sink;
  private readonly botVersion: string;
  // Memoria in-process del ts_first_attempt por correlation_id (D4).
  // Se limpia cuando el evento se resuelve (éxito o DLQ final).
  private readonly firstSeen = new Map<string, string>();

  constructor(sink: Sink, botVersion: string) {
    this.sink = sink;
    this.botVersion = botVersion;
  }

  /** Registra el timestamp del primer intento de este correlation_id. */
  markFirstAttempt(correlationId: string, iso: string): void {
    if (!this.firstSeen.has(correlationId)) {
      this.firstSeen.set(correlationId, iso);
    }
  }

  /** Elimina el rastro tras resolver el evento (éxito o DLQ terminal). */
  clear(correlationId: string): void {
    this.firstSeen.delete(correlationId);
  }

  /**
   * Emite la línea JSON con los 14 campos. `firstAttemptTs` se
   * autopobla desde el mapa in-process si no se pasa; útil para
   * escenarios de replay donde el caller ya tiene el timestamp.
   */
  emit(fields: Omit<StructuredErrorFields, "bot_version" | "ts_first_attempt"> & {
    ts_first_attempt?: string;
  }): void {
    const first =
      fields.ts_first_attempt ??
      this.firstSeen.get(fields.correlation_id) ??
      fields.ts_this_attempt;

    const line: StructuredErrorFields = {
      correlation_id: fields.correlation_id,
      event_id: fields.event_id,
      event_type: fields.event_type,
      attempt: fields.attempt,
      max_attempts: fields.max_attempts,
      error_type: fields.error_type,
      error_message: fields.error_message,
      duration_ms: fields.duration_ms,
      circuit_state: fields.circuit_state,
      will_retry: fields.will_retry,
      ts_first_attempt: first,
      ts_this_attempt: fields.ts_this_attempt,
      bot_version: this.botVersion,
    };
    if (fields.retry_in_ms !== undefined) {
      (line as unknown as Record<string, unknown>).retry_in_ms = fields.retry_in_ms;
    }

    const method = fields.will_retry ? "warn" : "error";
    this.sink[method](line, "resilience.attempt_failed");
  }
}
