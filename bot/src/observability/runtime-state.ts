import type { EventRecord } from "../eventstore";
import type {
  ErrorScope,
  LastErrorRecord,
  LastEventProcessedRecord,
  RuntimeSnapshot,
} from "./metrics";

// Estado runtime del bot Pulso — in-memory, por-instancia, sin
// persistencia.
//
// Recoge eventos de instrumentacion via los `record*` methods, que se
// cablean desde compose.ts como callbacks del PollingEngine y del
// EventDispatcher. Nadie mas los invoca; los handlers, el resolver, el
// publisher, etc. NO conocen esta clase.
//
// Diseno para T7 (health server): el consumidor unicamente llama
// `snapshot()` y serializa el resultado. Cero logica adicional en la
// capa de exposicion.
//
// Sin singleton global: la instancia se crea en compose.ts, se
// inyecta como callback donde se necesita y se expone en AppServices
// para lecturas puntuales (tests, health server futuro).

export class RuntimeState {
  private processedTotal = 0;
  private readonly processedByType = new Map<string, number>();
  private unknownEventsTotal = 0;
  private pollingErrorsTotal = 0;
  private handlerErrorsTotal = 0;

  private lastPollAt: string | null = null;
  private lastPollSucceededAt: string | null = null;

  private lastError: LastErrorRecord | null = null;
  private lastEventProcessed: LastEventProcessedRecord | null = null;

  /** Se invoca al inicio de cada iteracion del polling. */
  recordPollStarted(): void {
    this.lastPollAt = nowIso();
  }

  /** Se invoca cuando la iteracion termino sin error. */
  recordPollCompleted(): void {
    this.lastPollSucceededAt = nowIso();
  }

  /**
   * Se invoca cuando la iteracion aborto con un error. Incrementa
   * `pollingErrorsTotal` y registra el error como ultimo error.
   * El error viene ya envuelto por el PollingEngine (subclases de
   * `PollingEngineError` con `.code` estable).
   */
  recordPollFailed(err: unknown): void {
    this.pollingErrorsTotal++;
    this.lastError = buildErrorRecord(err, "polling");
  }

  /** Se invoca por cada evento entregado con exito a un handler. */
  recordEventProcessed(event: EventRecord): void {
    this.processedTotal++;
    this.processedByType.set(
      event.type,
      (this.processedByType.get(event.type) ?? 0) + 1,
    );
    this.lastEventProcessed = {
      at: nowIso(),
      id: event.id,
      type: event.type,
      eventUuid: event.event_uuid,
    };
  }

  /** Se invoca cuando llega un evento cuyo tipo no tiene handler. */
  recordUnknownEvent(_event: EventRecord): void {
    this.unknownEventsTotal++;
  }

  /**
   * Se invoca cuando un handler lanzo. `err` es la excepcion cruda
   * del handler (ANTES de que el dispatcher la envuelva en
   * `HandlerExecutionError`). Incrementa `handlerErrorsTotal` y
   * registra como ultimo error atribuido al evento concreto.
   */
  recordHandlerFailure(event: EventRecord, err: unknown): void {
    this.handlerErrorsTotal++;
    this.lastError = buildErrorRecord(err, "handler", event);
  }

  /**
   * Snapshot inmutable del estado actual. `Object.fromEntries` del Map
   * garantiza copia — mutar el snapshot devuelto no afecta al estado
   * interno.
   */
  snapshot(): RuntimeSnapshot {
    return {
      processedTotal: this.processedTotal,
      processedByType: Object.freeze({ ...Object.fromEntries(this.processedByType) }),
      unknownEventsTotal: this.unknownEventsTotal,
      pollingErrorsTotal: this.pollingErrorsTotal,
      handlerErrorsTotal: this.handlerErrorsTotal,
      lastPollAt: this.lastPollAt,
      lastPollSucceededAt: this.lastPollSucceededAt,
      lastError: this.lastError === null ? null : { ...this.lastError },
      lastEventProcessed:
        this.lastEventProcessed === null ? null : { ...this.lastEventProcessed },
    };
  }
}

// --------------------------------------------------------------------
// Helpers privados
// --------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Construye el LastErrorRecord canonico. Prefiere `err.code` (los
 * errores tipados del bot exponen .code estable) sobre `err.name`.
 * Si `event` se provee, adjunta `eventUuid` y `eventType`.
 */
function buildErrorRecord(
  err: unknown,
  scope: ErrorScope,
  event?: EventRecord,
): LastErrorRecord {
  const code = extractCode(err);
  const message = err instanceof Error ? err.message : String(err);
  const record: LastErrorRecord = {
    at: nowIso(),
    scope,
    code,
    message,
  };
  if (event !== undefined) {
    record.eventUuid = event.event_uuid;
    record.eventType = event.type;
  }
  return record;
}

function extractCode(err: unknown): string {
  if (err !== null && typeof err === "object") {
    const anyCode = (err as { code?: unknown }).code;
    if (typeof anyCode === "string" && anyCode.length > 0) return anyCode;
    const anyName = (err as { name?: unknown }).name;
    if (typeof anyName === "string" && anyName.length > 0) return anyName;
  }
  return "UNKNOWN";
}
