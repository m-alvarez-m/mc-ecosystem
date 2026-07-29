// Errores compartidos por los handlers.
//
// Solo viven aqui los errores REUTILIZADOS por varios handlers. Los
// errores especificos de un handler concreto siguen en su archivo
// (por ejemplo, MissingChatMessageError en chat-handler.ts o
// InvalidTpsError en tps-handler.ts).
//
// Este modulo no importa nada de otros modulos de handlers ni de
// dispatcher/eventstore/publisher. Cero dependencias circulares por
// construccion.

/**
 * Lanzada cuando el payload de un evento player.* no contiene un
 * campo `data.name` valido (falta, no es string, o esta vacio/
 * whitespace). Compartido entre PlayerJoined, PlayerLeft, PlayerDeath,
 * Advancement y Chat.
 *
 * `eventType` se pasa en construccion para que el mensaje mencione el
 * tipo concreto que fallo — util al depurar sin necesidad de
 * inspeccionar `.cause` o traces.
 */
export class MissingPlayerNameError extends Error {
  readonly code = "MISSING_PLAYER_NAME";

  constructor(
    public readonly eventType: string,
    public readonly eventUuid: string,
  ) {
    super(`${eventType} sin campo data.name valido (event_uuid=${eventUuid})`);
    this.name = "MissingPlayerNameError";
  }
}
