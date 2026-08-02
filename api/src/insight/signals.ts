import type { Pool } from "pg";
import * as repo from "./repository";
import type {
  ActivitySignal,
  EconomyDominantLabel,
  EconomySignal,
  ExplorationSignal,
  PlayersSignal,
  Trend,
  TrendThresholds,
} from "./types";

// I4 · Signals — capa de composición.
//
// Los Signals COMBINAN funciones del repository en snapshots
// temáticos. NUNCA emiten SQL directamente — toda la interacción
// con Postgres se delega a `repository.ts`. Esta separación de
// responsabilidades es la razón por la que Signals vive en su
// propio archivo:
//
//   repository.ts → SQL (una función = una consulta o consultas
//                        agrupadas por dominio semántico).
//   signals.ts    → composición (una función = agrega N
//                                 llamadas al repo en un
//                                 objeto Signal).
//
// Contrato con el consumer:
//   - Cada Signal se computa en una única transacción lógica
//     (Promise.all cuando hay más de una llamada al repo).
//   - Todos los campos son datos estructurados. Sin frases,
//     sin categorías cualitativas ("saludable"/"peligroso"), sin
//     interpretación. Sólo `trend` está permitido y sus umbrales
//     son explícitos y viajan en la respuesta.
//   - Idempotente: llamar dos veces con los mismos params contra
//     la misma DB produce el mismo Signal.

/** Subset de Pool que necesitan los signals (heredado del repository). */
type QueryClient = Pick<Pool, "query">;

// --------------------------------------------------------------------
// Constantes de derivación
// --------------------------------------------------------------------
//
// Los umbrales de tendencia son visibles y se devuelven en cada
// Signal. No son "heurísticas ocultas" — son parámetros
// deterministas de la clasificación up/flat/down.

const TREND_UP_THRESHOLD = 1.1; // +10% respecto al período previo
const TREND_DOWN_THRESHOLD = 0.9; // -10% respecto al período previo

const DEFAULT_MIN_ACTIVE_DAYS = 3;
const DEFAULT_IDLE_THRESHOLD_DAYS = 30;

/** Los 3 tipos de evento que componen la señal económica. */
const ECONOMY_EVENT_TYPES = {
  trading: "villager.trade",
  crafting: "item.craft",
  progression: "item.enchant",
} as const;

// --------------------------------------------------------------------
// Helpers privados
// --------------------------------------------------------------------

const TREND_THRESHOLDS: TrendThresholds = {
  up: TREND_UP_THRESHOLD,
  down: TREND_DOWN_THRESHOLD,
};

/**
 * Clasificación de tendencia determinística por umbrales explícitos.
 * `no_baseline` cuando el ratio no está definido (denominador 0).
 */
function deriveTrend(ratio: number | null): Trend {
  if (ratio === null) return "no_baseline";
  if (ratio >= TREND_UP_THRESHOLD) return "up";
  if (ratio <= TREND_DOWN_THRESHOLD) return "down";
  return "flat";
}

/**
 * Ratio numérico actual/previo. Devuelve null si el denominador
 * es 0 — misma semántica que el helper privado del repository.
 * Se replica en signals.ts por micro-DRY: la alternativa sería
 * exportar un util compartido para 3 líneas.
 */
function safeRatio(current: string, previous: string): number | null {
  const prev = Number(previous);
  if (prev === 0) return null;
  return Number(current) / prev;
}

/**
 * Calcula la ventana previa contigua a `[from, to]`, con la misma
 * duración. `previousTo = from`, `previousFrom = from - (to - from)`.
 * Devuelve las dos strings ISO ya formateadas para el repo.
 */
function computePreviousWindow(
  from: string,
  to: string,
): { previousFrom: string; previousTo: string } {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const duration = toMs - fromMs;
  const previousFromMs = fromMs - duration;
  return {
    previousFrom: new Date(previousFromMs).toISOString(),
    previousTo: from,
  };
}

// --------------------------------------------------------------------
// GET /insight/signals/activity
// --------------------------------------------------------------------

export async function activitySignal(
  pool: QueryClient,
  params: { from: string; to: string },
): Promise<ActivitySignal> {
  const { previousFrom, previousTo } = computePreviousWindow(
    params.from,
    params.to,
  );

  // Composición: growthPatterns (I3) da current/previous/delta;
  // activityPatterns (I3) da coverage (activeDaysCount, totalDaysInRange).
  const [growth, activity] = await Promise.all([
    repo.growthPatterns(pool, {
      currentFrom: params.from,
      currentTo: params.to,
      previousFrom,
      previousTo,
    }),
    repo.activityPatterns(pool, { from: params.from, to: params.to }),
  ]);

  const coverageRatio =
    activity.totalDaysInRange > 0
      ? activity.activeDaysCount / activity.totalDaysInRange
      : 0;

  return {
    window: { from: params.from, to: params.to },
    current: growth.current,
    previous: growth.previous,
    delta: growth.delta,
    trend: deriveTrend(growth.delta.totalEventsRatio),
    trendThresholds: TREND_THRESHOLDS,
    coverage: {
      activeDaysCount: activity.activeDaysCount,
      totalDaysInRange: activity.totalDaysInRange,
      ratio: coverageRatio,
    },
  };
}

