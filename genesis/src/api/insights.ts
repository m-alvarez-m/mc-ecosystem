import { getJson } from "../lib/http";

// Wrapper del endpoint oficial del Insight Engine.
//
// D1 no impone forma al payload — se acepta `unknown` y se renderiza
// como JSON crudo. La tipificacion estricta llegara en D2+ cuando se
// consuma en componentes reales (candidato de packages/shared o de
// un tipo local a Genesis; decision aparcada por YAGNI en D1).

export interface InsightsQuery {
  from: string;
  to: string;
}

function toQueryString(params: InsightsQuery): string {
  const usp = new URLSearchParams({ from: params.from, to: params.to });
  return `?${usp.toString()}`;
}

export async function fetchInsights(params: InsightsQuery): Promise<unknown> {
  return getJson<unknown>(`/insight/insights${toQueryString(params)}`);
}
