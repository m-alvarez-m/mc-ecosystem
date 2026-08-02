// Tipos de respuesta de las rutas GET /insight/*.
//
// Diseño intencionalmente pobre: cada endpoint expone lo mínimo que
// el ticket I1 exige, sin campos derivados ni cálculos redundantes.
// Los enteros grandes viajan como string (mismo criterio que
// `id::text` de events.ts) — COUNT(*) sobre BIGINT excede el rango
// seguro de Number en JS.

/**
 * Respuesta de GET /insight/events/count.
 *
 * `total` es la suma de todos los `count` de `groupedByType` — no
 * es una segunda consulta redundante, se calcula en código a partir
 * del resultado del GROUP BY.
 */
export interface EventCount {
  readonly total: string;
  readonly groupedByType: ReadonlyArray<{
    readonly type: string;
    readonly count: string;
  }>;
}

/**
 * Elemento de la timeline. Mismo shape que `EventRecord` de events.ts
 * — el consumer analítico ve el evento crudo tal como está en la
 * DB. Las fechas se serializan a ISO string por Fastify.
 */
export interface TimelineEvent {
  readonly id: string;
  readonly event_uuid: string;
  readonly type: string;
  readonly v: number;
  readonly ts: Date;
  readonly received_at: Date;
  readonly player_uuid: string | null;
  readonly world: string | null;
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
  readonly data: Record<string, unknown>;
}

/**
 * Respuesta de GET /insight/players.
 *
 * `activePlayers` = jugadores con `last_seen >= from`.
 * `newPlayers`    = jugadores con `first_seen >= from`.
 * `returningPlayers` = jugadores con `first_seen < from` y
 *                       `last_seen >= from`.
 * Por definición: `activePlayers = newPlayers + returningPlayers`.
 */
export interface PlayersSummary {
  readonly totalPlayers: string;
  readonly activePlayers: string;
  readonly newPlayers: string;
  readonly returningPlayers: string;
}

/** Referencia mínima a un evento (para primer/último de un jugador). */
export interface PlayerEventReference {
  readonly id: string;
  readonly event_uuid: string;
  readonly type: string;
  readonly ts: Date;
}

/**
 * Respuesta de GET /insight/player/:uuid.
 *
 * `firstEvent` / `lastEvent` pueden ser `null` si el jugador existe
 * en la tabla `players` pero aún no tiene eventos asociados —
 * escenario defensivo, no debería ocurrir en flujo normal
 * (session.start crea la row de players y el propio evento).
 */
export interface PlayerInsight {
  readonly uuid: string;
  readonly name: string;
  readonly nameHistory: ReadonlyArray<{
    readonly name: string;
    readonly seen_at: Date;
  }>;
  readonly firstEvent: PlayerEventReference | null;
  readonly lastEvent: PlayerEventReference | null;
  readonly totalEvents: string;
  readonly eventsByType: ReadonlyArray<{
    readonly type: string;
    readonly count: string;
  }>;
}

/** Referencia a un evento server-wide (primer/último). */
export interface ServerEventReference {
  readonly id: string;
  readonly event_uuid: string;
  readonly type: string;
  readonly ts: Date;
}

/**
 * Respuesta de GET /insight/server.
 *
 * `timeRangeStart` / `timeRangeEnd` son alias de `firstEvent.ts`
 * y `lastEvent.ts` — se exponen aparte para consumidores que sólo
 * quieren el rango sin cargar los eventos completos.
 * Todos los campos son `null` cuando la tabla `events` está vacía.
 */
export interface ServerInsight {
  readonly firstEvent: ServerEventReference | null;
  readonly lastEvent: ServerEventReference | null;
  readonly totalEvents: string;
  readonly distinctTypes: string;
  readonly latestId: string | null;
  readonly timeRangeStart: Date | null;
  readonly timeRangeEnd: Date | null;
}
