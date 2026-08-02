import type { Pool } from "pg";
import * as signals from "./signals";
import type {
  ActivityTrendFacts,
  Confidence,
  EconomyFocusFacts,
  ExplorationTrendFacts,
  Insight,
  InsightId,
  InsightMetadata,
  PlayerEngagementFacts,
  Severity,
} from "./types";

// Union de todos los shapes de Insight que produce el registry.
// Necesario porque `Insight<ActivityTrendFacts>` no es asignable a
// `Insight<Record<string, unknown>>` bajo strict — TS exige index
// signature explícita. El union preserva los tipos concretos.
type AnyInsight =
  | Insight<ActivityTrendFacts>
  | Insight<ExplorationTrendFacts>
  | Insight<EconomyFocusFacts>
  | Insight<PlayerEngagementFacts>;

// I5 · Insights — capa de conocimiento derivado.
//
// Un Insight es la salida oficial de la fase Insight. Compone un
// Signal (I4) y añade clasificación uniforme: severity, confidence,
// generatedAt, evidence, metadata.
//
// Contrato con el consumer:
//   - Cada insight se computa desde UN signal (evidence: [nombre]).
//     Si un futuro insight combina varios signals, evidence lista
//     todos.
//   - severity y confidence se derivan por reglas determinísticas
//     con thresholds explícitos. Los thresholds viajan en
//     `metadata` para reproducibilidad.
//   - `generatedAt` es el reloj del servidor en el instante de
//     computar el insight (para trazabilidad, no para caché — la
//     misma DB con los mismos params da el mismo insight).
//   - Cero SQL nuevo. Toda la interacción con la DB pasa por
//     signals → repository.

/** Subset de Pool que necesita el engine (heredado de signals). */
type QueryClient = Pick<Pool, "query">;

// --------------------------------------------------------------------
// Constantes de derivación (todas viajan en metadata)
// --------------------------------------------------------------------

const ENGINE_VERSION = "1.0";

/**
 * Confianza por tamaño de muestra del período actual.
 * - sample < medium threshold → low
 * - medium ≤ sample < high    → medium
 * - sample ≥ high threshold   → high
 * Adicionalmente: si no hay baseline (ratio == null), degrada a low.
 */
const CONFIDENCE_SAMPLE_THRESHOLDS = { medium: 10, high: 100 } as const;

/**
 * Umbrales para severidad de activity-trend y exploration-trend
 * (ambos basados en |ratio - 1|). Ratio null → normal.
 */
const TREND_SEVERITY_THRESHOLDS = {
  normal: 0.1, // |ratio - 1| < 0.10 → normal
  low: 0.25, // 0.10 ≤ |ratio - 1| < 0.25 → low
  high: 0.5, // 0.25 ≤ |ratio - 1| < 0.50 → high
  // |ratio - 1| ≥ 0.50 → critical
} as const;

/**
 * Umbrales para severidad de economy-focus, basados en la cuota del
 * bucket dominante sobre el total económico.
 *   share < 0.50 → normal (bien distribuido)
 *   0.50-0.70    → low
 *   0.70-0.90    → high
 *   ≥ 0.90       → critical (monocultura)
 */
const ECONOMY_SEVERITY_THRESHOLDS = {
  normal: 0.5,
  low: 0.7,
  high: 0.9,
} as const;

/**
 * Umbrales para severidad de player-engagement. Se combinan idle e
 * active shares:
 *   idleShare ≥ 0.80        → critical (servidor mayormente inactivo)
 *   idleShare ≥ 0.60        → high
 *   activeShare ≥ 0.40      → normal
 *   otro caso               → low
 * total == 0 → normal + low confidence.
 */
const PLAYER_SEVERITY_THRESHOLDS = {
  idleCritical: 0.8,
  idleHigh: 0.6,
  activeNormal: 0.4,
} as const;

// --------------------------------------------------------------------
// Helpers privados
// --------------------------------------------------------------------

/**
 * Confianza puramente por tamaño de muestra. Usado por insights
 * cuyo signal no expone baseline (economy, players).
 */
function deriveConfidenceFromSample(sampleAsString: string): Confidence {
  const sample = Number(sampleAsString);
  if (sample >= CONFIDENCE_SAMPLE_THRESHOLDS.high) return "high";
  if (sample >= CONFIDENCE_SAMPLE_THRESHOLDS.medium) return "medium";
  return "low";
}

/**
 * Confianza combinada: sample size + presencia de baseline.
 * `ratio == null` fuerza `low` (no hay período previo con qué
 * comparar, por lo que cualquier severidad de "trend" es incierta).
 */
function deriveConfidenceWithBaseline(
  sampleAsString: string,
  ratio: number | null,
): Confidence {
  if (ratio === null) return "low";
  return deriveConfidenceFromSample(sampleAsString);
}

/**
 * Severidad derivada del ratio (activity y exploration comparten).
 * `null` → normal (no hay baseline para clasificar).
 */
