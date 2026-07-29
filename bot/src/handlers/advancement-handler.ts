import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { MissingPlayerNameError } from "./errors";

// AdvancementHandler: publica cuando un jugador consigue un avance.
//
// Dos campos REQUERIDOS del payload:
// - `data.name`: nombre del jugador.
// - `data.advancement`: nombre legible del avance.
//
// Si falta cualquiera de los dos, se lanza el error tipado que
// corresponda y NO se publica nada. Preferimos error tipado propagable
// al dispatcher antes que un mensaje corrupto en Discord ("undefined
// ha conseguido el avance: undefined.").

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
    const name = extractPlayerName(event);
    const advancement = extractAdvancementName(event);

    await context.publisher.publish({
      title: TITLE,
      body: `${name} ha conseguido el avance: ${advancement}.`,
    });
  }
}

function extractPlayerName(event: EventRecord): string {
  const raw = event.data["name"];
  if (typeof raw !== "string") {
    throw new MissingPlayerNameError(EVENT_TYPE, event.event_uuid);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MissingPlayerNameError(EVENT_TYPE, event.event_uuid);
  }
  return trimmed;
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
