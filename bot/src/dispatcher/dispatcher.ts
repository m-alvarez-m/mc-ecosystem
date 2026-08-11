import type { EventRecord } from "../eventstore";
import type { DispatchContext } from "../context";
import type { EventHandler } from "./handler";
import type {
  OnHandledEventCallback,
  OnHandlerFailedCallback,
  OnUnknownEventCallback,
} from "./types";
import { HandlerRegistry } from "./registry";
import { HandlerExecutionError } from "./errors";
import type { ResilientExecutor, ExecuteResult } from "../resilience";

// EventDispatcher: recibe lotes de eventos del polling engine, los
// enruta secuencialmente al handler correspondiente segun su `type`
// y entrega a cada handler el DispatchContext ademas del evento.
//
// Se detiene si un handler lanza (para que el polling engine no
// avance el cursor), e ignora silenciosamente eventos sin handler
// (con hook opcional para observabilidad futura).
//
// El dispatcher NO conoce Discord ni Minecraft. Solo enruta.
//
// Invariantes:
// - Procesamiento SIEMPRE secuencial. Sin Promise.all. Sin fan-out.
// - Orden preservado: el handler N se ejecuta despues del N-1.
// - Un handler que lanza aborta el lote inmediatamente.
// - Eventos sin handler no cuentan como error: se saltan.
// - El MISMO objeto de contexto se entrega a todos los handlers de
//   todos los lotes que procese esta instancia del dispatcher (una
//   instancia = un contexto de vida del proceso, tipicamente).

export interface EventDispatcherOptions {
  /**
   * Servicios compartidos que se entregan a cada handler. La misma
   * referencia se pasa en cada llamada a handler.handle(); si
   * el contexto tiene estado mutable, se comparte entre handlers.
   */
  context: DispatchContext;

  /**
   * Callback opcional invocado cada vez que llega un evento cuyo
   * `type` no tiene handler registrado. Es un hook de observabilidad,
   * no de logueo: el dispatcher no imprime. Si onUnknown lanza, el
   * dispatcher lo swallow (la observabilidad no debe romper el
   * procesamiento del lote).
   */
  onUnknown?: OnUnknownEventCallback;

  /**
   * Callback opcional invocado por cada evento entregado con exito a
   * un handler. Uso: instrumentacion (contadores, timestamps). Mismo
   * contrato defensivo que onUnknown.
   */
  onHandled?: OnHandledEventCallback;

  /**
   * Callback opcional invocado cuando un handler lanza. Recibe el
   * error CRUDO (antes de envolver en HandlerExecutionError) para que
   * la observabilidad pueda registrar el codigo del error real. Mismo
   * contrato defensivo.
   */
  onFailed?: OnHandlerFailedCallback;

  /**
   * Ejecutor resiliente (ADR-013). Si se provee, cada handler.handle()
   * corre bajo retry + circuit breaker + DLQ + logging estructurado.
   * Un handler que falla no aborta el lote — el evento va a DLQ y el
   * dispatcher continúa con el siguiente. El cursor del polling
   * engine avanza normalmente porque dispatch() no throw.
   *
   * Si NO se provee, el dispatcher mantiene el comportamiento
   * histórico: cualquier fallo del handler propaga como
   * HandlerExecutionError y aborta el lote (útil para tests y
   * arranques sin subsistema de resiliencia configurado).
   */
  resilientExecutor?: ResilientExecutor;

  /**
   * Callback opcional invocado con el resultado del executor
   * resiliente (éxito o DLQ). Uso: instrumentación / observabilidad.
   * Sólo aplica cuando resilientExecutor está presente.
   */
  onExecuted?: (event: EventRecord, result: ExecuteResult) => void;
}

export class EventDispatcher {
  private readonly registry = new HandlerRegistry();
  private readonly context: DispatchContext;
  private readonly onUnknown?: OnUnknownEventCallback;
  private readonly onHandled?: OnHandledEventCallback;
  private readonly onFailed?: OnHandlerFailedCallback;
  private readonly resilientExecutor?: ResilientExecutor;
  private readonly onExecuted?: (event: EventRecord, result: ExecuteResult) => void;

