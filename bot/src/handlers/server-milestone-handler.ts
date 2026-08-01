import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { narrateServerMilestone } from "../minecraft";

// ServerMilestoneHandler (T10 v1.1 — Server Chronicle).
//
// Consume `milestone.first`: eventos que el plugin emite EXACTAMENTE
// UNA VEZ EN LA HISTORIA del servidor por cada `what` distinto,
// gracias al `MilestoneTracker` (INSERT atómico en la tabla
// milestones de SQLite del plugin, ver
// `plugin/.../MilestoneTracker.java`).
//
// A diferencia de DimensionHandler (T9), aquí NO deduplicamos: el
// plugin ya garantiza unicidad histórica y sobrevive reinicios del
// bot. El handler es puro (sin estado).
//
// Payload consumido:
//   - player_uuid (raíz, OPCIONAL): puede ser null cuando el hito
//     no tiene un jugador concreto (p. ej. Wither muerto sin killer
//     en `ProgressListener.onBossDeath` — el killer es opcional).
//   - data.what (string obligatorio): identificador del hito
//     (`"diamond"`, `"nether"`, `"end"`, `"elytra"`, `"wither"`,
//     `"ender_dragon"`, o futuros valores que el plugin añada).
//
// Fallback narrativo: si `what` no está en el catálogo, se publica
// un mensaje genérico que interpola el nombre del jugador (o
// "servidor" si no hay jugador). Nunca se pierde información.

const EVENT_TYPE = "milestone.first";

const TITLE = "Hito del servidor";

/**
 * Error del handler cuando falta el identificador del hito en el
 * payload. Se lanza si `data.what` no existe, no es string, o queda
 * vacío tras trim.
 */
export class MissingMilestoneWhatError extends Error {
  readonly code = "MISSING_MILESTONE_WHAT";

  constructor(public readonly eventUuid: string) {
    super(
      `milestone.first sin campo data.what valido (event_uuid=${eventUuid})`,
    );
    this.name = "MissingMilestoneWhatError";
  }
}

export class ServerMilestoneHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const what = extractWhat(event);

    // Resolvemos el nombre SÓLO cuando hay player_uuid. Para los 6
    // hitos actualmente en catálogo, el catálogo ignora el nombre
    // (narrativa impersonal) — el resolve sale gratis en llamada
    // única e histórica. El fallback SÍ lo usa cuando está.
    const playerName =
      event.player_uuid !== null
        ? await context.playerNameResolver.resolve(event.player_uuid)
        : null;

    const body = narrateServerMilestone({ what, playerName });

    await context.publisher.publish({
      title: TITLE,
      body,
      kind: "server_milestone",
    });
  }
}

function extractWhat(event: EventRecord): string {
  const raw = event.data["what"];
  if (typeof raw !== "string") {
    throw new MissingMilestoneWhatError(event.event_uuid);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MissingMilestoneWhatError(event.event_uuid);
  }
  return trimmed;
}
