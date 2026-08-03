import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchActivityHourly,
  type ActivityHourBucket,
  type ActivityQuery,
} from "../api/activity";

export function useActivityHourly(
  params: ActivityQuery,
): UseQueryResult<ActivityHourBucket[], Error> {
  return useQuery<ActivityHourBucket[], Error>({
    queryKey: ["activity-hourly", params.from, params.to],
    queryFn: () => fetchActivityHourly(params),
  });
}