function deriveTrendSeverity(ratio: number | null): Severity {
  if (ratio === null) return "normal";
  const magnitude = Math.abs(ratio - 1);
  if (magnitude < TREND_SEVERITY_THRESHOLDS.normal) return "normal";
  if (magnitude < TREND_SEVERITY_THRESHOLDS.low) return "low";
  if (magnitude < TREND_SEVERITY_THRESHOLDS.high) return "high";
  return "critical";
}

/**
 * Severidad para economy-focus. `share == null` (total 0) → normal.
 */
function deriveEconomySeverity(share: number | null): Severity {
  if (share === null) return "normal";
  if (share < ECONOMY_SEVERITY_THRESHOLDS.normal) return "normal";
  if (share < ECONOMY_SEVERITY_THRESHOLDS.low) return "low";
  if (share < ECONOMY_SEVERITY_THRESHOLDS.high) return "high";
  return "critical";
}

/**
 * Severidad para player-engagement. Combina idle y active shares
 * en el orden documentado.
 */
function derivePlayerSeverity(
  activeShare: number | null,
  idleShare: number | null,
): Severity {
  if (activeShare === null || idleShare === null) return "normal";
  if (idleShare >= PLAYER_SEVERITY_THRESHOLDS.idleCritical) return "critical";
  if (idleShare >= PLAYER_SEVERITY_THRESHOLDS.idleHigh) return "high";
  if (activeShare >= PLAYER_SEVERITY_THRESHOLDS.activeNormal) return "normal";
  return "low";
}

/** Cuota numérica (BigInt-safe). `null` si el denominador es 0. */
function safeShare(numerator: string, denominator: string): number | null {
  const denom = Number(denominator);
  if (denom === 0) return null;
  return Number(numerator) / denom;
}

/** Timestamp de generación, expuesto como helper para permitir mock en tests si aplica. */
function nowIsoDefault(): string {
  return new Date().toISOString();
}

/**
 * Opciones opcionales por insight generator — hoy sólo `now` para
 * facilitar tests deterministas. La firma pública NO expone esto
 * a los consumidores HTTP.
 */
interface GeneratorOptions {
  readonly now?: () => string;
}

// --------------------------------------------------------------------
// activity-trend
// --------------------------------------------------------------------

async function activityTrendInsight(
  pool: QueryClient,
  params: { from: string; to: string },
  options: GeneratorOptions = {},
): Promise<Insight<ActivityTrendFacts>> {
  const signal = await signals.activitySignal(pool, params);

  const facts: ActivityTrendFacts = {
    currentEvents: signal.current.totalEvents,
    previousEvents: signal.previous.totalEvents,
    totalEventsAbsolute: signal.delta.totalEventsAbsolute,
    totalEventsRatio: signal.delta.totalEventsRatio,
    trend: signal.trend,
    coverageActiveDays: signal.coverage.activeDaysCount,
    coverageTotalDays: signal.coverage.totalDaysInRange,
    coverageRatio: signal.coverage.ratio,
  };

  const metadata: InsightMetadata = {
    severityThresholds: TREND_SEVERITY_THRESHOLDS,
    confidenceThresholds: CONFIDENCE_SAMPLE_THRESHOLDS,
    engineVersion: ENGINE_VERSION,
  };

  return {
    id: "activity-trend",
    category: "activity",
    severity: deriveTrendSeverity(signal.delta.totalEventsRatio),
    confidence: deriveConfidenceWithBaseline(
      signal.current.totalEvents,
      signal.delta.totalEventsRatio,
    ),
    generatedAt: (options.now ?? nowIsoDefault)(),
    window: signal.window,
    facts,
    evidence: ["activitySignal"],
    metadata,
  };
}

// --------------------------------------------------------------------
// exploration-trend
// --------------------------------------------------------------------

async function explorationTrendInsight(
  pool: QueryClient,
  params: { from: string; to: string },
  options: GeneratorOptions = {},
): Promise<Insight<ExplorationTrendFacts>> {
  const signal = await signals.explorationSignal(pool, params);

  const facts: ExplorationTrendFacts = {
    currentChunks: signal.current.chunksExplored,
    previousChunks: signal.previous.chunksExplored,
    chunksAbsolute: signal.delta.absolute,
    chunksRatio: signal.delta.ratio,
    trend: signal.trend,
  };

  const metadata: InsightMetadata = {
    severityThresholds: TREND_SEVERITY_THRESHOLDS,
    confidenceThresholds: CONFIDENCE_SAMPLE_THRESHOLDS,
    engineVersion: ENGINE_VERSION,
  };

  return {
    id: "exploration-trend",
    category: "exploration",
    severity: deriveTrendSeverity(signal.delta.ratio),
    confidence: deriveConfidenceWithBaseline(
      signal.current.chunksExplored,
      signal.delta.ratio,
    ),
    generatedAt: (options.now ?? nowIsoDefault)(),
    window: { from: params.from, to: params.to },
    facts,
    evidence: ["explorationSignal"],
    metadata,
  };
}

// --------------------------------------------------------------------
// economy-focus
// --------------------------------------------------------------------

