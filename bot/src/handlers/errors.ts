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
 * Lanzada cuando un evento player.* llega sin `player_uuid` a nivel
 * raiz (el catalogo lo declara requerido pero el schema del api lo
 * permite nullable). Compartido entre PlayerJoined, PlayerLeft,
 * PlayerDeath, Advancement y Chat.
 *
 * `eventType` se pasa en construccion para que el mensaje mencione el
 * tipo concreto que fallo — util al depurar sin necesidad de
 * inspeccionar `.cause` o traces.
 */
export class MissingPlayerUuidError extends Error {
  readonly code = "MISSING_PLAYER_UUID";

  constructor(
    public readonly eventType: string,
    public readonly eventUuid: string,
  ) {
    super(
      `${eventType} sin player_uuid a nivel raiz (event_uuid=${eventUuid})`,
    );
    this.name = "MissingPlayerUuidError";
  }
}
