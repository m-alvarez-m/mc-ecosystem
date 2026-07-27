import type { CursorStore } from "../cursor";
import type { EventFetcher, PollingConsumer } from "./types";
import {
  AlreadyRunningError,
  ConsumerError,
  CursorAccessError,
  EventFetchError,
  PollingEngineError,
  UnexpectedStopError,
} from "./errors";

// Motor de polling secuencial del Event Store.
//
// Coordina Cursor Store + Event Store Client + callback del consumidor
// segun el flujo obligatorio:
//
//   1. Leer cursor.
//   2. Consultar Event Store con after_id = cursor.event_id.
//   3. Si no hay eventos: fin del ciclo.
//   4. Si hay: invocar callback. Esperar a que termine.
//   5. Solo si el callback termino OK: persistir last_id como cursor.
//   6. Esperar POLL_INTERVAL_MS y repetir.
//
// Invariantes:
// - Nunca dos iteraciones concurrentes (loop while-await secuencial).
// - Nunca dos consultas HTTP simultaneas (mismo motivo).
// - Nunca dos escrituras del cursor simultaneas (idem).
// - El cursor jamas se actualiza antes de que el callback termine OK.
// - Si el callback lanza, los mismos eventos vuelven a la proxima
//   iteracion. Consumidor tiene que ser idempotente (ADR-010 principio 4).
//
// Diseno:
// - Loop while (running) { await pollOnce; await sleep; }. Sin
//   setInterval, sin timers concurrentes.
// - Sleep cancelable para responder rapido a stop() sin esperar el
//   intervalo completo.
// - Errores emitidos via callback onError (no logs, no console).

export interface PollingEngineOptions {
  eventStoreClient: EventFetcher;
  cursorStore: CursorStore;
  consumer: PollingConsumer;
  pollIntervalMs: number;
  /**
   * Callback invocado con cualquier error de una iteracion. Si no se
   * provee, los errores se descartan silenciosamente (consumidor asume
   * la responsabilidad de definir su politica de observabilidad).
   */
  onError?: (err: PollingEngineError) => void;
}

export class PollingEngine {
  private readonly eventStoreClient: EventFetcher;
  private readonly cursorStore: CursorStore;
  private readonly consumer: PollingConsumer;
  private readonly pollIntervalMs: number;
  private readonly onError?: (err: PollingEngineError) => void;

  private running = false;
  private loopPromise: Promise<void> | null = null;
  private cancelSleep: (() => void) | null = null;

  constructor(options: PollingEngineOptions) {
    this.eventStoreClient = options.eventStoreClient;
    this.cursorStore = options.cursorStore;
    this.consumer = options.consumer;
    this.pollIntervalMs = options.pollIntervalMs;
    this.onError = options.onError;
  }

  isRunning(): boolean {
    return this.running;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async start(): Promise<void> {
    if (this.running) {
      throw new AlreadyRunningError();
    }
    this.running = true;
    // El loop corre en background: no lo esperamos aqui (bloquearia
    // start() para siempre). Guardamos la promise para que stop() la
    // pueda esperar y completar el shutdown ordenado.
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    if (!this.running) {
      // Idempotente: stop() sin start() previo no lanza. Simplifica
      // shutdown handlers que no saben en que estado quedo el motor.
      return;
    }
    this.running = false;
    // Corta el sleep en curso si lo hay, para que el loop revalue
    // running y salga sin esperar el intervalo completo.
    if (this.cancelSleep !== null) {
      this.cancelSleep();
    }
    if (this.loopPromise !== null) {
      await this.loopPromise;
      this.loopPromise = null;
    }
  }

  // ----------------------------------------------------------------
  // Internals
  // ----------------------------------------------------------------

  private async loop(): Promise<void> {
    try {
      while (this.running) {
        try {
          await this.pollOnce();
        } catch (err) {
          // pollOnce siempre lanza PollingEngineError ya envuelto.
          if (err instanceof PollingEngineError) {
            this.emit(err);
          } else {
            // Defensivo: cualquier otra cosa que se cuele.
            this.emit(new UnexpectedStopError(errCause(err)));
          }
        }
        if (!this.running) break;
        await this.sleep(this.pollIntervalMs);
      }
    } catch (err) {
      // Nunca deberia caer aqui (pollOnce y sleep no throw), pero si
      // pasa: taxonomia lo cubre y el consumidor se entera.
      this.running = false;
      this.emit(new UnexpectedStopError(errCause(err)));
    }
  }

  private async pollOnce(): Promise<void> {
    // Paso 1: leer cursor.
    let cursor: Awaited<ReturnType<CursorStore["load"]>>;
    try {
      cursor = await this.cursorStore.load();
    } catch (err) {
      throw new CursorAccessError("load", errCause(err));
    }

    // Paso 2: consultar Event Store con el cursor.
    let response: Awaited<ReturnType<EventFetcher["getEvents"]>>;
    try {
      response = await this.eventStoreClient.getEvents(
        cursor === null ? {} : { after_id: cursor.event_id },
      );
    } catch (err) {
      throw new EventFetchError(errCause(err));
    }

    // Paso 3: sin eventos = nada mas que hacer. Cursor sin cambios.
    if (response.events.length === 0) {
      return;
    }

    // Paso 4-5: entregar al consumidor y esperar. Si lanza, salimos
    // SIN actualizar el cursor: los mismos eventos volveran a la
    // proxima iteracion (at-least-once).
    try {
      await this.consumer(response.events);
    } catch (err) {
      throw new ConsumerError(errCause(err));
    }

    // Paso 6: persistir last_id. Si la respuesta trae last_id lo
    // preferimos (autoridad de la api); en su defecto, el id del
    // ultimo evento del batch.
    const lastEvent = response.events[response.events.length - 1]!;
    const lastId = response.last_id ?? lastEvent.id;
    try {
      await this.cursorStore.save(lastId);
    } catch (err) {
      // Consumer YA corrio con exito. Save fallo. Cursor NO
      // avanzado. Proxima iteracion re-entrega los mismos eventos:
      // consumer debe ser idempotente (ADR-010 principio 4).
      throw new CursorAccessError("save", errCause(err));
    }
  }

  /**
   * Sleep cancelable. Si stop() se llama durante la espera, resuelve
   * inmediatamente en lugar de esperar los ms restantes.
   */
  private async sleep(ms: number): Promise<void> {
    if (!this.running) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.cancelSleep = null;
        resolve();
      }, ms);
      this.cancelSleep = (): void => {
        clearTimeout(timer);
        this.cancelSleep = null;
        resolve();
      };
    });
  }

  private emit(err: PollingEngineError): void {
    if (this.onError !== undefined) {
      // No await: si onError es async y falla, no queremos que arrastre
      // al loop. La politica de errores del observador es su problema.
      try {
        this.onError(err);
      } catch {
        /* swallow: el observador no debe romper el loop */
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