// --------------------------------------------------------------------
// GET /insight/signals/exploration
// --------------------------------------------------------------------

export async function explorationSignal(
  pool: QueryClient,
  params: { from: string; to: string },
): Promise<ExplorationSignal> {
  const { previousFrom, previousTo } = computePreviousWindow(
    params.from,
    params.to,
  );

  // Reutilización pura de countEvents (I1) con filtro por type —
  // sin nuevo SQL, mismos índices, mismos tests que I1 ya cubren.
  const [current, previous] = await Promise.all([
    repo.countEvents(pool, {
      from: params.from,
      to: params.to,
      type: "chunk.first_load",
    }),
    repo.countEvents(pool, {
      from: previousFrom,
      to: previousTo,
      type: "chunk.first_load",
    }),
  ]);

  const absolute = (BigInt(current.total) - BigInt(previous.total)).toString();
  const ratio = safeRatio(current.total, previous.total);

  return {
    current: {
      from: params.from,
      to: params.to,
      chunksExplored: current.total,
    },
    previous: {
      from: previousFrom,
      to: previousTo,
      chunksExplored: previous.total,
    },
    delta: { absolute, ratio },
    trend: deriveTrend(ratio),
    trendThresholds: TREND_THRESHOLDS,
  };
}

// --------------------------------------------------------------------
// GET /insight/signals/economy
// --------------------------------------------------------------------

export async function economySignal(
  pool: QueryClient,
  params: { from: string; to: string },
): Promise<EconomySignal> {
  const [trading, crafting, progression] = await Promise.all([
    repo.countEvents(pool, {
      from: params.from,
      to: params.to,
      type: ECONOMY_EVENT_TYPES.trading,
    }),
    repo.countEvents(pool, {
      from: params.from,
      to: params.to,
      type: ECONOMY_EVENT_TYPES.crafting,
    }),
    repo.countEvents(pool, {
      from: params.from,
      to: params.to,
      type: ECONOMY_EVENT_TYPES.progression,
    }),
  ]);

  const totalBig =
    BigInt(trading.total) + BigInt(crafting.total) + BigInt(progression.total);

  // Determina el bucket dominante: mayor count con desempate
  // alfabético — crafting < progression < trading, así que si hay
  // empate exacto crafting gana, luego progression, luego trading.
  // Determinístico y explicable.
  const buckets: Array<{
    name: EconomyDominantLabel;
    count: bigint;
  }> = [
    { name: "trading", count: BigInt(trading.total) },
    { name: "crafting", count: BigInt(crafting.total) },
    { name: "progression", count: BigInt(progression.total) },
  ];
  buckets.sort((a, b) => {
    if (a.count > b.count) return -1;
    if (a.count < b.count) return 1;
    return a.name.localeCompare(b.name);
  });
  const dominant: EconomyDominantLabel | null =
    totalBig > 0n ? buckets[0]!.name : null;

  return {
    window: { from: params.from, to: params.to },
    trading: {
      type: ECONOMY_EVENT_TYPES.trading,
      totalEvents: trading.total,
    },
    crafting: {
      type: ECONOMY_EVENT_TYPES.crafting,
      totalEvents: crafting.total,
    },
    progression: {
      type: ECONOMY_EVENT_TYPES.progression,
      totalEvents: progression.total,
    },
    dominant,
    totalEconomyEvents: totalBig.toString(),
  };
}

// --------------------------------------------------------------------
// GET /insight/signals/players
// --------------------------------------------------------------------

export async function playersSignal(
  pool: QueryClient,
  params: {
    from: string;
    to: string;
    minActiveDays?: number;
    idleThresholdDays?: number;
  },
): Promise<PlayersSignal> {
  const minActiveDays = params.minActiveDays ?? DEFAULT_MIN_ACTIVE_DAYS;
  const idleThresholdDays =
    params.idleThresholdDays ?? DEFAULT_IDLE_THRESHOLD_DAYS;
  const toMs = Date.parse(params.to);
  const idleCutoff = new Date(
    toMs - idleThresholdDays * 86_400_000,
  ).toISOString();

  const [summary, patterns] = await Promise.all([
    repo.playersSummary(pool, { from: params.from }),
    repo.playerPatterns(pool, {
      from: params.from,
      to: params.to,
      minActiveDays,
      idleCutoff,
      idleThresholdDays,
    }),
  ]);

  return {
    window: { from: params.from, to: params.to },
    total: summary.totalPlayers,
    active: summary.activePlayers,
    newcomers: summary.newPlayers,
    returning: summary.returningPlayers,
    recurrent: patterns.recurrent,
    idle: patterns.idle,
  };
}
