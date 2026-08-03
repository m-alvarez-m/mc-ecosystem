import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchTopPlayers,
  type TopPlayer,
  type TopPlayersQuery,
} from "../api/topPlayers";

export function useTopPlayers(
  params: TopPlayersQuery,
): UseQueryResult<TopPlayer[], Error> {
  return useQuery<TopPlayer[], Error>({
    queryKey: ["top-players", params.from, params.to, params.limit],
    queryFn: () => fetchTopPlayers(params),
  });
}
