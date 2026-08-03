import { getJson } from "../lib/http";

// Contrato del Insight Engine (I5 de la fase Insight) tal como lo
// consume Genesis. Espejo del shape descrito en el commit de cierre
// de la fase (docs/phase-02-insight-complete.md § "Contrato uniforme"):
//
//   { id, category, severity, confidence, generatedAt, window,
//     facts, evidence, metadata }
//
// Los tipos viven aqui (en la capa API del cliente) para no requerir
// packages/shared todavia (YAGNI de D1 sigue vigente). Cuando el
// monorepo active workspaces, esto puede migrar sin cambiar consumers
// gracias al barrel de src/api.

export type InsightId =
  | "activity-trend"
  | "exploration-trend"
  | "economy-focus"
  | "player-engagement";

export type InsightCategory = "activity" | "exploration" | "economy" | "players";

export type Severity = "normal" | "low" | "high" | "critical";

export type Confidence = "low" | "medium" | "high";

export interface InsightWindow {
  from: string;
  to: string;
}

export interface InsightMetadata {
  severityThresholds: Record<string, number>;
  confidenceThresholds: Record<string, number>;
  engineVersion: string;
}

/**
 * Un Insight. `facts` es un `Record<string, unknown>` porque el shape
 * concreto depende del `id` — se renderiza generico en el Overview,
 * sin per-insight logic (respeta la simetria del contrato uniforme).
 */
export interface Insight {
  id: InsightId;
  category: InsightCategory;
  severity: Severity;
  confidence: Confidence;
  generatedAt: string;
  window: InsightWindow;
  facts: Record<string, unknown>;
  evidence: readonly string[];
  metadata: InsightMetadata;
}

export interface InsightsQuery {
  from: string;
  to: string;
}

function toQueryString(params: InsightsQuery): string {
  const usp = new URLSearchParams({ from: params.from, to: params.to });
  return `?${usp.toString()}`;
}

export async function fetchInsights(params: InsightsQuery): Promise<Insight[]> {
  return getJson<Insight[]>(`/insight/insights${toQueryString(params)}`);
}
