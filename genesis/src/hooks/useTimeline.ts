import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchTimeline,
  type TimelineEvent,
  type TimelineQuery,
} from "../api/timeline";

export function useTimeline(
  params: TimelineQuery,
): UseQueryResult<TimelineEvent[], Error> {
  return useQuery<TimelineEvent[], Error>({
    queryKey: ["timeline", params.from, params.to, params.limit],
    queryFn: () => fetchTimeline(params),
  });
}
