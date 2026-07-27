// Tipos del modulo Cursor Store.
//
// El cursor es la unica pieza de estado durable del bot Pulso: guarda
// el `id` del ultimo evento procesado para que un restart continue por
// donde iba. Ver ADR-010 (cursor por `id`) para el racional.

/**
 * Payload persistido en disco. `event_id` opaco como string (BIGINT
 * sequential de la tabla `events`, no se opera aritmeticamente sobre el).
 * `updated_at` es un audit trail util para depurar consumers lentos o
 * atascados sin necesidad de logs adicionales.
 */
export interface CursorData {
  event_id: string;
  updated_at: string; // ISO 8601 UTC
}

/**
 * Contrato del store. Contrato minimo, sin operaciones auxiliares.
 * Una implementacion concreta (FileCursorStore, InMemoryCursorStore
 * para tests aguas arriba, etc.) cumple este contrato.
 */
export interface CursorStore {
  /** true si el cursor esta persistido; false si nunca se guardo. */
  exists(): Promise<boolean>;

  /**
   * Devuelve el cursor persistido, o null si nunca se guardo.
   * Lanza errores tipados si el archivo existe pero es ilegible
   * (permisos, IO) o corrupto (JSON invalido, schema roto).
   */
  load(): Promise<CursorData | null>;

  /**
   * Persiste el `eventId` como cursor actual. Sobrescribe el valor
   * anterior. La implementacion debe garantizar atomicidad: un crash
   * a mitad de operacion no puede dejar el archivo truncado ni
   * corrupto.
   */
  save(eventId: string): Promise<void>;

  /**
   * Elimina el cursor persistido. No-op si no existe. Util para
   * arranques limpios o para forzar un replay total (segun politica
   * del consumidor, ver ADR-010 principio 8).
   */
  reset(): Promise<void>;
}
