import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { MissingPlayerNameError } from "./errors";

// PlayerDeathHandler: publica cuando un jugador muere en el servidor.
//
// Consume dos campos del payload:
// - `data.name` (obligatorio): nombre del jugador. Falta -> error.
// - `data.cause` (opcional): descripcion corta de la causa. Cuando
//   existe y es un string no vacio, se anade al mensaje. Cuando falta
//   o no es valida, se emite la version corta ("<nombre> ha muerto.")
//   — no se enriquece con inferencias.
//
// NO interpreta la causa (no distingue PvP, mobs, caida, lava, etc.).
// Ese analisis semantico vive fuera del handler; aqui solo se
// concatena el string tal cual.

const EVENT_TYPE = "player.death";

const TITLE = "Jugador eliminado";

export class PlayerDeathHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const name = extractPlayerName(event);
    const cause = extractOptionalCause(event);

    const body = cause !== null
      ? `${name} ha muerto por ${cause}.`
      : `${name} ha muerto.`;

    await context.publisher.publish({ title: TITLE, body });
  }
}

/**
 * Nombre del jugador. Requerido. Lanza si falta, no es string, o es
 * vacio/whitespace. Misma politica que en PlayerJoined/PlayerLeft.
 */
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

/**
 * Causa opcional. Devuelve el string trimeado si es valido; null en
 * cualquier otro caso. NO lanza: la causa es opcional por diseno,
 * incluso si el productor emitio basura en el campo. La ausencia
 * degrada al mensaje corto, no aborta.
 */
function extractOptionalCause(event: EventRecord): string | null {
  const raw = event.data["cause"];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
