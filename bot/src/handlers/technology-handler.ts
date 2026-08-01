import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { narrateTechnology } from "../minecraft";

// TechnologyHandler (T16 v1.1 — Technology Chronicle).
//
// Consume `block.place` (emitido por WorldListener.onBlockPlace tras
// un BlockPlaceEvent). Sólo publica cuando el bloque colocado es
// uno de los tecnológicos curados en el catálogo (hopper, piston,
// sculk_sensor, comparator, ...). Todo lo demás (dirt, cobblestone,
// planks, wool, dust redstone, rieles ordinarios...) se ignora
// silenciosamente. No es un error — la mayoría absoluta de
// block.place es relleno, no tecnología.
//
// Handler PURO: sin estado, sin dedup, sin memoria.
//
// Narración IMPERSONAL: consistente con Craft, Villager Trade y
// Progress Chronicles. NO llama al PlayerNameResolver — las
// crónicas de tecnología describen al SERVIDOR sofisticándose, no
// al jugador colocando.
//
// Payload consumido (verificado en plugin/.../WorldListener.java:30-39):
//   - player_uuid (raíz): quien coloca. NO se usa (narrativa
//     impersonal); no se valida.
//   - data.block: namespaced key del Material colocado
//     ("minecraft:hopper", ...). Si por corrupción falta o no es
//     string, el catálogo devuelve null y el handler termina en
//     silencio.

const EVENT_TYPE = "block.place";

const TITLE = "Tecnología del servidor";

export class TechnologyHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const block = extractOptionalString(event, "block");
    const body = narrateTechnology({ block });
    if (body === null) {
      // Bloque ausente o fuera del catálogo — comportamiento por
      // spec: no publicar, no lanzar. La inmensa mayoría de
      // block.place (dirt, cobblestone, planks, ...) cae aquí.
      return;
    }
    await context.publisher.publish({
      title: TITLE,
      body,
      kind: "technology",
    });
  }
}

/**
 * String opcional en `event.data[key]`. Devuelve `null` si el campo
 * está ausente, no es string o queda vacío tras trim. NUNCA lanza.
 */
function extractOptionalString(event: EventRecord, key: string): string | null {
  const raw = event.data[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
