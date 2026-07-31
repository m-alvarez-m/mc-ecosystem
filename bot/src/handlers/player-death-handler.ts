import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { narrateDeath } from "../minecraft";
import { MissingPlayerUuidError } from "./errors";

// PlayerDeathHandler (T8 v1.1 — Death Chronicle).
//
// Ya no imprime "X ha muerto por Y". Consulta al Death Catalog para
// obtener una narración corta y con personalidad basada en la causa
// concreta + mob que remató. Toda la narrativa (variantes, mapeo de
// causas, selección aleatoria) vive dentro del catálogo; el handler
// SOLO reúne los campos crudos del payload y delega.
//
// Payload consumido (según el plugin EventCollector):
//   - player_uuid (raíz, obligatorio) → resolver → nombre canónico.
//   - data.cause (string opcional): DamageCause de Bukkit en
//     minúsculas — "fall", "lava", "entity_explosion", ...
//   - data.killer_mob (string opcional): namespaced key del mob que
//     remató — "minecraft:creeper", "minecraft:zombie", ...
//   - data.message (string opcional): mensaje vanilla de Minecraft,
//     usado como fallback cuando la categoría no se reconoce.

const EVENT_TYPE = "player.death";

const TITLE = "Crónica de muerte";

export class PlayerDeathHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    if (event.player_uuid === null) {
      throw new MissingPlayerUuidError(EVENT_TYPE, event.event_uuid);
    }
    const name = await context.playerNameResolver.resolve(event.player_uuid);

    const body = narrateDeath({
      playerName: name,
      cause: extractOptionalString(event, "cause"),
      killerMob: extractOptionalString(event, "killer_mob"),
      vanillaMessage: extractOptionalString(event, "message"),
    });

    await context.publisher.publish({
      title: TITLE,
      body,
      kind: "player_death",
    });
  }
}

/**
 * Devuelve el string de `event.data[key]` trimeado si es válido; `null`
 * si el campo está ausente, no es string o queda vacío tras trim.
 * NUNCA lanza: la política de "usar el catálogo o caer al vanilla"
 * del narrador ya cubre todos los casos de datos ausentes/malformados.
 */
function extractOptionalString(event: EventRecord, key: string): string | null {
  const raw = event.data[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
