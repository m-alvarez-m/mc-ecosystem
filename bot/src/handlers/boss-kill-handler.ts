import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";
import { narrateBossKill } from "../minecraft";

// BossKillHandler (T11 v1.1 — Boss Chronicle).
//
// Consume `boss.kill` que emite `ProgressListener.onBossDeath` cuando
// muere un Wither o un Ender Dragon. A diferencia de T10 (hitos
// server-first), aquí cada muerte se publica: dos withers en distintos
// días son dos crónicas de batalla distintas. El handler es puro,
// sin estado, sin dedup.
//
// Payload consumido (según plugin/.../ProgressListener.java:42-73):
//   - player_uuid (raíz): killer, puede ser null (boss muerto por
//     entorno o mob no-player). NO se usa en la narración —
//     participants ya cubre a los presentes.
//   - data.boss (obligatorio): "wither" | "ender_dragon" | futuros.
//   - data.participants (obligatorio: el plugin siempre lo envía,
//     puede ser array vacío): UUIDs de todos los jugadores dentro
//     de 128 blk del boss al morir.
//
// Se listan hasta los primeros 5 participantes; el resto se resume
// como "... y N más.". Los nombres se resuelven vía
// PlayerNameResolver (idem otros handlers).

const EVENT_TYPE = "boss.kill";

const TITLE = "Batalla del servidor";

const PARTICIPANT_DISPLAY_LIMIT = 5;

/**
 * Error del handler cuando falta el identificador del boss en el
 * payload. Se lanza si `data.boss` no existe, no es string, o queda
 * vacío tras trim. El plugin siempre lo emite; este error indica
 * corrupción del stream.
 */
export class MissingBossError extends Error {
  readonly code = "MISSING_BOSS";

  constructor(public readonly eventUuid: string) {
    super(
      `boss.kill sin campo data.boss valido (event_uuid=${eventUuid})`,
    );
    this.name = "MissingBossError";
  }
}

export class BossKillHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const boss = extractBoss(event);
    const participantUuids = extractParticipants(event);

    const shown = participantUuids.slice(0, PARTICIPANT_DISPLAY_LIMIT);
    const extraCount = Math.max(
      0,
      participantUuids.length - PARTICIPANT_DISPLAY_LIMIT,
    );

    // Resolución en paralelo — los UUIDs vienen de jugadores que
    // acaban de estar online, así que resolver debería acertar. Si
    // uno falla, el fallo se propaga y el dispatcher lo cuenta.
    const participantNames = await Promise.all(
      shown.map((uuid) => context.playerNameResolver.resolve(uuid)),
    );

    const body = narrateBossKill({
      boss,
      participants: participantNames,
      extraCount,
    });

    await context.publisher.publish({
      title: TITLE,
      body,
      kind: "boss_kill",
    });
  }
}

function extractBoss(event: EventRecord): string {
  const raw = event.data["boss"];
  if (typeof raw !== "string") {
    throw new MissingBossError(event.event_uuid);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MissingBossError(event.event_uuid);
  }
  return trimmed;
}

/**
 * `data.participants` según ProgressListener siempre es un array
 * de UUIDs (strings). Este helper es tolerante: array ausente,
 * `null`, o no-array → devuelve []. Entradas no-string dentro del
 * array se filtran (no romper por un entry corrupto).
 */
function extractParticipants(event: EventRecord): readonly string[] {
  const raw = event.data["participants"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const uuids: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      uuids.push(entry);
    }
  }
  return uuids;
}