  constructor(options: EventDispatcherOptions) {
    this.context = options.context;
    this.onUnknown = options.onUnknown;
    this.onHandled = options.onHandled;
    this.onFailed = options.onFailed;
    this.resilientExecutor = options.resilientExecutor;
    this.onExecuted = options.onExecuted;
  }

  /** Registra `handler` bajo `eventType`. Ver HandlerRegistry.register. */
  register(eventType: string, handler: EventHandler): void {
    this.registry.register(eventType, handler);
  }

  /** Elimina el handler de `eventType`. Devuelve si habia uno. */
  unregister(eventType: string): boolean {
    return this.registry.unregister(eventType);
  }

  /** Vacia todos los handlers registrados. */
  clear(): void {
    this.registry.clear();
  }

  /**
   * Procesa `events` en orden, uno por uno. Para cada evento:
   * - resuelve su handler por tipo;
   * - si no hay handler: invoca onUnknown (si esta) y continua;
   * - si hay: await handler.handle(context, event); si lanza, aborta
   *   el lote con HandlerExecutionError.
   *
   * NUNCA paraleliza (nada de Promise.all). Nunca reordena. Nunca
   * transforma. La entrega al polling engine es at-least-once: este
   * dispatcher garantiza el orden intra-lote y la para-ante-fallo,
   * pero no la unicidad global — eso es del pipeline.
   */
  async dispatch(events: readonly EventRecord[]): Promise<void> {
    for (const event of events) {
      const handler = this.registry.find(event.type);
      if (handler === undefined) {
        // Evento desconocido: se salta silenciosamente. Hook opcional
        // para observabilidad, sin logs propios.
        if (this.onUnknown !== undefined) {
          try {
            this.onUnknown(event);
          } catch {
            /* swallow: el observador no debe romper el dispatch */
          }
        }
        continue;
      }
      // Path resiliente (ADR-013): retry + breaker + DLQ absorben el
      // fallo; dispatch() no throw y el cursor avanza aunque el
      // evento acabe en DLQ. onFailed sigue notificando el error
      // "de negocio" del último intento (opcional, no rompe el path).
      if (this.resilientExecutor !== undefined) {
        let lastErr: unknown = undefined;
        const result = await this.resilientExecutor.execute(event, async () => {
          try {
            await handler.handle(this.context, event);
          } catch (err) {
            lastErr = err;
            throw err;
          }
        });
        if (result.outcome === "dlq" && this.onFailed !== undefined) {
          try {
            this.onFailed(event, lastErr ?? new Error(`circuit_open o DLQ · reason=${result.reason}`));
          } catch {
            /* swallow */
          }
        }
        if (this.onExecuted !== undefined) {
          try {
            this.onExecuted(event, result);
          } catch {
            /* swallow */
          }
        }
        if (result.outcome === "success" && this.onHandled !== undefined) {
          try {
            this.onHandled(event);
          } catch {
            /* swallow */
          }
        }
        continue;
      }

      // Path histórico: sin resiliencia, cualquier fallo del handler
      // aborta el lote y el polling engine no avanza el cursor.
      try {
        await handler.handle(this.context, event);
      } catch (err) {
        if (this.onFailed !== undefined) {
          try {
            this.onFailed(event, err);
          } catch {
            /* swallow: la observabilidad no debe romper el dispatch */
          }
        }
        throw new HandlerExecutionError(event.type, event.id, errCause(err));
      }
      if (this.onHandled !== undefined) {
        try {
          this.onHandled(event);
        } catch {
          /* swallow: la observabilidad no debe romper el dispatch */
        }
      }
    }
  }
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

function errCause(err: unknown): ErrorOptions | undefined {
  return err instanceof Error ? { cause: err } : undefined;
}
