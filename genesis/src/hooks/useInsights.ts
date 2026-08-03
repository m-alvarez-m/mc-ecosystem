import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchInsights,
  type Insight,
  type InsightsQuery,
} from "../api/insights";

// Hook TanStack Query para el Insight Engine. Sin transformaciones,
// sin selectores — la pagina se encarga de presentar los datos.

export function useInsights(
  params: InsightsQuery,
): UseQueryResult<Insight[], Error> {
  return useQuery<Insight[], Error>({
    queryKey: ["insights", params.from, params.to],
    queryFn: () => fetchInsights(params),
  });
}
