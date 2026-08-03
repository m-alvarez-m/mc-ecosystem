import { useQuery } from "@tanstack/react-query";
import { fetchInsights, type InsightsQuery } from "../api/insights";

// Hook TanStack Query para el Insight Engine. Sin transformaciones,
// sin selectores — la pagina se encarga de renderizar el JSON crudo
// tal como llega. D2+ añadira tipado y selectores por vista.

export function useInsights(params: InsightsQuery) {
  return useQuery({
    queryKey: ["insights", params.from, params.to],
    queryFn: () => fetchInsights(params),
  });
}
