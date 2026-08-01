import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { narrateExploration } from "../minecraft";

// ExplorationHandler (T17 v1.1 — Exploration Chronicle).
//
// Consume `chunk.first_load` (emitido por WorldListener.onChunkLoad
// SÓLO para chunks jamás generados antes y con un jugador cerca).
// Publica cuando el chunk cae en la rejilla-muestra del catálogo
// (cada 16 chunks en X y Z, ~1 de cada 256 chunks generados) —
// todo lo demás se ignora silenciosamente. Sin este filtro sería
// spam: una sesión activa genera cientos de chunks nuevos.
//
// Handler PURO: sin estado, sin dedup, sin memoria.
//
// Narración IMPERSONAL: consistente con Craft, Villager, Progress,
// Technology. NO llama al PlayerNameResolver — las crónicas de
// exploración describen al SERVIDOR expandiéndose, no al
// descubridor concreto.
//
// Payload consumido (verificado en plugin/.../WorldListener.java:76-96):
//   - world (raíz): nombre raw del mundo.
//   - data.chunk_x, data.chunk_z: coordenadas del chunk generado.
//   - player_uuid, x, z: emitidos pero NO usados. player_uuid tampoco
//     se valida (mismo criterio que Craft/Villager/Technology: no
//     validar campos que no se usan).

const EVENT_TYPE = "chunk.first_load";

const TITLE = "Exploración del servidor";

export class ExplorationHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const body = narrateExploration({
      world: event.world,
      chunkX: extractOptionalInteger(event, "chunk_x"),
      chunkZ: extractOptionalInteger(event, "chunk_z"),
    });
    if (body === null) {
      // Chunk fuera de la rejilla de muestreo, o payload
      // incompleto/corrupto. Camino mayoritario — ~255 de cada 256
      // chunks pasan por aquí.
      return;
    }
    await context.publisher.publish({
      title: TITLE,
      body,
      kind: "exploration",
    });
  }
}

/**
 * Entero opcional en `event.data[key]`. Devuelve `null` si el
 * campo está ausente, no es number, no es finito o no es entero.
 * NUNCA lanza — chunk_x/chunk_z inválidos hacen que el catálogo
 * retorne null y el handler termine en silencio.
 */
function extractOptionalInteger(event: EventRecord, key: string): number | null {
  const raw = event.data[key];
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw)) return null;
  if (!Number.isInteger(raw)) return null;
  return raw;
}
