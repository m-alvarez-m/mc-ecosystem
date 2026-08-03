// Estado del ciclo de vida del servidor (BUG-02C).
//
// Defense-in-depth sobre el freshness contract (BUG-02B). Freshness
// bloquea eventos ANTIGUOS reentregados por el buffer del plugin;
// esta maquina de estados bloquea DUPLICADOS FRESCOS del mismo tipo:
//
//   unknown --server.start--> up
//   up      --server.stop--> down
//   down    --server.start--> up
//   up      --server.start--> WARN (duplicate)  → NO publish
//   down    --server.stop --> WARN (duplicate)  → NO publish
//
// Estado en memoria — sin persistencia (justificacion):
//   1. El bot al reiniciar re-lee su cursor y avanza sin re-emitir
//      eventos ya procesados. Freshness protege contra publicar un
//      stop antiguo tras el reinicio.
//   2. Un server.start real posterior al reinicio se publica
//      correctamente (unknown → up).
//   3. Persistir implicaria nuevo archivo en bot-data, invalidacion,
//      tests adicionales — trade-off malo para el beneficio marginal
//      (evitar como maximo un mensaje ocasional tras reinicio-del-bot).
//   4. La defensa REAL contra reentregas antiguas ya es freshness;
//      el estado solo evita duplicados DENTRO de la sesion actual.

export type ServerLifecycleState = "unknown" | "up" | "down";

export interface LifecycleStateStore {
  get(): ServerLifecycleState;
  set(next: ServerLifecycleState): void;
}

/**
 * Crea un store en memoria. `initial` por defecto es `"unknown"`;
 * los tests pueden inyectar otro valor para reproducir escenarios
 * (start-tras-up, stop-tras-down).
 */
export function createLifecycleStateStore(
  initial: ServerLifecycleState = "unknown",
): LifecycleStateStore {
  let state: ServerLifecycleState = initial;
  return {
    get: () => state,
    set: (next) => {
      state = next;
    },
  };
}
