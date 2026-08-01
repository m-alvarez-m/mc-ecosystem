import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { narrateVillagerTrade } from "../minecraft";

// VillagerTradeHandler (T14 v1.1 — Villager Chronicle).
//
// Consume `villager.trade` (emitido por EconomyListener.onTrade tras
// un PlayerTradeEvent) y publica una crónica del crecimiento
// económico del servidor SÓLO cuando el intercambio pertenece al
// catálogo (dos niveles: profession+output específico, o profession
// como fallback). Todo lo demás — trigo por esmeralda, palos por
// esmeralda, wandering trader, etc. — se ignora silenciosamente.
//
// Handler PURO: sin estado, sin dedup, sin memoria.
//
// Narración IMPERSONAL: los hitos económicos son del SERVIDOR — no
// del jugador. El handler NO llama al PlayerNameResolver: ahorra una
// llamada HTTP por cada trade y mantiene las crónicas atemporales
// (materia prima para las fases futuras del roadmap: Insight,
// Memoria, Legacy, Genesis).
//
// Payload consumido (verificado en plugin/.../EconomyListener.java:30-50):
//   - player_uuid (raíz): buyer's UUID. NO se usa (narrativa
//     impersonal); no se valida para no rechazar eventos válidos
//     por un campo que ignoramos.
//   - data.profession: short key de la profesión. Requerido para
//     clasificar; si falta, el catálogo devuelve null y el handler
//     termina en silencio.
//   - data.output: namespaced key del ItemStack resultado. Opcional
//     en el handler; su ausencia degrada al catálogo a un match
//     de nivel 2 (profession-only).
//   - data.input, data.count: no usados.

const EVENT_TYPE = "villager.trade";

const TITLE = "Comercio del servidor";

export class VillagerTradeHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const profession = extractOptionalString(event, "profession");
    const output = extractOptionalString(event, "output");

    const body = narrateVillagerTrade({ profession, output });
    if (body === null) {
      // Trade fuera del catálogo (nivel 1 y nivel 2): no publica,
      // no lanza. La inmensa mayoría de trades cotidianos
      // (trigo/palos por esmeralda) cae por aquí.
      return;
    }

    await context.publisher.publish({
      title: TITLE,
      body,
      kind: "villager_trade",
    });
  }
}

/**
 * String opcional en `event.data[key]`. Devuelve `null` si el campo
 * está ausente, no es string, o queda vacío tras trim. Nunca lanza.
 */
function extractOptionalString(event: EventRecord, key: string): string | null {
  const raw = event.data[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
