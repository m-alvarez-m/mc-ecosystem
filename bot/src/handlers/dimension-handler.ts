import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { narrateDimension } from "../minecraft";
import { MissingPlayerUuidError } from "./errors";

// DimensionHandler (T9 v1.1 — Dimension Chronicle).
//
// Consume `dimension.enter` (WorldListener emite uno por cada
// `PlayerChangedWorldEvent`), pero publica sólo la PRIMERA vez que
// cada jugador entra a cada dimensión. Cambios repetidos entre
// mundos ya visitados no se publican — Pulso es un cronista, no un
// logger.
//
// Estado por instancia: `Map<player_uuid, Set<dimension>>`. En
// memoria, sin persistencia (spec T9). Se reinicia al arrancar el
// bot: la primera entrada tras un reinicio se re-publica una vez.
//
// Payload consumido:
//   - player_uuid (raíz, obligatorio) → resolver → nombre canónico.
//   - data.dimension (string obligatorio): identificador canónico
//     del plugin — `"overworld"`, `"the_nether"`, `"the_end"`, o el
//     nombre crudo del mundo para entornos custom.
//
// El catálogo tiene fallback para dimensiones desconocidas; el
// handler sólo exige que el campo esté presente y sea string no
// vacío. Si falta se lanza `MissingDimensionError` para que el
// dispatcher lo registre como fallo de handler (evita publicar un
// mensaje incoherente).

const EVENT_TYPE = "dimension.enter";

const TITLE = "Nueva dimensión";

/**
 * Error del handler cuando falta el identificador de dimensión en el
 * payload. Se lanza si `data.dimension` no existe, no es string, o
 * queda vacío tras trim.
 */
export class MissingDimensionError extends Error {
  readonly code = "MISSING_DIMENSION";

  constructor(public readonly eventUuid: string) {
    super(
      `dimension.enter sin campo data.dimension valido (event_uuid=${eventUuid})`,
    );
    this.name = "MissingDimensionError";
  }
}

export class DimensionHandler implements EventHandler {
  // Historial "qué dimensión ha visto cada jugador". El nivel externo
  // es Map (uuid → historial) para que jugadores diferentes no
  // compartan estado; el interno es Set (dimension keys) para lookup
  // y añadido O(1). Ambos crecen con el uso; para un servidor pequeño
  // esto es despreciable, y persistencia queda fuera de T9.
  private readonly seenByPlayer: Map<string, Set<string>> = new Map();

  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    if (event.player_uuid === null) {
      throw new MissingPlayerUuidError(EVENT_TYPE, event.event_uuid);
    }
    const dimension = extractDimension(event);

    if (this.hasSeen(event.player_uuid, dimension)) {
      // Ya publicamos la primera entrada de este jugador a esta
      // dimensión en esta sesión del bot. Nada que hacer.
      return;
    }
    this.markSeen(event.player_uuid, dimension);

    const name = await context.playerNameResolver.resolve(event.player_uuid);
    const body = narrateDimension({ playerName: name, dimension });

    await context.publisher.publish({
      title: TITLE,
      body,
      kind: "dimension_first_enter",
    });
  }

  private hasSeen(playerUuid: string, dimension: string): boolean {
    return this.seenByPlayer.get(playerUuid)?.has(dimension) ?? false;
  }

  private markSeen(playerUuid: string, dimension: string): void {
    let history = this.seenByPlayer.get(playerUuid);
    if (history === undefined) {
      history = new Set();
      this.seenByPlayer.set(playerUuid, history);
    }
    history.add(dimension);
  }
}

function extractDimension(event: EventRecord): string {
  const raw = event.data["dimension"];
  if (typeof raw !== "string") {
    throw new MissingDimensionError(event.event_uuid);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MissingDimensionError(event.event_uuid);
  }
  return trimmed;
}
