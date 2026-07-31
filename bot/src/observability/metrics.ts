// Tipos publicos del modulo de observabilidad.
//
// `RuntimeSnapshot` es la vista inmutable del estado del pipeline en
// un instante dado — lo que el health server (T7) va a serializar
// como JSON sin transformar. Aqui viven SOLO tipos; la mutabilidad y
// el `record*` viven en `runtime-state.ts`.

/** Identifica en que capa ocurrio un error registrado. */
export type ErrorScope = "polling" | "handler";

export interface LastErrorRecord {
  /** ISO 8601 UTC del momento en que se registro el error. */
  timestamp: string;
  scope: ErrorScope;
  /** Codigo estable del error (`err.code` si existe, si no `err.name`). */
  code: string;
  message: string;
  /** Presente si el error se puede atribuir a un evento concreto. */
  eventUuid?: string;
  eventType?: string;
}

export interface LastEventProcessedRecord {
  /** ISO 8601 UTC del momento en que se registro el procesamiento. */
  timestamp: string;
  /** `id` (BIGINT como string) del evento. */
  id: string;
  type: string;
  eventUuid: string;
}

/**
 * Snapshot inmutable del estado del pipeline en un instante concreto.
 * Todos los timestamps son ISO 8601 UTC. Contadores son enteros no
 * negativos que sólo crecen dentro de la vida del proceso (in-memory,
 * no persistidos: reiniciar = todo a cero).
 */
export interface RuntimeSnapshot {
  /** Numero total de eventos dispatched a un handler con exito. */
  processedEventsTotal: number;
  /**
   * Numero de eventos procesados por tipo. Sólo aparecen tipos que
   * efectivamente pasaron por un handler al menos una vez (los tipos
   * sin actividad no aparecen — no hay ceros pre-declarados).
   */
  processedByType: Readonly<Record<string, number>>;
  /**
   * Numero total de eventos recibidos cuyo `type` no tiene handler
   * registrado. Se saltan sin error.
   */
  unknownEventsTotal: number;
  /**
   * Numero total de iteraciones de polling que abortaron con error
   * (network, timeout, cursor, wrapping de handler fallido, etc.).
   */
  pollingErrorsTotal: number;
  /**
   * Numero total de invocaciones a handler que lanzaron. Separado del
   * anterior porque miden ejes distintos: un fallo de handler cuenta
   * una vez aqui y una vez en `pollingErrorsTotal` (via wrapping en
   * ConsumerError). No es doble contabilidad — son dos perspectivas.
   */
  handlerErrorsTotal: number;

  /** ISO del momento en que arranco el ultimo poll (start hook). */
  lastPollAt: string | null;
  /** ISO del momento en que el ultimo poll termino con exito. */
  lastSuccessfulPollAt: string | null;

  /** Detalle del ultimo error registrado (polling o handler). */
  lastError: LastErrorRecord | null;
  /** Detalle del ultimo evento procesado con exito. */
  lastEventProcessed: LastEventProcessedRecord | null;
}
