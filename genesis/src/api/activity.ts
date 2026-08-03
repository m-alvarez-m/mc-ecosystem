import { getJson } from "../lib/http";

// GET /insight/activity/hourly?from=&to=
// GET /insight/activity/daily?from=&to=
//
// Fuente: api/src/insight/types.ts (ActivityHourBucket /
// ActivityDayBucket). Ambos endpoints devuelven SOLO buckets con
// eventos — el consumidor rellena huecos:
//   - hourly: 24 posiciones fijas (0..23 UTC).
//   - daily: rango [from, to] día a día.

export interface ActivityHourBucket {
  hour: number;
  count: string;
}

export interface ActivityDayBucket {
  date: string;
  count: string;
}

export interface ActivityQuery {
  from: string;
  to: string;
}

function toQueryString(params: ActivityQuery): string {
  const usp = new URLSearchParams({ from: params.from, to: params.to });
  return `?${usp.toString()}`;
}

export async function fetchActivityHourly(
  params: ActivityQuery,
): Promise<ActivityHourBucket[]> {
  return getJson<ActivityHourBucket[]>(
    `/insight/activity/hourly${toQueryString(params)}`,
  );
}

export async function fetchActivityDaily(
  params: ActivityQuery,
): Promise<ActivityDayBucket[]> {
  return getJson<ActivityDayBucket[]>(
    `/insight/activity/daily${toQueryString(params)}`,
  );
}