async function economyFocusInsight(
  pool: QueryClient,
  params: { from: string; to: string },
  options: GeneratorOptions = {},
): Promise<Insight<EconomyFocusFacts>> {
  const signal = await signals.economySignal(pool, params);
  const total = signal.totalEconomyEvents;

  // Cuota del bucket dominante sobre total. Sólo definido si hay
  // eventos económicos Y hay un dominante identificado.
  let dominantShare: number | null = null;
  if (signal.dominant !== null && total !== "0") {
    const dominantCount = signal[signal.dominant].totalEvents;
    dominantShare = safeShare(dominantCount, total);
  }

  const facts: EconomyFocusFacts = {
    totalEconomyEvents: total,
    dominant: signal.dominant,
    dominantShare,
    trading: signal.trading.totalEvents,
    crafting: signal.crafting.totalEvents,
    progression: signal.progression.totalEvents,
  };

  const metadata: InsightMetadata = {
    severityThresholds: ECONOMY_SEVERITY_THRESHOLDS,
    confidenceThresholds: CONFIDENCE_SAMPLE_THRESHOLDS,
    engineVersion: ENGINE_VERSION,
  };

  // Confianza basada en el tamaño del total económico. Sin
  // dominante (total=0) es equivalente porque `deriveConfidenceFromSample("0")`
  // devuelve low — pero lo hacemos explícito para dejarlo documentado.
  const confidence: Confidence =
    signal.dominant === null ? "low" : deriveConfidenceFromSample(total);

  return {
    id: "economy-focus",
    category: "economy",
    severity: deriveEconomySeverity(dominantShare),
    confidence,
    generatedAt: (options.now ?? nowIsoDefault)(),
    window: signal.window,
    facts,
    evidence: ["economySignal"],
    metadata,
  };
}

// --------------------------------------------------------------------
// player-engagement
// --------------------------------------------------------------------

async function playerEngagementInsight(
  pool: QueryClient,
  params: { from: string; to: string },
  options: GeneratorOptions = {},
): Promise<Insight<PlayerEngagementFacts>> {
  const signal = await signals.playersSignal(pool, params);
  const total = signal.total;

  const activeShare = safeShare(signal.active, total);
  const newcomersShare = safeShare(signal.newcomers, total);
  const idleShare = safeShare(signal.idle.count, total);

  const facts: PlayerEngagementFacts = {
    total,
    active: signal.active,
    activeShare,
    newcomers: signal.newcomers,
    newcomersShare,
    returning: signal.returning,
    recurrent: signal.recurrent.count,
    idle: signal.idle.count,
    idleShare,
  };

  const metadata: InsightMetadata = {
    severityThresholds: PLAYER_SEVERITY_THRESHOLDS,
    confidenceThresholds: CONFIDENCE_SAMPLE_THRESHOLDS,
    engineVersion: ENGINE_VERSION,
  };

  // Confianza por tamaño del universo `players`. `total == "0"`
  // degrada naturalmente a low porque `deriveConfidenceFromSample("0")`
  // = 0 < 10 (medium threshold).
  const confidence: Confidence = deriveConfidenceFromSample(total);

  return {
    id: "player-engagement",
    category: "players",
    severity: derivePlayerSeverity(activeShare, idleShare),
    confidence,
    generatedAt: (options.now ?? nowIsoDefault)(),
    window: signal.window,
    facts,
    evidence: ["playersSignal"],
    metadata,
  };
}

// --------------------------------------------------------------------
// Registry (fuente de verdad de los insights soportados)
// --------------------------------------------------------------------

type InsightGenerator = (
  pool: QueryClient,
  params: { from: string; to: string },
  options?: GeneratorOptions,
) => Promise<AnyInsight>;

const INSIGHT_REGISTRY: Readonly<Record<InsightId, InsightGenerator>> = {
  "activity-trend": activityTrendInsight,
  "exploration-trend": explorationTrendInsight,
  "economy-focus": economyFocusInsight,
  "player-engagement": playerEngagementInsight,
};

/** IDs conocidos por el engine. Expuesto para consumidores/tests. */
export const KNOWN_INSIGHT_IDS: readonly InsightId[] = Object.keys(
  INSIGHT_REGISTRY,
) as InsightId[];

// --------------------------------------------------------------------
// API pública
// --------------------------------------------------------------------

/**
 * Genera todos los insights conocidos en paralelo para la ventana
 * dada. Orden estable según KNOWN_INSIGHT_IDS.
 */
export async function listInsights(
  pool: QueryClient,
  params: { from: string; to: string },
  options: GeneratorOptions = {},
): Promise<AnyInsight[]> {
  const generators = KNOWN_INSIGHT_IDS.map((id) => INSIGHT_REGISTRY[id]);
  return Promise.all(generators.map((g) => g(pool, params, options)));
}

/**
 * Genera un insight concreto por id. Devuelve `null` si el id no
 * está registrado — el router traduce a HTTP 404.
 */
export async function getInsight(
  pool: QueryClient,
  id: string,
  params: { from: string; to: string },
  options: GeneratorOptions = {},
): Promise<AnyInsight | null> {
  if (!(id in INSIGHT_REGISTRY)) return null;
  const generator = INSIGHT_REGISTRY[id as InsightId];
  return generator(pool, params, options);
}
