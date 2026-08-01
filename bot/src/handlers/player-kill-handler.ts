import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { narratePvpKill } from "../minecraft";
import { MissingPlayerUuidError } from "./errors";

// PlayerKillHandler (T12 v1.1 — PvP Chronicle).
//
// Consume `player.kill` (emitido por CombatListener.emitPlayerKill
// cuando en un PlayerDeathEvent el killer es otro Player). El
// handler resuelve killer + victim en paralelo, clasifica por
// weapon y delega toda la narrativa al catálogo. Puro (sin estado,
// sin dedup).
//
// Payload consumido (ver plugin/.../CombatListener.java:97-105):
//   - player_uuid (raíz, obligatorio): killer's UUID.
//   - data.victim_uuid (obligatorio): victim's UUID.
//   - data.weapon (obligatorio): namespaced key del item en mano
//     principal del killer (p. ej. "minecraft:diamond_sword",
//     "minecraft:bow", "minecraft:air").

const EVENT_TYPE = "player.kill";

const TITLE = "Duelo PvP";

/**
 * Error del handler cuando falta el UUID de la víctima en el
 * payload. El plugin siempre lo emite; este error indica corrupción
 * del stream.
 */
export class MissingVictimUuidError extends Error {
  readonly code = "MISSING_VICTIM_UUID";

  constructor(public readonly eventUuid: string) {
    super(
      `player.kill sin campo data.victim_uuid valido (event_uuid=${eventUuid})`,
    );
    this.name = "MissingVictimUuidError";
  }
}

export class PlayerKillHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    if (event.player_uuid === null) {
      throw new MissingPlayerUuidError(EVENT_TYPE, event.event_uuid);
    }
    const victimUuid = extractVictimUuid(event);
    const weapon = extractOptionalString(event, "weapon");

    // Resolución en paralelo — killer y victim son independientes.
    const [killer, victim] = await Promise.all([
      context.playerNameResolver.resolve(event.player_uuid),
      context.playerNameResolver.resolve(victimUuid),
    ]);

    const body = narratePvpKill({ killer, victim, weapon });

    await context.publisher.publish({
      title: TITLE,
      body,
      kind: "player_kill",
    });
  }
}

function extractVictimUuid(event: EventRecord): string {
  const raw = event.data["victim_uuid"];
  if (typeof raw !== "string") {
    throw new MissingVictimUuidError(event.event_uuid);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MissingVictimUuidError(event.event_uuid);
  }
  return trimmed;
}

/**
 * Extrae un string opcional. `null` si el campo está ausente, no
 * es string o queda vacío tras trim. NUNCA lanza — para weapon,
 * "ausente" es perfectamente válido: el catálogo cae al pool
 * `unknown`.
 */
function extractOptionalString(event: EventRecord, key: string): string | null {
  const raw = event.data[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
