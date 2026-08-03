import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchPlayersSummary,
  type PlayersSummary,
  type PlayersSummaryQuery,
} from "../api/players";

export function usePlayersSummary(
  params: PlayersSummaryQuery,
): UseQueryResult<PlayersSummary, Error> {
  return useQuery<PlayersSummary, Error>({
    queryKey: ["players-summary", params.from],
    queryFn: () => fetchPlayersSummary(params),
  });
}
