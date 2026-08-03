import { getJson } from "../lib/http";

// GET /insight/player/:uuid
//
// Fuente: api/src/insight/types.ts (PlayerInsight).
//   - `uuid` + `name` (nombre canónico actual).
//   - `nameHistory`: transiciones de nombre (ASC por seen_at en la
//     API — pintamos DESC en la UI).
//   - `firstEvent` / `lastEvent`: referencias mínimas del primer y
//     último evento del jugador. `null` si el jugador no tiene
//     eventos aún (raro — session.start crea la fila y el evento
//     en la misma transacción).
//   - `totalEvents`: STRING BIGINT-safe.
//   - `eventsByType`: distribución {type, count} ordenada DESC por
//     count en la API.

export interface PlayerEventReference {
  id: string;
  event_uuid: string;
  type: string;
  ts: string;
}

export interface PlayerNameHistoryEntry {
  name: string;
  seen_at: string;
}

export interface PlayerEventsByType {
  type: string;
  count: string;
}

export interface PlayerInsight {
  uuid: string;
  name: string;
  nameHistory: readonly PlayerNameHistoryEntry[];
  firstEvent: PlayerEventReference | null;
  lastEvent: PlayerEventReference | null;
  totalEvents: string;
  eventsByType: readonly PlayerEventsByType[];
}

export async function fetchPlayerInsight(uuid: string): Promise<PlayerInsight> {
  return getJson<PlayerInsight>(`/insight/player/${encodeURIComponent(uuid)}`);
}
