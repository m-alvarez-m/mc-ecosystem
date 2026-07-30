import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { MissingPlayerUuidError } from "./errors";

// AdvancementHandler: publica cuando un jugador consigue un avance.
//
// Consume:
// - player_uuid (raiz, obligatorio) → resolver → nombre canonico.
// - data.advancement (obligatorio): nombre legible del avance.
//
// Si falta el player_uuid o el data.advancement, se lanza el error
// tipado correspondiente y NO se publica. Mejor error tipado
// propagable al dispatcher que un mensaje corrupto en Discord.

const EVENT_TYPE = "advancement.done";

const TITLE = "Nuevo avance";

/**
 * Error del handler cuando falta el nombre del avance en el payload.
 * Se lanza si `data.advancement` no existe, no es string, o es vacio.
 */
export class MissingAdvancementNameError extends Error {
  readonly code = "MISSING_ADVANCEMENT_NAME";

  constructor(public readonly eventUuid: string) {
    super(
      `advancement.done sin campo data.advancement valido (event_uuid=${eventUuid})`,
    );
    this.name = "MissingAdvancementNameError";
  }
}

export class AdvancementHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    if (event.player_uuid === null) {
      throw new MissingPlayerUuidError(EVENT_TYPE, event.event_uuid);
    }
    const name = await context.playerNameResolver.resolve(event.player_uuid);
    const advancement = extractAdvancementName(event);

    await context.publisher.publish({
      title: TITLE,
      body: `${name} ha conseguido el avance: ${advancement}.`,
    });
  }
}

function extractAdvancementName(event: EventRecord): string {
  const raw = event.data["advancement"];
  if (typeof raw !== "string") {
    throw new MissingAdvancementNameError(event.event_uuid);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MissingAdvancementNameError(event.event_uuid);
  }
  return trimmed;
}
