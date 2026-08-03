import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchServerInsight, type ServerInsight } from "../api/server";

export function useServerInsight(): UseQueryResult<ServerInsight, Error> {
  return useQuery<ServerInsight, Error>({
    queryKey: ["server-insight"],
    queryFn: () => fetchServerInsight(),
  });
}
