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

// -------------------------------------------------------------------
// I2 · Agregados reutilizables
// -------------------------------------------------------------------

/**
 * Elemento del heatmap horario (0-23 UTC). Sólo aparecen horas con
 * eventos — el consumidor rellena con ceros si necesita el histograma
 * completo. `hour` viene del EXTRACT de Postgres como integer.
 */
export interface ActivityHourBucket {
  readonly hour: number;
  readonly count: string;
}

/**
 * Elemento de la serie temporal por día (UTC). `date` en formato
 * ISO YYYY-MM-DD sin componente horaria. Sólo aparecen días con
 * eventos — si el rango cubre huecos, el consumidor los interpola.
 */
export interface ActivityDayBucket {
  readonly date: string;
  readonly count: string;
}

/**
 * Fila del ranking de jugadores más activos en un rango. `name` es
 * el nombre canónico ACTUAL del jugador (viene de `players.name`
 * via JOIN); si el nombre cambió durante el rango, sale el actual.
 */
export interface TopPlayer {
  readonly uuid: string;
  readonly name: string;
  readonly count: string;
}

/**
 * Fila del ranking de tipos de evento más frecuentes en un rango.
 * Reordenable — el orden natural es DESC por count, ASC por type
 * como desempate estable (útil en tests deterministas).
 */
export interface TopEventType {
  readonly type: string;
  readonly count: string;
}

// -------------------------------------------------------------------
// I3 · Patrones objetivos sobre el Event Store
// -------------------------------------------------------------------
//
// Todos los tipos de I3 son datos estructurados y determinísticos.
// NINGUNO contiene texto narrativo, interpretaciones, categorizaciones
// tipo "up"/"down"/"trending", ni conclusiones. Los consumidores
// derivan lecturas humanas a partir de estas estructuras — I3 es la
// última capa antes de la interpretación (que llegará en fases
// posteriores).

/** Referencia hora-count (0..23 UTC). Compartido por peak/quiet hour. */
export interface HourBucketRef {
  readonly hour: number;
  readonly count: string;
}

/** Referencia día-count (YYYY-MM-DD UTC). Compartido por busiest/quietest day. */
export interface DayBucketRef {
  readonly date: string;
  readonly count: string;
}

/**
 * Respuesta de GET /insight/patterns/activity.
 *
 * `peakHour` es la hora (0..23) con mayor count en el rango.
 * `quietHours` son horas (0..23) SIN ningún evento en el rango.
 * `busiestDay` / `quietestDayWithActivity` son días con actividad
 * (los días vacíos no cuentan como "quietestDay").
 * `activeDaysCount` es el número de días con al menos un evento.
 * `totalDaysInRange` es el número calendárico total del rango
 * `[from, to]` (calculado en código desde los timestamps, no SQL).
 * Todos los campos son `null` cuando no hay eventos en el rango.
 */
export interface ActivityPatterns {
  readonly peakHour: HourBucketRef | null;
  readonly quietHours: readonly number[];
  readonly busiestDay: DayBucketRef | null;
  readonly quietestDayWithActivity: DayBucketRef | null;
  readonly activeDaysCount: number;
  readonly totalDaysInRange: number;
  readonly totalEvents: string;
}

/** Snapshot de un período para la comparación de crecimiento. */
export interface GrowthPeriod {
  readonly from: string;
  readonly to: string;
  readonly totalEvents: string;
  readonly activePlayers: string;
}

/**
 * Deltas entre el período actual y el anterior equivalente.
 *
 * `*Absolute` es la diferencia entera (BigInt-safe, siempre string).
 * `*Ratio` es un `number` (Number nativo de JS) — el ratio pierde
 * precisión si los counts superan 2^53, aceptable en la práctica
 * (un servidor con >9×10^15 eventos por período es fantasía).
 * `*Ratio` es `null` cuando el denominador (período anterior) es 0.
 */
export interface GrowthDelta {
  readonly totalEventsAbsolute: string;
  readonly totalEventsRatio: number | null;
  readonly activePlayersAbsolute: string;
  readonly activePlayersRatio: number | null;
}

/**
 * Respuesta de GET /insight/patterns/growth.
 *
 * El período `previous` cubre los mismos milisegundos que `current`
 * pero desplazado hacia atrás — `previous.to = current.from` y
 * `previous.from = current.from - (current.to - current.from)`. La
 * frontera se toca en `current.from`; el potencial solape de un
 * instante es despreciable y se documenta en el router.
 */
export interface GrowthPatterns {
  readonly current: GrowthPeriod;
  readonly previous: GrowthPeriod;
  readonly delta: GrowthDelta;
}

/**
 * Bloque de jugadores recurrentes: cuántos jugadores tienen eventos
 * en al menos `minActiveDays` días distintos dentro del rango.
 */
export interface RecurrentPlayersBlock {
  readonly count: string;
  readonly minActiveDays: number;
}

/**
 * Bloque de jugadores inactivos: cuántos jugadores del universo
 * `players` tienen `last_seen` estrictamente anterior al corte
 * `cutoff` (que a su vez es `to - thresholdDays` calculado en el
 * router). El corte se devuelve para auditoría.
 */
export interface IdlePlayersBlock {
  readonly count: string;
  readonly thresholdDays: number;
  readonly cutoff: string;
}

/**
 * Respuesta de GET /insight/patterns/players.
 *
 * Complementa (no reemplaza) `GET /insight/players` de I1: aquí
 * medimos "recurrencia" (>= N días activos) e "inactividad"
 * (last_seen anterior al corte). I1 mide "activo/nuevo/returning"
 * respecto de un único cutoff.
 */
export interface PlayerPatterns {
  readonly recurrent: RecurrentPlayersBlock;
  readonly idle: IdlePlayersBlock;
}

/** Un tramo consecutivo de días con actividad server-wide. */
export interface StreakRef {
  readonly startDate: string;
  readonly endDate: string;
  readonly length: number;
}

/**
 * Respuesta de GET /insight/patterns/streaks.
 *
 * `longestStreak` es el tramo más largo del rango (`null` si no hay
 * ningún día con actividad). Empate por `startDate ASC` (el más
 * antiguo gana). `totalStreaks` es el número de tramos disjuntos.
 * `activeDaysCount` es la suma de longitudes de todos los tramos —
 * igual al número de días distintos con actividad.
 */
export interface StreakPatterns {
  readonly longestStreak: StreakRef | null;
  readonly totalStreaks: number;
  readonly activeDaysCount: number;
}
