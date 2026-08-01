import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { narrateCraft } from "../minecraft";

// CraftHandler (T13 v1.1 — Craft Chronicle).
//
// Consume `item.craft` (emitido por EconomyListener.onCraft tras
// un CraftItemEvent en workbench) y publica una crónica de progreso
// SÓLO cuando el item resultado es uno de los hitos curados en el
// catálogo. Todo lo demás se ignora silenciosamente — no es un
// error; simplemente no todo craft merece un embed en Discord.
//
// Handler PURO: sin estado, sin dedup, sin memoria.
//
// Narración IMPERSONAL: los hitos del catálogo son avances del
// SERVIDOR, no del jugador — por eso el handler no resuelve el
// nombre del crafteador. Ahorro de una llamada HTTP al resolver
// en cada craft (potencialmente frecuente aunque la mayoría no
// publique).
//
// Payload consumido (verificado en plugin/.../EconomyListener.java):
//   - player_uuid (raíz): del crafteador. NO se usa (narrativa
//     impersonal); no lo validamos para evitar rechazar eventos
//     válidos por un campo que ignoramos.
//   - data.item (obligatorio, según plugin): namespaced key del
//     ItemStack resultado. Si por corrupción falta o no es string,
//     el catálogo devuelve null y el handler termina en silencio.
//   - data.count: no usado.

const EVENT_TYPE = "item.craft";

const TITLE = "Hito de crafteo";

export class CraftHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const item = extractOptionalString(event, "item");
    const body = narrateCraft({ item });
    if (body === null) {
      // Item ausente o fuera del catálogo — comportamiento por spec:
      // no publicar, no lanzar. La inmensa mayoría de crafts
      // (palos, antorchas, hornos...) cae por aquí.
      return;
    }
    await context.publisher.publish({
      title: TITLE,
      body,
      kind: "craft_milestone",
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
