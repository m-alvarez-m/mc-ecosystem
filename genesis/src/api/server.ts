import { getJson } from "../lib/http";

// GET /insight/server — snapshot server-wide del Event Store.
// Fuente de verdad del contrato: api/src/insight/types.ts (interfaz
// ServerInsight). Genesis lo espeja localmente hasta que
// packages/shared exista (YAGNI: sigue vigente).
//
// Notas del shape:
//   - `totalEvents` / `distinctTypes` / `latestId` viajan como
//     STRING (BigInt-safe: los conteos y el id son BIGINT en la DB).
//   - `timeRangeStart` / `timeRangeEnd` son ISO date strings o null
//     cuando la tabla `events` está vacía.
//   - `firstEvent` / `lastEvent` son referencias mínimas al evento
//     correspondiente; también null si `events` está vacía.

export interface ServerEventReference {
  id: string;
  event_uuid: string;
  type: string;
  ts: string;
}

export interface ServerInsight {
  firstEvent: ServerEventReference | null;
  lastEvent: ServerEventReference | null;
  totalEvents: string;
  distinctTypes: string;
  latestId: string | null;
  timeRangeStart: string | null;
  timeRangeEnd: string | null;
}

export async function fetchServerInsight(): Promise<ServerInsight> {
  return getJson<ServerInsight>("/insight/server");
}
