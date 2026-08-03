import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchActivityDaily,
  type ActivityDayBucket,
  type ActivityQuery,
} from "../api/activity";

export function useActivityDaily(
  params: ActivityQuery,
): UseQueryResult<ActivityDayBucket[], Error> {
  return useQuery<ActivityDayBucket[], Error>({
    queryKey: ["activity-daily", params.from, params.to],
    queryFn: () => fetchActivityDaily(params),
  });
}
