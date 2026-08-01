import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { narrateProgress } from "../minecraft";
import type { EnchantEntry } from "../minecraft";

// ProgressHandler (T15 v1.1 — Progress Chronicle).
//
// Consume `item.enchant` — pero SÓLO publica cuando los
// encantamientos aplicados representan un salto real en la
// evolución del servidor (Mending, Silk Touch, Fortune III,
// Efficiency V, encantamientos ofensivos al máximo, etc.). Todo
// lo demás (Sharpness I común, Efficiency II ordinario) se ignora
// silenciosamente.
//
// Handler PURO: sin estado, sin dedup, sin memoria.
//
// Narración IMPERSONAL: el hito describe la EVOLUCIÓN del
// servidor, no del jugador. Consistente con Craft, Server
// Milestone y Villager Trade Chronicles: no llama al
// PlayerNameResolver — las crónicas de progreso deben ser
// atemporales y reutilizables por Insight, Memoria, Legacy y
// Genesis.
//
// Payload consumido (verificado en plugin/.../EconomyListener.java:68-86):
//   - player_uuid (raíz): enchanter. NO se usa (narrativa
//     impersonal); no se valida.
//   - data.enchants: array de `{ id: string, lvl: integer }`. El
//     order del array NO está garantizado (event.getEnchantsToAdd
//     es un Map); el catálogo aplica un orden de prioridad para
//     decidir el pool si hay varios encantamientos notables.
//   - data.item, data.cost_levels: no usados.

const EVENT_TYPE = "item.enchant";

const TITLE = "Evolución del servidor";

export class ProgressHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const enchants = extractEnchants(event);
    const body = narrateProgress({ enchants });
    if (body === null) {
      // Encantamientos no notables (Sharpness I, Efficiency II, ...) o
      // payload corrupto: silencio absoluto. Este es el camino habitual
      // — la mayoría de eventos item.enchant son de bajo nivel.
      return;
    }
    await context.publisher.publish({
      title: TITLE,
      body,
      kind: "progress",
    });
  }
}

/**
 * Extrae el array de encantamientos del payload. Defensivo: filas
 * corruptas se descartan sin lanzar. Devuelve `[]` si `data.enchants`
 * está ausente / no es array — el catálogo entonces devolverá null y
 * el handler terminará en silencio.
 */
function extractEnchants(event: EventRecord): readonly EnchantEntry[] {
  const raw = event.data["enchants"];
  if (!Array.isArray(raw)) return [];
  const out: EnchantEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    const id = rec["id"];
    const lvl = rec["lvl"];
    if (typeof id !== "string" || id.trim().length === 0) continue;
    if (typeof lvl !== "number" || !Number.isFinite(lvl)) continue;
    out.push({ id: id.trim(), lvl });
  }
  return out;
}
