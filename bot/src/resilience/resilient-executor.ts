// Ensamblador de retry + circuit breaker + DLQ + logging estructurado
// para envolver la ejecución de un handler concreto (ADR-013).
//
// Este módulo es el corazón operativo del ADR-013: convierte un
// `handler.handle(ctx, event)` que puede lanzar en un proceso que
//   1. respeta el circuit breaker (si open → DLQ inmediato),
//   2. reintenta con backoff+jitter hasta N veces,
//   3. escribe a DLQ tras agotar reintentos,
//   4. emite las 14-campos de log por cada intento fallido,
//   5. reporta success/fail al breaker,
//   6. devuelve NORMALMENTE cuando el evento está "resuelto"
//      (éxito o entrada a DLQ) — permite que el polling engine
//      avance el cursor.
//
// El único caso en que este executor propaga (throw) es cuando la
// escritura a DLQ misma falla (ver DlqWriteFailedError). En ese caso
// el batch se re-procesa entero en la próxima iteración del polling,
// respetando el at-least-once del engine.

import type { EventRecord } from "../eventstore/index.js";
import type { CircuitBreaker } from "./circuit-breaker.js";
import type { DlqClient, DlqInsertRequest } from "./dlq-client.js";
import { retryWithBackoff, type RetryOptions } from "./retry.js";
import { classifyError, summarizeErrorMessage } from "./error-classifier.js";
import type { StructuredErrorLogger } from "./structured-error-logger.js";
import type { DlqReason, ErrorType } from "./types.js";

export class DlqWriteFailedError extends Error {
  readonly code = "DLQ_WRITE_FAILED";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DlqWriteFailedError";
  }
}

export interface ResilientExecutorOptions {
  breaker: CircuitBreaker;
  dlq: Pick<DlqClient, "insert">;
  errorLogger: StructuredErrorLogger;
  retryOptions?: RetryOptions;
  /** Reloj inyectable — Date.now por default. */
  now?: () => number;
}

export interface ExecuteResult {
  outcome: "success" | "dlq";
  reason?: DlqReason;
  attempts: number;
}

export class ResilientExecutor {
  private readonly breaker: CircuitBreaker;
  private readonly dlq: Pick<DlqClient, "insert">;
  private readonly errorLogger: StructuredErrorLogger;
  private readonly retryOptions: RetryOptions;
  private readonly now: () => number;
  private readonly maxAttempts: number;

  constructor(opts: ResilientExecutorOptions) {
    this.breaker = opts.breaker;
    this.dlq = opts.dlq;
    this.errorLogger = opts.errorLogger;
    this.retryOptions = opts.retryOptions ?? {};
    this.now = opts.now ?? Date.now;
    this.maxAttempts = this.retryOptions.maxAttempts ?? 5;
  }

  /**
   * Ejecuta `fn` (típicamente `() => handler.handle(ctx, event)`)
   * bajo el pipeline retry+breaker+DLQ. Devuelve el outcome; sólo
   * lanza si la escritura a DLQ misma falla.
   */
  async execute(
    event: EventRecord,
    fn: () => Promise<void>,
  ): Promise<ExecuteResult> {
    const correlationId = event.event_uuid;
    const nowIso = () => new Date(this.now()).toISOString();
    const firstIso = nowIso();
    this.errorLogger.markFirstAttempt(correlationId, firstIso);

    // Circuit abierto → DLQ inmediato con reason='circuit_open'.
    if (!this.breaker.shouldAttempt()) {
      const errorMessage = "circuit breaker abierto — evento descartado a DLQ";
      this.errorLogger.emit({
        correlation_id: correlationId,
        event_id: event.id,
        event_type: event.type,
        attempt: 1,
        max_attempts: this.maxAttempts,
        error_type: "circuit_open",
        error_message: errorMessage,
        duration_ms: 0,
        circuit_state: this.breaker.state(),
        will_retry: false,
        ts_this_attempt: firstIso,
      });
      await this.writeDlq({
        event,
        reason: "circuit_open",
        errorType: "circuit_open",
        errorMessage,
        attempts: 1,
        firstFailedAt: firstIso,
        lastFailedAt: firstIso,
      });
      this.errorLogger.clear(correlationId);
      return { outcome: "dlq", reason: "circuit_open", attempts: 1 };
    }

    // Retry loop. onRetry emite la línea WARN por intento fallido
    // intermedio; el fallo final se loguea explícitamente después.
    const startTs = this.now();
    let lastAttemptIso = firstIso;
    let lastErr: unknown = undefined;
    const result = await retryWithBackoff(
      async (attempt) => {
        const attemptStart = this.now();
        lastAttemptIso = new Date(attemptStart).toISOString();
        try {
          await fn();
        } catch (err) {
          const attemptEnd = this.now();
          // Log intermedio (will_retry=true si no era el último).
          const willRetry = attempt < this.maxAttempts;
          this.errorLogger.emit({
            correlation_id: correlationId,
            event_id: event.id,
            event_type: event.type,
            attempt,
            max_attempts: this.maxAttempts,
            error_type: classifyError(err),
            error_message: summarizeErrorMessage(err),
            duration_ms: attemptEnd - attemptStart,
            circuit_state: this.breaker.state(),
            will_retry: willRetry,
            ts_this_attempt: lastAttemptIso,
          });
          throw err;
        }
      },
      this.retryOptions,
    );
    const totalDurationMs = this.now() - startTs;

    if (result.ok) {
      this.breaker.record(true);
      this.errorLogger.clear(correlationId);
      return { outcome: "success", attempts: result.attempts };
    }

    // Reintentos agotados. Reportar fallo al breaker, escribir DLQ,
    // limpiar el rastro y devolver dlq/max_retries.
    lastErr = result.err;
    this.breaker.record(false);
    const errorType: ErrorType = classifyError(lastErr);
    const errorMessage = summarizeErrorMessage(lastErr);
    await this.writeDlq({
      event,
      reason: "max_retries",
      errorType,
      errorMessage,
      attempts: result.attempts,
      firstFailedAt: firstIso,
      lastFailedAt: lastAttemptIso,
    });
    this.errorLogger.clear(correlationId);
    // Nota: log final ya se emitió en el último onRetry con
    // will_retry=false (attempt=maxAttempts). No duplicamos.
    void totalDurationMs; // usado en un futuro roll-up si hace falta
    return { outcome: "dlq", reason: "max_retries", attempts: result.attempts };
  }

  private async writeDlq(args: {
    event: EventRecord;
    reason: DlqReason;
    errorType: ErrorType;
    errorMessage: string;
    attempts: number;
    firstFailedAt: string;
    lastFailedAt: string;
  }): Promise<void> {
    const body: DlqInsertRequest = {
      event_id: args.event.id,
      event_uuid: args.event.event_uuid,
      event_type: args.event.type,
      // event_payload = SNAPSHOT COMPLETO (ADR-013 D5 · protege contra
      // purga ADR-012).
      event_payload: args.event as unknown as Record<string, unknown>,
      reason: args.reason,
      error_type: args.errorType,
      error_message: args.errorMessage,
      attempts: args.attempts,
      first_failed_at: args.firstFailedAt,
      last_failed_at: args.lastFailedAt,
    };
    try {
      await this.dlq.insert(body);
    } catch (err) {
      throw new DlqWriteFailedError(
        `DLQ insert falló para event_uuid=${args.event.event_uuid} reason=${args.reason}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  }
}
